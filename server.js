const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// --- CONFIGURACIÓN ---
const REGION = 'EU';
const CURRENT_SEASON_ID = 17; 
const MAX_PAGES_TO_SCAN = 400;

// --- ANTI-BLOQUEO & SEGURIDAD ---
const CONCURRENT_REQUESTS = 10;
const REQUEST_DELAY = 100;

// --- CACHÉ PERSISTENTE (EN DISCO) ---
// Render nos da una carpeta '/data' que no se borra. Ahí guardaremos los JSON.
const CACHE_DIR = '/data/cache'; 
const CACHE_DURATION_CURRENT = 30 * 60 * 1000; // 30 min para la actual

// Creamos la carpeta de caché si no existe al arrancar
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// --- FUNCIONES ---
const loadPlayers = () => {
    try {
        const filePath = path.join(__dirname, 'jugadores.json');
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error("❌ Error leyendo jugadores.json:", e.message);
        return [];
    }
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getTwitchToken() {
    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) return null;
    try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: { client_id: TWITCH_CLIENT_ID, client_secret: TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }
        });
        return response.data.access_token;
    } catch (error) { return null; }
}

// --- API ---
app.get('/api/ranking', async (req, res) => {
    const seasonToScan = parseInt(req.query.season) || CURRENT_SEASON_ID;
    const isCurrentSeason = (seasonToScan === CURRENT_SEASON_ID);
    
    // Ruta al archivo de caché para esta temporada
    const cacheFilePath = path.join(CACHE_DIR, `season-${seasonToScan}.json`);

    // 1. REVISAR SI EL ARCHIVO DE CACHÉ EXISTE
    if (fs.existsSync(cacheFilePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
        
        // Si es temporada actual, comprobamos si el archivo tiene menos de 30 min.
        // Si es temporada vieja, la servimos directamente.
        if (!isCurrentSeason || (Date.now() - cacheData.timestamp < CACHE_DURATION_CURRENT)) {
            console.log(`⚡ Sirviendo Season ${seasonToScan} desde ARCHIVO CACHÉ.`);
            const finalData = await actualizarTwitchLive(cacheData.data);
            return res.json(finalData);
        }
    }

    // 2. SI NO HAY CACHÉ VÁLIDA, DESCARGAMOS DE BLIZZARD
    console.log(`🌐 Descargando Season ${seasonToScan} de Blizzard (se guardará en disco permanentemente)...`);

    const myPlayersRaw = loadPlayers();
    let results = myPlayersRaw.map(p => ({
        battleTag: p.battleTag,
        twitchUser: p.twitch || null,
        isLive: false,
        nameOnly: p.battleTag.split('#')[0].toLowerCase(),
        fullTag: p.battleTag.toLowerCase(),
        rank: null,
        rating: '< 8000',
        found: false
    }));

    try {
        // Descarga segura con auto-stop
        for (let i = 1; i <= MAX_PAGES_TO_SCAN; i += CONCURRENT_REQUESTS) {
            const batchPromises = [];
            for (let j = i; j < i + CONCURRENT_REQUESTS && j <= MAX_PAGES_TO_SCAN; j++) {
                batchPromises.push(axios.get(`...URL...&seasonId=${seasonToScan}`).then(r => r.data).catch(() => null));
            }
            const batchResponses = await Promise.all(batchPromises);
            
            let playersFoundInBatch = 0;
            batchResponses.forEach(data => {
                if (!data?.leaderboard?.rows) return;
                playersFoundInBatch += data.leaderboard.rows.length;
                data.leaderboard.rows.forEach(row => {
                    const blizzID = row.accountid?.toString().toLowerCase() || "";
                    results.forEach(player => {
                        if (!player.found && (blizzID === player.fullTag || blizzID.startsWith(player.nameOnly))) {
                            player.rank = row.rank; player.rating = row.rating; player.found = true;
                        }
                    });
                });
            });

            if (playersFoundInBatch === 0) {
                console.log(`🛑 Temporada finalizada en pág ${i}. Deteniendo escaneo.`);
                break;
            }
            await wait(REQUEST_DELAY);
        }

        // 3. PROCESAR Y GUARDAR
        let finalResponse = results.map(p => ({ battleTag: p.battleTag, rank: p.rank, rating: p.rating, found: p.found, twitchUser: p.twitchUser, isLive: false }));
        finalResponse.sort((a, b) => {
            if (a.found && !b.found) return -1; if (!a.found && b.found) return 1; if (a.found && b.found) return a.rank - b.rank; return 0;
        });
        finalResponse.forEach((player, index) => player.spainRank = index + 1);

        // Guardamos los datos en un archivo JSON en el disco persistente
        const dataToSave = {
            timestamp: Date.now(),
            data: finalResponse
        };
        fs.writeFileSync(cacheFilePath, JSON.stringify(dataToSave));
        console.log(`💾 Season ${seasonToScan} guardada en disco para el futuro.`);

        const dataWithTwitch = await actualizarTwitchLive(finalResponse);
        res.json(dataWithTwitch);

    } catch (error) {
        console.error("🚨 Error Servidor:", error.message);
        res.status(500).json({ error: "Error interno" });
    }
});

async function actualizarTwitchLive(playersList) {
    const twitchUsers = playersList.filter(r => r.twitchUser).map(r => r.twitchUser);
    if (twitchUsers.length === 0) return playersList;
    const token = await getTwitchToken();
    if (!token) return playersList;
    const updatedList = JSON.parse(JSON.stringify(playersList));
    try {
        const queryParams = new URLSearchParams();
        twitchUsers.forEach(user => queryParams.append('user_login', user));
        const twitchResp = await axios.get(`https://api.twitch.tv/helix/streams?${queryParams.toString()}`, { headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` } });
        const liveStreams = twitchResp.data.data;
        updatedList.forEach(player => {
            player.isLive = false;
            if (player.twitchUser && liveStreams.some(s => s.user_login.toLowerCase() === player.twitchUser.toLowerCase())) {
                player.isLive = true;
            }
        });
    } catch (e) { console.error("Twitch Error:", e.message); }
    return updatedList;
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Servidor Final (con caché en disco) en puerto ${PORT}`); });
