const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// --- CONFIGURACIÓN & ESTADO ---
const CONFIG_PATH = path.join(__dirname, 'seasons.json');
const CACHE_PATH = path.join(__dirname, 'cache.json');
let CONFIG = { currentSeason: 17, seasons: [] };

try {
    if (fs.existsSync(CONFIG_PATH)) {
        CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
} catch (e) {
    console.error("❌ Error cargando seasons.json:", e.message);
}

const REGION = 'EU';
const CURRENT_SEASON_ID = CONFIG.currentSeason;
const MAX_PAGES_TO_SCAN = 500;
const CONCURRENT_REQUESTS = 4;
const REQUEST_DELAY = 300;

// --- MEMORIA Y PERSISTENCIA ---
let memoriaCache = {};
const TIEMPO_CACHE_ACTUAL = 24 * 60 * 60 * 1000;

const loadCache = () => {
    try {
        if (fs.existsSync(CACHE_PATH)) {
            const data = fs.readFileSync(CACHE_PATH, 'utf8');
            memoriaCache = JSON.parse(data);
            console.log("📂 Cache cargada desde disco.");
        }
    } catch (e) {
        console.error("❌ Error cargando cache.json:", e.message);
    }
};

const saveCache = () => {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify(memoriaCache, null, 2));
        console.log("💾 Cache guardada en disco.");
    } catch (e) {
        console.error("❌ Error guardando cache.json:", e.message);
    }
};

loadCache();

const HISTORY_PATH = path.join(__dirname, 'history.json');
let historyData = {};

const loadHistory = () => {
    try {
        if (fs.existsSync(HISTORY_PATH)) {
            historyData = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
        }
    } catch (e) { console.error("Error cargando history:", e.message); }
};

const saveHistory = (currentData) => {
    const today = new Date().toISOString().split('T')[0];
    currentData.forEach(p => {
        if (!p.found) return;
        if (!historyData[p.battleTag]) historyData[p.battleTag] = [];
        const lastEntry = historyData[p.battleTag][historyData[p.battleTag].length - 1];
        if (!lastEntry || lastEntry.date !== today) {
            historyData[p.battleTag].push({ date: today, rating: p.rating, rank: p.rank });
        } else {
            lastEntry.rating = p.rating;
            lastEntry.rank = p.rank;
        }
    });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(historyData, null, 2));
};

loadHistory();

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

app.get('/api/seasons', (req, res) => {
    res.json(CONFIG);
});

app.get('/api/history', (req, res) => {
    const { player } = req.query;
    if (!player || !historyData[player]) return res.json([]);
    res.json(historyData[player]);
});

app.get('/api/ranking', async (req, res) => {
    const seasonToScan = parseInt(req.query.season) || CURRENT_SEASON_ID;
    const isCurrentSeason = (seasonToScan === CURRENT_SEASON_ID);

    console.log(`📡 Petición recibida para Season ${seasonToScan}`);

    // 1. REVISAR MEMORIA RAM
    const datosGuardados = memoriaCache[seasonToScan];
    let usarMemoria = false;

    if (datosGuardados) {
        if (!isCurrentSeason) {
            usarMemoria = true;
        } else {
            if (Date.now() - datosGuardados.timestamp < TIEMPO_CACHE_ACTUAL) {
                usarMemoria = true;
            }
        }
    }

    if (usarMemoria) {
        console.log(`⚡ Sirviendo desde CACHÉ.`);
        const dataWithTwitch = await actualizarTwitchLive(datosGuardados.data);
        return res.json(dataWithTwitch);
    }

    // 2. SI NO ESTÁ EN MEMORIA, DESCARGAR
    console.log(`🌐 Iniciando descarga profunda de Season ${seasonToScan}...`);

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
                    // --- CORRECCIÓN CLAVE PARA TEMPORADAS VIEJAS ---
                    // Buscamos 'accountid', 'battleTag' O 'name' (este último es el que usan las viejas)
                    const rawName = row.accountid || row.battleTag || row.name || "";
                    const blizzName = rawName.toString().toLowerCase();
                    
                    if (!blizzName) return;

                    results.forEach(player => {
                        if (player.found) return;

                        const targetName = player.nameOnly.toLowerCase();
                        const targetFull = player.fullTag.toLowerCase();

                        if (blizzName === targetName || blizzName === targetFull) {
                            console.log(`🎯 ¡Jugador encontrado!: ${player.battleTag} -> Rank ${row.rank} (${row.rating})`);
                            player.rank = row.rank;
                            player.rating = row.rating;
                            player.found = true;
                        }
                    });
                });
            });

            if (results.every(p => p.found)) {
                console.log("📍 Todos los jugadores encontrados. Parada segura.");
                break;
            }

            if (jugadoresEncontradosEnLote === 0) {
                console.log(`🛑 Fin de los datos en página ${i}. Parando escaneo.`);
                break;
            }

            await wait(REQUEST_DELAY);
        }

        // 3. PROCESAR RESULTADOS
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

        // 4. GUARDAR EN CACHÉ Y DISCO
        memoriaCache[seasonToScan] = {
            timestamp: Date.now(),
            data: finalResponse
        };
        saveCache();
        if (isCurrentSeason) saveHistory(finalResponse);

        const dataWithTwitch = await actualizarTwitchLive(finalResponse);
        const dataWithAchievements = calcularLogros(dataWithTwitch);
        res.json(dataWithAchievements);

    } catch (error) {
        console.error("🚨 Error Servidor:", error.message);
        res.status(500).json({ error: "Error inte


