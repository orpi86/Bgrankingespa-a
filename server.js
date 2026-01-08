const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1); // Confiar en el proxy de Render para express-rate-limit

// --- MIDDLEWARE DE SEGURIDAD Y RENDIMIENTO ---
app.use(compression()); // Compresión gzip para respuestas
app.use(cors());

// Rate limiting para evitar abuso de API
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 60, // máximo 60 peticiones por minuto
    message: { error: 'Demasiadas peticiones. Espera un momento.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);

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
const MAX_PAGES_TO_SCAN = 500; // Aumentado a 500 para escaneo profundo
const CONCURRENT_REQUESTS = 4; // Reducido para evitar rate limiting
const REQUEST_DELAY = 300;     // Más delay para evitar bloqueos de API

// --- MEMORIA Y PERSISTENCIA ---
let memoriaCache = {};
const TIEMPO_CACHE_ACTUAL = 10 * 60 * 1000; // Cache válida por 10 minutos (Temporada actual)

// --- DATOS HISTÓRICOS (BBDD local para temporadas pasadas) ---
const HISTORICAL_PATH = path.join(__dirname, 'historical_data.json');
let historicalData = { seasons: {} };
let scansInProgress = {}; // Track active season scans
let twitchHydrationCache = { timestamp: 0, data: null };
const TWITCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

const loadHistoricalData = () => {
    try {
        if (fs.existsSync(HISTORICAL_PATH)) {
            historicalData = JSON.parse(fs.readFileSync(HISTORICAL_PATH, 'utf8'));
            console.log(`📚 Datos históricos cargados (${Object.keys(historicalData.seasons).length} temporadas)`);
        }
    } catch (e) {
        console.error("❌ Error cargando historical_data.json:", e.message);
    }
};

const saveHistoricalData = () => {
    try {
        historicalData.lastUpdate = new Date().toISOString().split('T')[0];
        fs.writeFileSync(HISTORICAL_PATH, JSON.stringify(historicalData, null, 2));
        console.log("📚 Datos históricos guardados en disco.");
    } catch (e) {
        console.error("❌ Error guardando historical_data.json:", e.message);
    }
};

// Cargar datos históricos al iniciar
loadHistoricalData();

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

// Cargar cache al iniciar
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
let playersCache = { mtime: 0, data: [] };

const loadPlayers = () => {
    try {
        const filePath = path.join(__dirname, 'jugadores.json');
        const stats = fs.statSync(filePath);

        if (playersCache.mtime === stats.mtimeMs) {
            return playersCache.data;
        }

        const players = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Deduplicar por battleTag
        const unique = [];
        const seen = new Set();
        players.forEach(p => {
            const bt = p.battleTag.trim();
            if (!seen.has(bt)) {
                seen.add(bt);
                unique.push(p);
            }
        });

        playersCache = { mtime: stats.mtimeMs, data: unique };
        return unique;
    } catch (e) {
        console.error("❌ Error leyendo jugadores.json:", e.message);
        return playersCache.data || [];
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

// Endpoint para obtener las temporadas configuradas
app.get('/api/seasons', (req, res) => {
    res.json(CONFIG);
});

app.get('/api/player-summary', (req, res) => {
    const { player } = req.query;
    if (!player) return res.status(400).json({ error: "Falta el player" });

    const summary = {
        historical: [],
        peak: 0,
        current: null
    };

    // 1. Buscar en BBDD histórica
    Object.keys(historicalData.seasons).forEach(sId => {
        const players = historicalData.seasons[sId];
        const pData = players.find(p => p.battleTag === player);
        if (pData && pData.found) {
            summary.historical.push({
                seasonId: sId,
                rank: pData.rank,
                spainRank: pData.spainRank,
                rating: pData.rating
            });
            if (pData.rating > summary.peak) summary.peak = pData.rating;
        }
    });

    // 2. Buscar en Cache (incluye actual)
    Object.keys(memoriaCache).forEach(sId => {
        const pData = memoriaCache[sId].data.find(p => p.battleTag === player);
        if (pData && pData.found) {
            if (pData.rating > summary.peak) summary.peak = pData.rating;
            if (parseInt(sId) === CURRENT_SEASON_ID) {
                summary.current = pData;
            }
        }
    });

    res.json(summary);
});

app.get('/api/history', (req, res) => {
    const { player } = req.query;
    if (!player || !historyData[player]) return res.json([]);
    res.json(historyData[player]);
});

app.get('/api/twitch-hydrate', async (req, res) => {
    // Usar cache para no saturar DecAPI se hay muchas peticiones simultáneas
    if (twitchHydrationCache.data && (Date.now() - twitchHydrationCache.timestamp < TWITCH_CACHE_TTL)) {
        return res.json(twitchHydrationCache.data);
    }

    const playersList = loadPlayers();
    const dataWithTwitch = await actualizarTwitchLive(playersList);
    const hydration = dataWithTwitch.map(p => ({
        battleTag: p.battleTag,
        isLive: p.isLive,
        twitchAvatar: p.twitchAvatar,
        twitchUser: p.twitchUser || p.twitch // Fallback vital
    }));

    twitchHydrationCache = { timestamp: Date.now(), data: hydration };
    res.json(hydration);
});

app.get('/api/ranking', async (req, res) => {
    const seasonToScan = parseInt(req.query.season) || CURRENT_SEASON_ID;
    const isCurrentSeason = (seasonToScan === CURRENT_SEASON_ID);

    console.log(`📡 Petición recibida para Season ${seasonToScan}`);

    // 0. PARA TEMPORADAS PASADAS: Usar datos históricos (BBDD local) + Backfill On-demand
    if (!isCurrentSeason && historicalData.seasons[seasonToScan]) {
        const currentPlayersList = loadPlayers();
        const historyPlayers = historicalData.seasons[seasonToScan];
        const missing = currentPlayersList.filter(p => !historyPlayers.some(hp => hp.battleTag === p.battleTag));

        if (missing.length > 0 && !scansInProgress[seasonToScan]) {
            console.log(`♻️ Detectado que faltan ${missing.length} jugadores en Season ${seasonToScan}. Lanzando re-escaneo en segundo plano...`);
            scansInProgress[seasonToScan] = true;
            realizarEscaneoInterno(seasonToScan).finally(() => {
                delete scansInProgress[seasonToScan];
            });
        }

        // Combinar datos históricos con placeholders para los que faltan
        const mergedResults = currentPlayersList.map(p => {
            const foundInHistory = historyPlayers.find(hp => hp.battleTag === p.battleTag);
            if (foundInHistory) return foundInHistory;
            return {
                battleTag: p.battleTag,
                rank: null,
                rating: scansInProgress[seasonToScan] ? 'Actualizando...' : 'Sin datos',
                found: false,
                twitchUser: p.twitch || null,
                isLive: false,
                spainRank: 999
            };
        });

        // Re-ordenar y re-calcular spainRank
        mergedResults.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });
        mergedResults.forEach((p, i) => p.spainRank = i + 1);

        console.log(`📚 Sirviendo Season ${seasonToScan} (datos combinados).`);
        const dataWithAchievements = calcularLogros(mergedResults);
        return res.json(dataWithAchievements);
    }

    // 1. REVISAR MEMORIA RAM & FILE TIMESTAMP
    const datosGuardados = memoriaCache[seasonToScan];
    let usarMemoria = false;

    // Check jugadors.json modification time
    let playersMtime = 0;
    try {
        const stats = fs.statSync(path.join(__dirname, 'jugadores.json'));
        playersMtime = stats.mtimeMs;
    } catch (e) { console.error("Error checking players file:", e); }

    if (datosGuardados) {
        // If players file changed, invalidate cache immediately
        if (datosGuardados.playersMtime !== playersMtime) {
            console.log("♻️ Detectado cambio en jugadores.json. Invalidando caché.");
            usarMemoria = false;
        }
        else if (!isCurrentSeason) {
            usarMemoria = true;
        } else {
            // FORCE REFRESH: By-pass cache once to fix twitch links
            // if (Date.now() - datosGuardados.timestamp < TIEMPO_CACHE_ACTUAL) {
            //     usarMemoria = true;
            // }
            usarMemoria = false;
        }
    }

    if (usarMemoria) {
        console.log(`⚡ Sirviendo desde CACHÉ.`);
        const dataWithAchievements = calcularLogros(datosGuardados.data);
        return res.json(dataWithAchievements);
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
        rating: 'Sin datos', // Valor por defecto cuando no se encuentra
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
                    // Blizzard usa accountid o battleTag de forma inconsistente
                    const blizzName = (row.accountid || row.battleTag || "").toString().toLowerCase();
                    if (!blizzName) return;

                    results.forEach(player => {
                        if (player.found) return;

                        const targetName = player.nameOnly.toLowerCase();
                        const targetFull = player.fullTag.toLowerCase();

                        // Match exacto con el nombre o con el tag completo
                        if (blizzName === targetName || blizzName === targetFull) {
                            console.log(`🎯 ¡Jugador encontrado!: ${player.battleTag} -> Rank ${row.rank} (${row.rating})`);
                            player.rank = row.rank;
                            player.rating = row.rating;
                            player.found = true;
                        }
                    });
                });
            });

            // PARADA SEGURA: Si ya encontramos a todos los de la lista, no seguimos escaneando
            if (results.every(p => p.found)) {
                console.log("📍 Todos los jugadores encontrados. Parada segura.");
                break;
            }

            // Si Blizzard nos devuelve páginas vacías, paramos.
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
            playersMtime: playersMtime, // Guardamos timestamp del fichero
            data: finalResponse
        };
        saveCache();

        // Para temporadas PASADAS: Guardar en BBDD histórica permanente
        if (!isCurrentSeason) {
            historicalData.seasons[seasonToScan] = finalResponse;
            saveHistoricalData();
            console.log(`📚 Season ${seasonToScan} guardada en BBDD histórica (no se descargará de nuevo).`);
        }

        if (isCurrentSeason) saveHistory(finalResponse);

        // 5. ENVIAR SIN ESPERAR A TWITCH
        const dataWithAchievements = calcularLogros(finalResponse);
        res.json(dataWithAchievements);

    } catch (error) {
        console.error("🚨 Error Servidor:", error.message);
        res.status(500).json({ error: "Error interno" });
    }
});

