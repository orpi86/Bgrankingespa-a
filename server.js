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
const CURRENT_SEASON_ID = 17; // La única que cambia
const MAX_PAGES_TO_SCAN = 400;

// --- ANTI-BLOQUEO BLIZZARD ---
const CONCURRENT_REQUESTS = 10;
const REQUEST_DELAY = 50;

// --- CONFIGURACIÓN DE CACHÉ ---
const CACHE_DURATION_CURRENT = 30 * 60 * 1000; // La temporada actual se actualiza cada 30 min
// Las temporadas pasadas NO tienen duración, son "infinitas"

const serverCache = {}; // Aquí guardaremos todo

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
    // Convertimos a número para asegurar comparaciones correctas
    const seasonToScan = parseInt(req.query.season) || CURRENT_SEASON_ID;
    const isCurrentSeason = (seasonToScan === CURRENT_SEASON_ID);

    // 1. LÓGICA DE CACHÉ INTELIGENTE
    const cachedSeason = serverCache[seasonToScan];
    
    let serveFromCache = false;

    if (cachedSeason) {
        if (!isCurrentSeason) {
            // Si es temporada PASADA, la caché sirve SIEMPRE (los datos no cambian)
            serveFromCache = true;
        } else {
            // Si es temporada ACTUAL, comprobamos si caducó (30 min)
            if (Date.now() - cachedSeason.timestamp < CACHE_DURATION_CURRENT) {
                serveFromCache = true;
            }
        }
    }

    if (serveFromCache) {
        console.log(`⚡ Sirviendo Season ${seasonToScan} desde CACHÉ (${isCurrentSeason ? 'Actual/Temporal' : 'Histórico/Fijo'})`);
        // IMPORTANTE: Aunque los datos sean viejos, chequeamos Twitch en tiempo real
        const finalData = await actualizarTwitchLive(cachedSeason.data);
        return res.json(finalData);
    }

    // 2. SI NO HAY CACHÉ, DESCARGAMOS DE BLIZZARD
    console.log(`🌐 Descargando Season ${seasonToScan} de Blizzard (Se guardará en memoria)...`);

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
        // Bucle de descarga con pausas (Anti-Ban)
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
            
            batchResponses.forEach(data => {
                if (!data || !data.leaderboard || !data.leaderboard.rows) return;
                data.leaderboard.rows.forEach(row => {
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

            // Pausa entre bloques
            if (i + CONCURRENT_REQUESTS <= MAX_PAGES_TO_SCAN) {
                await wait(REQUEST_DELAY);
            }
        }

        // Procesar y ordenar
        let finalResponse = results.map(p => ({
            battleTag: p.battleTag,
            rank: p.rank,
            rating: p.rating,
            found: p.found,
            twitchUser: p.twitchUser,
            isLive: false // Se actualiza abajo
        }));

        finalResponse.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });

        finalResponse.forEach((player, index) => player.spainRank = index + 1);

        // 3. GUARDAR EN CACHÉ
        serverCache[seasonToScan] = {
            timestamp: Date.now(),
            data: finalResponse
        };

        console.log(`✅ Season ${seasonToScan} guardada en memoria.`);

        // 4. AÑADIR INFO DE TWITCH (FRESCA) Y ENVIAR
        const dataWithTwitch = await actualizarTwitchLive(finalResponse);
        res.json(dataWithTwitch);

    } catch (error) {
        console.error("🚨 Error Servidor:", error.message);
        res.status(500).json({ error: "Error obteniendo datos" });
    }
});

// Función separada para consultar Twitch en tiempo real
async function actualizarTwitchLive(playersList) {
    // Si no hay jugadores con twitch, devolvemos la lista tal cual
    const twitchUsers = playersList.filter(r => r.twitchUser).map(r => r.twitchUser);
    if (twitchUsers.length === 0) return playersList;

    const token = await getTwitchToken();
    if (!token) return playersList;

    // Clonamos la lista para no modificar la "copia maestra" de la caché
    const updatedList = JSON.parse(JSON.stringify(playersList));

    try {
        const queryParams = new URLSearchParams();
        twitchUsers.forEach(user => queryParams.append('user_login', user));
        
        const twitchResp = await axios.get(`https://api.twitch.tv/helix/streams?${queryParams.toString()}`, {
            headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` }
        });

        const liveStreams = twitchResp.data.data;
        
        updatedList.forEach(player => {
            player.isLive = false; // Resetear estado
            if (player.twitchUser) {
                const isStreaming = liveStreams.some(s => s.user_login.toLowerCase() === player.twitchUser.toLowerCase());
                if (isStreaming) {
                    player.isLive = true;
                }
            }
        });
    } catch (e) {
        console.error("⚠️ Error consultando Twitch (se devolverán datos sin estado live):", e.message);
    }
    return updatedList;
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Servidor Optimizado en puerto ${PORT}`); });

