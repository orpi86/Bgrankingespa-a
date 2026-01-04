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
const MAX_PAGES_TO_SCAN = 150; // Buscamos profundo...

// --- ANTI-BLOQUEO & SEGURIDAD ---
const CONCURRENT_REQUESTS = 10; // Peticiones simultáneas
const REQUEST_DELAY = 100;      // Pausa entre bloques (aumentada a 100ms por seguridad)

// --- CACHÉ ---
const CACHE_DURATION_CURRENT = 30 * 60 * 1000; // 30 min para la actual
const serverCache = {}; 

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

    // 1. REVISAR CACHÉ
    const cachedSeason = serverCache[seasonToScan];
    let serveFromCache = false;

    if (cachedSeason) {
        if (!isCurrentSeason) {
            serveFromCache = true; // Temporadas viejas siempre de caché
        } else {
            if (Date.now() - cachedSeason.timestamp < CACHE_DURATION_CURRENT) {
                serveFromCache = true; // Temporada actual si es reciente
            }
        }
    }

    if (serveFromCache) {
        console.log(`⚡ Sirviendo Season ${seasonToScan} desde CACHÉ.`);
        const finalData = await actualizarTwitchLive(cachedSeason.data);
        return res.json(finalData);
    }

    console.log(`🌐 Descargando Season ${seasonToScan} de Blizzard (Con auto-stop)...`);

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
        // 2. DESCARGA INTELIGENTE (Se detiene si no hay datos)
        for (let i = 1; i <= MAX_PAGES_TO_SCAN; i += CONCURRENT_REQUESTS) {
            const batchPromises = [];
            
            // Preparamos lote
            for (let j = i; j < i + CONCURRENT_REQUESTS && j <= MAX_PAGES_TO_SCAN; j++) {
                batchPromises.push(
                    axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${j}&seasonId=${seasonToScan}`)
                    .then(r => r.data)
                    .catch(() => null)
                );
            }

            const batchResponses = await Promise.all(batchPromises);
            
            // Variable para detectar si este lote estaba vacío
            let playersFoundInBatch = 0;

            batchResponses.forEach(data => {
                if (!data || !data.leaderboard || !data.leaderboard.rows) return;
                
                const rows = data.leaderboard.rows;
                playersFoundInBatch += rows.length;

                rows.forEach(row => {
                    const blizzID = row.accountid?.toString().toLowerCase() || "";
                    results.forEach(player => {
                        if (player.found) return;
                        if (blizzID === player.fullTag || blizzID.startsWith(player.nameOnly)) {
                            player.rank = row.rank;
                            player.rating = row.rating;
                            player.found = true;
                        }
                    });
                });
            });

            // --- EL FRENO DE MANO ---
            // Si en estas 10 páginas no hemos encontrado NINGÚN jugador de Blizzard,
            // asumimos que la temporada se ha terminado y paramos de buscar.
            if (playersFoundInBatch === 0) {
                console.log(`🛑 Temporada terminada en página ${i}. Parando escaneo para evitar ban.`);
                break; // Rompe el bucle for
            }

            // Pausa de seguridad
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

        // Guardar en caché
        serverCache[seasonToScan] = {
            timestamp: Date.now(),
            data: finalResponse
        };

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
    } catch (e) {
        console.error("Twitch Error:", e.message);
    }
    return updatedList;
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Servidor Final en puerto ${PORT}`); });