function calcularLogros(players) {
    return players.map(p => {
        p.badges = [];
        const history = historyData[p.battleTag] || [];

        // Logro: En racha (subiendo MMR)
        if (history.length >= 2) {
            const last = history[history.length - 1];
            const prev = history[history.length - 2];
            if (last.rating > prev.rating) p.badges.push({ type: 'fire', text: '🔥 En racha' });
        }

        // Logro: Streamer en vivo
        if (p.isLive) p.badges.push({ type: 'stream', text: '📺 En Directo' });

        // Logro: TOP 3 España
        if (p.spainRank <= 3) p.badges.push({ type: 'gold', text: '🏆 TOP 3' });

        // Logro: TOP 10 España
        else if (p.spainRank <= 10) p.badges.push({ type: 'silver', text: '🥈 TOP 10' });

        // Logro: MMR Alto (8000+)
        if (typeof p.rating === 'number' && p.rating >= 8000) {
            p.badges.push({ type: 'elite', text: '⭐ Elite 8k+' });
        }

        // Logro: TOP 100 EU
        if (p.found && p.rank <= 100) {
            p.badges.push({ type: 'eu', text: '🌍 TOP 100 EU' });
        }

        // Logro: TOP 500 EU
        else if (p.found && p.rank <= 500) {
            p.badges.push({ type: 'eu', text: '🌍 TOP 500 EU' });
        }

        return p;
    });
}

