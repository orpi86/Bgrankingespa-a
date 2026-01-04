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
const CURRENT_SEASON_ID = 17; // Temporada 12 (Actual)
const MAX_PAGES_TO_SCAN = 500; 

// --- SEGURIDAD ANTI-BLOQUEO ---
const CONCURRENT_REQUESTS = 5; // Peticiones simultáneas (suave)
const REQUEST_DELAY = 150;     // Pausa entre bloques

// --- MEMORIA RAM (CACHÉ) ---
// Guardamos los datos aquí para que sea rápido y no dé error de escritura en Render
const memoriaCache = {}; 
const TIEMPO_CACHE_ACTUAL = 30 * 60 * 1000; // 30 minutos

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// --- CARGAR JUGADORES ---
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

    console.log(`📡 Petición recibida para Season ${seasonToScan}`);

    // 1. REVISAR MEMORIA
    const datosGuardados = memoriaCache[seasonToScan];
    let usarMemoria = false;

    if (datosGuardados) {
        if (!isCurrentSeason) {
            usarMemoria = true; // Temporadas viejas siempre de RAM
        } else {
            if (Date.now() - datosGuardados.timestamp < TIEMPO_CACHE_ACTUAL) {
                usarMemoria = true;
            }
        }
    }

    if (usarMemoria) {
        console.log(`⚡ Sirviendo Season ${seasonToScan} desde CACHÉ.`);
        const dataWithTwitch = await actualizarTwitchLive(datosGuardados.data);
        return res.json(dataWithTwitch);
    }

    // 2. DESCARGAR DE BLIZZARD
    console.log(`🌐 Descargando Season ${seasonToScan}...`);

    const myPlayersRaw = loadPlayers();
    let results = myPlayersRaw.map(p => ({
        battleTag: p.battleTag,
        twitchUser: p.twitch || null,
        isLive: false,
        nameOnly: p.battleTag.split('#')[0].toLowerCase(),
        fullTag: p.battleTag.toLowerCase(),
        rank: null,
        rating: 'Sin datos',
        found: false
    }));

    try {
        for (let i = 1; i <= MAX_PAGES_TO_SCAN; i += CONCURRENT_REQUESTS) {
            const batchPromises = [];
            
            for (let j = i; j < i + CONCURRENT_REQUESTS && j <= MAX_PAGES_TO_SCAN; j++) {
                batchPromises.push(
                    axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${j}&seasonId=${seasonToScan}`)
                    .then(r => r.data)
                    .catch(() => null)
                );
            }

            const batchResponses = await Promise.all(batchPromises);
            
            let jugadoresEncontradosEnLote = 0;

            batchResponses.forEach(data => {
                if (!data || !data.leaderboard || !data.leaderboard.rows) return;
                
                const rows = data.leaderboard.rows;
                if (rows.length > 0) jugadoresEncontradosEnLote += rows.length;

                rows.forEach(row => {
                    // --- TRUCO PARA TEMPORADAS VIEJAS Y NUEVAS ---
                    // Blizzard cambia el nombre del campo según la temporada
                    const rawName = row.accountid || row.battleTag || row.name || "";
                    const blizzName = rawName.toString().toLowerCase();

                    if (!blizzName) return;

                    results.forEach(player => {
                        if (player.found) return;
                        
                        // Comparamos nombre corto (orpinell) y largo (orpinell#2250)
                        if (blizzName === player.fullTag || blizzName === player.nameOnly) {
                            player.rank = row.rank;
                            player.rating = row.rating;
                            player.found = true;
                        }
                    });
                });
            });

            // FRENO DE MANO: Si las páginas vienen vacías, paramos.
            if (jugadoresEncontradosEnLote === 0) {
                console.log(`🛑 Temporada terminada en página ${i}. Parando.`);
                break; 
            }

            // Si ya tenemos a todos, paramos (ahorra tiempo)
            if (results.every(p => p.found)) {
                console.log("📍 Todos encontrados. Parando.");
                break;
            }

            await wait(REQUEST_DELAY);
        }

        // 3. PROCESAR
        let finalResponse = results.map(p => ({
            battleTag: p.battleTag,
            rank: p.rank,
            rating: p.rating,
            found: p.found,
            twitchUser: p.twitchUser,
            isLive: false 
        }));

        finalResponse.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });

        finalResponse.forEach((player, index) => player.spainRank = index + 1);

        // 4. GUARDAR EN MEMORIA
        memoriaCache[seasonToScan] = {
            timestamp: Date.now(),
            data: finalResponse
        };

        const dataWithTwitch = await actualizarTwitchLive(finalResponse);
        res.json(dataWithTwitch);

    } catch (error) {
        console.error("🚨 Error:", error.message);
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
        
        const twitchResp = await axios.get(`https://api.twitch.tv/helix/streams?${queryParams.toString()}`, {
            headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` }
        });

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
app.listen(PORT, () => { console.log(`🚀 Servidor Estable en puerto ${PORT}`); });