async function actualizarTwitchLive(playersList) {
    const updatedList = JSON.parse(JSON.stringify(playersList));
    const twitchPlayers = updatedList.filter(p => p.twitch || p.twitchUser);

    if (twitchPlayers.length === 0) return updatedList;

    // Procesamos de forma secuencial para máxima estabilidad y evitar rate limits
    for (const player of twitchPlayers) {
        const username = player.twitch || player.twitchUser;
        player.twitchUser = username; // Asegurar link desde el principio

        try {
            const [uptimeRes, avatarRes] = await Promise.all([
                axios.get(`https://decapi.me/twitch/uptime/${username}`, { timeout: 3000 }).catch(() => ({ data: 'offline' })),
                axios.get(`https://decapi.me/twitch/avatar/${username}`, { timeout: 3000 }).catch(() => ({ data: null }))
            ]);

            const uptimeLower = uptimeRes.data.toLowerCase();
            const isLive = uptimeLower.includes('hour') ||
                uptimeLower.includes('minute') ||
                uptimeLower.includes('second');

            player.isLive = isLive;
            player.twitchAvatar = avatarRes.data && avatarRes.data.startsWith('http') ? avatarRes.data : null;

            if (player.isLive) console.log(`📺 ${username} está EN DIRECTO`);

            // Pequeña pausa de cortesía entre peticiones
            await new Promise(r => setTimeout(r, 200));

        } catch (e) {
            console.error(`Error Twitch ${username}: ${e.message}`);
            player.isLive = false;
            player.twitchAvatar = null;
        }
    }

    return updatedList;
}

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// Endpoint para forzar refresh manual (solo temporada actual)
app.get('/api/force-refresh', async (req, res) => {
    console.log("🔄 Refresh manual solicitado (solo temporada actual)...");
    try {
        delete memoriaCache[CURRENT_SEASON_ID];
        await realizarEscaneoInterno(CURRENT_SEASON_ID);
        res.json({ success: true, message: "Temporada actual refrescada" });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Endpoint para poblar TODAS las temporadas históricas (usar una sola vez)
app.get('/api/populate-history', async (req, res) => {
    console.log("📚 Poblando BBDD histórica con todas las temporadas pasadas...");
    try {
        const results = [];
        for (const season of CONFIG.seasons) {
            // Skip temporada actual
            if (season.id === CURRENT_SEASON_ID) {
                results.push({ id: season.id, name: season.name, status: 'skipped (current)' });
                continue;
            }
            // Skip si ya existe en históricos
            if (historicalData.seasons[season.id]) {
                results.push({ id: season.id, name: season.name, status: 'already exists' });
                continue;
            }
            // Escanear y guardar
            console.log(`📡 Escaneando ${season.name}...`);
            await realizarEscaneoInterno(season.id);
            results.push({ id: season.id, name: season.name, status: 'populated' });
        }
        res.json({ success: true, message: "BBDD histórica poblada", results });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Servidor con Persistencia en puerto ${PORT}`);

    // 1. GESTIONAR TEMPORADA ACTUAL
    const cacheValida = memoriaCache[CURRENT_SEASON_ID] &&
        (Date.now() - memoriaCache[CURRENT_SEASON_ID].timestamp < TIEMPO_CACHE_ACTUAL);

    if (!cacheValida) {
        console.log("⚡ Cache actual vacía o expirada. Escaneando Season Actual...");
        await realizarEscaneoInterno(CURRENT_SEASON_ID);
    } else {
        console.log("✅ Cache actual válida. Usando datos existentes.");
    }

    // 2. GESTIONAR TEMPORADAS PASADAS (Backfill inteligente)
    await verificarIntegridadTemporadas();

    console.log("✅ Sistema de Taberna listo y cargado.");

    // 3. WATCHER PARA JUGADORES.JSON
    let watchTimeout;
    fs.watch(path.join(__dirname, 'jugadores.json'), (eventType) => {
        if (eventType === 'change') {
            if (watchTimeout) clearTimeout(watchTimeout);
            watchTimeout = setTimeout(async () => {
                console.log("♻️ Detectado cambio en jugadores.json. Actualizando datos...");
                loadPlayers(); // Forzar recarga de lista de jugadores
                delete memoriaCache[CURRENT_SEASON_ID]; // Invalidar cache actual
                await verificarIntegridadTemporadas(); // Sincronizar históricos
                // También escanear temporada actual
                await realizarEscaneoInterno(CURRENT_SEASON_ID);
                console.log("✅ Sincronización tras cambio completada.");
            }, 1000);
        }
    });

    // Programar escaneo diario a las 6:00 AM
    const ahora = new Date();
    const proximoEscaneo = new Date();
    proximoEscaneo.setHours(6, 0, 0, 0);
    if (proximoEscaneo <= ahora) {
        proximoEscaneo.setDate(proximoEscaneo.getDate() + 1);
    }
    const tiempoHastaEscaneo = proximoEscaneo - ahora;
    console.log(`⏰ Próximo escaneo automático programado para las 6:00 AM (en ${Math.round(tiempoHastaEscaneo / 3600000)}h)`);

    setTimeout(async function escaneoProgamado() {
        console.log("🌅 Ejecutando escaneo diario programado...");
        for (const season of CONFIG.seasons) {
            delete memoriaCache[season.id];
            await realizarEscaneoInterno(season.id);
        }
        // Re-programar para mañana
        setTimeout(escaneoProgamado, 24 * 60 * 60 * 1000);
    }, tiempoHastaEscaneo);
});

// Función interna para escaneo sin necesidad de request HTTP
async function realizarEscaneoInterno(seasonId) {
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
                    axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${j}&seasonId=${seasonId}`)
                        .then(r => r.data).catch(() => null)
                );
            }
            const batchResponses = await Promise.all(batchPromises);
            let encontrados = 0;
            batchResponses.forEach(data => {
                if (!data || !data.leaderboard || !data.leaderboard.rows) return;
                const rows = data.leaderboard.rows;
                if (rows.length > 0) encontrados += rows.length;
                rows.forEach(row => {
                    const blizzName = (row.accountid || row.battleTag || "").toString().toLowerCase();
                    if (!blizzName) return;

                    results.forEach(player => {
                        if (player.found) return;
                        const targetName = player.nameOnly.toLowerCase();
                        const targetFull = player.fullTag.toLowerCase();

                        if (blizzName === targetName || blizzName === targetFull) {
                            console.log(`[StartupScan] Encontrado ${player.battleTag} en S${seasonId} (Rank ${row.rank})`);
                            player.rank = row.rank;
                            player.rating = row.rating;
                            player.found = true;
                        }
                    });
                });
            });

            if (results.every(p => p.found)) break;

            if (encontrados === 0) break;
            if (i % 80 === 1) console.log(`[StartupScan] Temporada ${seasonId}: Procesadas ${i} páginas...`);
            await wait(REQUEST_DELAY);
        }

        let finalResponse = results.map(p => ({
            battleTag: p.battleTag, rank: p.rank, rating: p.rating, found: p.found, twitchUser: p.twitchUser, isLive: false
        }));

        finalResponse.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });

        finalResponse.forEach((player, index) => player.spainRank = index + 1);

        memoriaCache[seasonId] = { timestamp: Date.now(), data: finalResponse };
        saveCache();

        // Guardar en BBDD histórica para temporadas pasadas
        if (seasonId !== CURRENT_SEASON_ID) {
            historicalData.seasons[seasonId] = finalResponse;
            saveHistoricalData();
            console.log(`📚 Season ${seasonId} guardada en BBDD histórica.`);
        }

        if (seasonId === CURRENT_SEASON_ID) saveHistory(finalResponse);
        console.log(`✅ Escaneo de Season ${seasonId} completado con éxito.`);
    } catch (e) {
        console.error("🚨 Error en escaneo inicial:", e.message);
    }
}

async function verificarIntegridadTemporadas() {
    console.log("🔍 Verificando integridad de temporadas pasadas...");
    const currentPlayersList = loadPlayers();

    for (const season of CONFIG.seasons) {
        if (season.id === CURRENT_SEASON_ID) continue;

        let needsScan = false;
        const exists = !!historicalData.seasons[season.id];

        if (!exists) {
            console.log(`📜 Season ${season.id} no existe en histórico. Programando escaneo.`);
            needsScan = true;
        } else {
            const historyPlayers = historicalData.seasons[season.id];
            const missing = currentPlayersList.filter(p => !historyPlayers.some(hp => hp.battleTag === p.battleTag));

            if (missing.length > 0) {
                console.log(`♻️ Season ${season.id}: Faltan ${missing.length} jugadores. Re-escaneando temporada completa.`);
                needsScan = true;
            }
        }

        if (needsScan) {
            console.log(`📡 Iniciando Backfill para Season ${season.id}...`);
            await realizarEscaneoInterno(season.id);

            const updatedHistory = historicalData.seasons[season.id];
            if (updatedHistory) {
                const stillMissing = currentPlayersList.filter(p => !updatedHistory.some(hp => hp.battleTag === p.battleTag));
                if (stillMissing.length > 0) {
                    console.warn(`⚠️ Season ${season.id}: Aún faltan ${stillMissing.length} jugadores tras escaneo. Marcando como "Sin datos".`);
                    stillMissing.forEach(sm => {
                        updatedHistory.push({
                            battleTag: sm.battleTag,
                            rank: null,
                            rating: 'Sin datos',
                            found: false,
                            twitchUser: sm.twitch || null,
                            isLive: false,
                            spainRank: 999
                        });
                    });
                    saveHistoricalData();
                } else {
                    console.log(`✅ Season ${season.id} completada.`);
                }
            }
        }
    }
}



