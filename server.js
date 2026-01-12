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
    max: 300, // máximo 300 peticiones por minuto (Increased for testing)
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
let CURRENT_SEASON_ID = CONFIG.currentSeason;
const MAX_PAGES_TO_SCAN = 500;
const CONCURRENT_REQUESTS = 4;
const REQUEST_DELAY = 300;

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

    // Obtener timestamp de jugadores.json para invalidación de cache
    let playersMtime = 0;
    try {
        const stats = fs.statSync(path.join(__dirname, 'jugadores.json'));
        playersMtime = stats.mtimeMs;
    } catch (e) { }

    console.log(`📡 Petición recibida para Season ${seasonToScan}`);

    // 0. GESTIÓN DE TEMPORADAS PASADAS
    if (!isCurrentSeason && historicalData.seasons[seasonToScan]) {
        const currentPlayersList = loadPlayers();
        const historyPlayers = historicalData.seasons[seasonToScan];

        // Revisar si faltan jugadores nuevos añadidos recientemente a la lista
        const missing = currentPlayersList.filter(p => !historyPlayers.some(hp => hp.battleTag === p.battleTag));
        // const foundCount = historyPlayers.filter(hp => hp.found).length;

        // Solo re-escanear si faltan jugadores Y no hay uno en curso
        if (missing.length > 0 && !scansInProgress[seasonToScan]) {
            console.log(`♻️ Season ${seasonToScan}: Faltan ${missing.length} jugadores. Re-escaneando en background...`);
            scansInProgress[seasonToScan] = true;
            realizarEscaneoInterno(seasonToScan).finally(() => {
                delete scansInProgress[seasonToScan];
            });
        }

        // Devolver lo que tenemos inmediatamente
        const mergedResults = currentPlayersList.map(p => {
            const h = historyPlayers.find(hp => hp.battleTag === p.battleTag);
            if (h) return h;
            return {
                battleTag: p.battleTag, rank: null, rating: 'Sin datos', found: false,
                twitchUser: p.twitch || null, isLive: false, spainRank: 999
            };
        });

        mergedResults.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });
        mergedResults.forEach((p, i) => p.spainRank = i + 1);

        const dataWithAchievements = calcularLogros(mergedResults, seasonToScan);
        return res.json(dataWithAchievements);
    }

    // 1. GESTIÓN TEMPORADA ACTUAL (MEMORIA RAM)
    const datosGuardados = memoriaCache[seasonToScan];
    if (datosGuardados) {
        // Si hay datos, los servimos INMEDIATAMENTE (Estrategia: Stale-While-Revalidate)
        console.log(`⚡ Sirviendo ${seasonToScan} desde CACHÉ (Stale-While-Revalidate).`);
        res.json(calcularLogros(datosGuardados.data, seasonToScan));

        // VERIFICACIÓN ASÍNCRONA EN BACKGROUND
        const cacheExpired = (Date.now() - datosGuardados.timestamp > TIEMPO_CACHE_ACTUAL);
        const playersChanged = (datosGuardados.playersMtime !== playersMtime);

        if ((cacheExpired || playersChanged) && !scansInProgress[seasonToScan]) {
            console.log(`♻️ Background Update iniciada para Season ${seasonToScan}...`);
            scansInProgress[seasonToScan] = true;

            // NO usamos await aquí, dejamos que corra en background
            realizarEscaneoInterno(seasonToScan)
                .catch(err => console.error("Error en background update:", err))
                .finally(() => {
                    delete scansInProgress[seasonToScan];
                    console.log(`✅ Background Update completada para Season ${seasonToScan}.`);
                });
        }
        return; // Terminamos la request.
    }

    // 2. SI NO ESTÁ EN MEMORIA (Cache vacía), TOCA ESPERAR
    console.log(`🌐 Cache vacía para Season ${seasonToScan}. Iniciando descarga síncrona...`);

    try {
        scansInProgress[seasonToScan] = true;
        await realizarEscaneoInterno(seasonToScan);

        const datosRecienCargados = memoriaCache[seasonToScan];

        if (datosRecienCargados) {
            const dataWithAchievements = calcularLogros(datosRecienCargados.data, seasonToScan);
            return res.json(dataWithAchievements);
        } else {
            throw new Error("No se pudieron obtener datos tras el escaneo.");
        }

    } catch (error) {
        console.error("🚨 Error Servidor en endpoint:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        delete scansInProgress[seasonToScan];
    }
});

function calcularLogros(players, seasonId) {
    const isCurrent = (parseInt(seasonId) === CURRENT_SEASON_ID);
    return players.map(p => {
        const player = { ...p }; // Clone to avoid mutating source
        player.badges = [];

        // Solo mostrar medallas de desempeño si es la temporada actual o si queremos histórico
        // Por ahora, solo racha y en directo en la actual
        if (isCurrent) {
            const history = historyData[player.battleTag] || [];
            if (history.length >= 2) {
                const last = history[history.length - 1];
                const prev = history[history.length - 2];
                if (last.rating > prev.rating) player.badges.push({ type: 'fire', text: '🔥 En racha' });
            }
            if (player.isLive) player.badges.push({ type: 'stream', text: '📺 En Directo' });
        }

        // Logro: TOP 3 España
        if (player.spainRank <= 3) player.badges.push({ type: 'gold', text: '🏆 TOP 3' });

        // Logro: TOP 10 España
        else if (player.spainRank <= 10) player.badges.push({ type: 'silver', text: '🥈 TOP 10' });

        // Logro: MMR Alto (8000+)
        if (typeof player.rating === 'number' && player.rating >= 8000) {
            player.badges.push({ type: 'elite', text: '⭐ Elite 8k+' });
        }

        // Logro: TOP 100 EU
        if (player.found && player.rank <= 100) {
            player.badges.push({ type: 'eu', text: '🌍 TOP 100 EU' });
        }

        // Logro: TOP 500 EU
        else if (player.found && player.rank <= 500) {
            player.badges.push({ type: 'eu', text: '🌍 TOP 500 EU' });
        }
        return player;
    });
}

const persistentAvatarCache = new Map();

async function actualizarTwitchLive(playersList) {
    const updatedList = JSON.parse(JSON.stringify(playersList));
    const twitchPlayers = updatedList.filter(p => p.twitch || p.twitchUser);

    if (twitchPlayers.length === 0) return updatedList;

    const BATCH_SIZE = 5;
    for (let i = 0; i < twitchPlayers.length; i += BATCH_SIZE) {
        const batch = twitchPlayers.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (player) => {
            const username = player.twitch || player.twitchUser;
            player.twitchUser = username; // Asegurar link desde el principio

            try {
                const encodedUsr = encodeURIComponent(username);
                const [uptimeRes, avatarRes] = await Promise.all([
                    axios.get(`https://decapi.me/twitch/uptime/${encodedUsr}`, { timeout: 4000 }).catch(() => ({ data: 'offline' })),
                    axios.get(`https://decapi.me/twitch/avatar/${encodedUsr}`, { timeout: 4000 }).catch(() => ({ data: null }))
                ]);

                const uptimeLower = (uptimeRes.data || '').toLowerCase();
                player.isLive = uptimeLower.includes('hour') ||
                    uptimeLower.includes('minute') ||
                    uptimeLower.includes('second');

                // Lógica de Avatar con persistencia
                const newAvatar = avatarRes.data && avatarRes.data.startsWith('http') ? avatarRes.data : null;

                if (newAvatar) {
                    player.twitchAvatar = newAvatar;
                    persistentAvatarCache.set(username.toLowerCase(), newAvatar);
                } else {
                    // Si falla el fetch (null o error de DecAPI), intentar recuperar del cache persistente
                    player.twitchAvatar = persistentAvatarCache.get(username.toLowerCase()) || null;
                }

                if (player.isLive) console.log(`📺 ${username} está EN DIRECTO`);

            } catch (e) {
                console.error(`Error Twitch ${username}: ${e.message}`);
                player.isLive = false;
                // Fallback al cache incluso en error total
                player.twitchAvatar = persistentAvatarCache.get(username.toLowerCase()) || null;
            }
        }));

        // Pequeña pausa entre batches para no saturar DecAPI
        if (i + BATCH_SIZE < twitchPlayers.length) {
            await new Promise(r => setTimeout(r, 300));
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

    // 2. GESTIONAR TEMPORADAS PASADAS (Backfill inteligente en segundo plano)
    verificarIntegridadTemporadas().then(() => {
        console.log("✅ Integridad de temporadas pasadas verificada.");
    });

    console.log("✅ Servidor listo para recibir peticiones.");

    // 3. WATCHER PARA JUGADORES.JSON
    let watchTimeout;
    fs.watch(path.join(__dirname, 'jugadores.json'), (eventType) => {
        if (eventType === 'change') {
            if (watchTimeout) clearTimeout(watchTimeout);
            watchTimeout = setTimeout(async () => {
                console.log("♻️ Detectado cambio en jugadores.json. Sincronizando datos...");
                loadPlayers(); // Recargar lista ram

                // 1. Integridad de historial (Targeted scan para nuevos)
                await verificarIntegridadTemporadas();

                // 2. Refresh completo Season Actual
                console.log("🔄 Refrescando Season Actual...");
                delete memoriaCache[CURRENT_SEASON_ID];
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

    // Detectar nueva temporada cada hora
    setInterval(detectarNuevaTemporada, 60 * 60 * 1000);
    // Y al iniciar
    await detectarNuevaTemporada();

    setTimeout(async function escaneoProgamado() {
        console.log("🌅 Ejecutando escaneo diario programado (SOLO TEMPORADA ACTUAL)...");

        // Solo escaneamos la actual.
        delete memoriaCache[CURRENT_SEASON_ID];
        await realizarEscaneoInterno(CURRENT_SEASON_ID);

        // Re-programar para mañana
        setTimeout(escaneoProgamado, 24 * 60 * 60 * 1000);
    }, tiempoHastaEscaneo);
});

// Función interna para escaneo sin necesidad de request HTTP
async function realizarEscaneoInterno(seasonId, maxPages = MAX_PAGES_TO_SCAN, targetPlayers = null) {
    const isTargeted = Array.isArray(targetPlayers) && targetPlayers.length > 0;
    const logPrefix = isTargeted ? `[TargetScan S${seasonId}]` : `[FullScan S${seasonId}]`;

    console.log(`${logPrefix} Iniciando. Profundidad: ${maxPages} páginas. Targets: ${isTargeted ? targetPlayers.join(', ') : 'TODOS'}`);

    const allPlayers = loadPlayers();
    let playersToScan = [];

    if (isTargeted) {
        // Solo clonamos los jugadores que buscamos
        playersToScan = allPlayers.filter(p => targetPlayers.includes(p.battleTag)).map(p => ({ ...p }));
    } else {
        playersToScan = allPlayers.map(p => ({ ...p }));
    }

    // Inicializar resultados con los jugadores a escanear
    let results = playersToScan.map(p => ({
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
        for (let i = 1; i <= maxPages; i += CONCURRENT_REQUESTS) {
            const batchPromises = [];
            for (let j = i; j < i + CONCURRENT_REQUESTS && j <= maxPages; j++) {
                batchPromises.push(
                    axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${j}&seasonId=${seasonId}`, { timeout: 15000 })
                        .then(r => r.data)
                        .catch((err) => {
                            console.error(`❌ Error Interno en pag ${j} S${seasonId}: ${err.message}`);
                            return null;
                        })
                );
            }
            const batchResponses = await Promise.all(batchPromises);
            let encontradosEnBatch = 0;
            let rowsInBatch = 0;

            batchResponses.forEach(data => {
                if (!data || !data.leaderboard || !data.leaderboard.rows) return;
                const rows = data.leaderboard.rows;
                if (rows.length > 0) rowsInBatch += rows.length;

                rows.forEach(row => {
                    const blizzName = (row.accountid || row.battleTag || "").toString().toLowerCase();
                    if (!blizzName) return;

                    results.forEach(player => {
                        if (player.found) return;
                        const targetName = player.nameOnly.toLowerCase();
                        const targetFull = player.fullTag.toLowerCase();

                        if (blizzName === targetName || blizzName === targetFull) {
                            console.log(`${logPrefix} Encontrado ${player.battleTag} -> Rank ${row.rank}`);
                            player.rank = row.rank;
                            player.rating = row.rating;
                            player.found = true;
                            encontradosEnBatch++;
                        }
                    });
                });
            });

            // PARADA 1: Todos los objetivos encontrados
            if (results.every(p => p.found)) {
                console.log(`${logPrefix} ✅ Todos los objetivos encontrados. Break.`);
                break;
            }

            // PARADA 2: Fin de datos
            if (rowsInBatch === 0) {
                console.log(`${logPrefix} 🛑 Blizzard no devolvió más filas. Break.`);
                break;
            }

            if (i % 80 === 1) console.log(`${logPrefix} Procesadas ${i} páginas...`);
            await wait(REQUEST_DELAY);
        }

        // FUSIONAR RESULTADOS
        let finalMergedData = [];

        if (isTargeted) {
            let previousData = [];
            if (seasonId === CURRENT_SEASON_ID) {
                if (memoriaCache[seasonId]) previousData = memoriaCache[seasonId].data;
            } else {
                if (historicalData.seasons[seasonId]) previousData = historicalData.seasons[seasonId];
            }

            // Formatear resultados nuevos
            const newResultsFormatted = results.map(p => ({
                battleTag: p.battleTag, rank: p.rank, rating: p.rating, found: p.found, twitchUser: p.twitchUser, isLive: false
            }));

            // Mapa de nuevos resultados
            const resultMap = new Map(newResultsFormatted.map(p => [p.battleTag, p]));

            // 1. Mantener antiguos (actualizando si hay coincidencia)
            finalMergedData = previousData.map(oldP => {
                if (resultMap.has(oldP.battleTag)) {
                    const updated = resultMap.get(oldP.battleTag);
                    resultMap.delete(oldP.battleTag);
                    return updated;
                }
                return oldP;
            });

            // 2. Añadir los puramente nuevos
            resultMap.forEach(val => finalMergedData.push(val));

        } else {
            // Full Scan: sobrescribir
            finalMergedData = results.map(p => ({
                battleTag: p.battleTag, rank: p.rank, rating: p.rating, found: p.found, twitchUser: p.twitchUser, isLive: false
            }));
        }

        // Re-ranking (siempre re-calcular SpainRank)
        finalMergedData.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });
        finalMergedData.forEach((player, index) => player.spainRank = index + 1);

        // Guardar
        memoriaCache[seasonId] = { timestamp: Date.now(), data: finalMergedData };
        saveCache();

        if (seasonId !== CURRENT_SEASON_ID) {
            historicalData.seasons[seasonId] = finalMergedData; // También guardamos el merged en historial
            saveHistoricalData();
            console.log(`${logPrefix} Datos fusionados y guardados en Histórico.`);
        }

        if (seasonId === CURRENT_SEASON_ID) saveHistory(finalMergedData);
        console.log(`${logPrefix} Completado con éxito.`);

    } catch (e) {
        console.error(`🚨 Error en escaneo (${logPrefix}):`, e.message);
    }
}

async function verificarIntegridadTemporadas() {
    console.log("🔍 Verificando integridad de temporadas pasadas...");
    const currentPlayersList = loadPlayers();
    const allBattleTags = currentPlayersList.map(p => p.battleTag);

    for (const season of CONFIG.seasons) {
        if (season.id === CURRENT_SEASON_ID) continue; // Skip actual

        const historyPlayers = historicalData.seasons[season.id];

        if (!historyPlayers) {
            console.log(`📜 Season ${season.id} VACÍA. Iniciando escaneo COMPLETO.`);
            await realizarEscaneoInterno(season.id);
            continue;
        }

        const missingTags = allBattleTags.filter(bt => !historyPlayers.some(hp => hp.battleTag === bt));

        if (missingTags.length > 0) {
            console.log(`♻️ Season ${season.id}: Detectados ${missingTags.length} jugadores nuevos. Escaneando SOLO a ellos...`);
            await realizarEscaneoInterno(season.id, MAX_PAGES_TO_SCAN, missingTags);
        }
    }
    console.log("✅ Integridad verificada.");
}

async function detectarNuevaTemporada() {
    console.log("🔍 Buscando cambios de temporada en Blizzard API...");
    try {
        // Consultar la página 1 de la temporada actual + 1 para ver si ya hay datos
        const nextSeasonId = CURRENT_SEASON_ID + 1;
        const url = `https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=1&seasonId=${nextSeasonId}`;
        const response = await axios.get(url, { timeout: 10000 });

        if (response.data && response.data.leaderboard && response.data.leaderboard.rows && response.data.leaderboard.rows.length > 0) {
            console.log(`✨ ¡NUEVA TEMPORADA DETECTADA!: Season ${nextSeasonId}`);

            // 1. Antes de cambiar, nos aseguramos de que la temporada que "termina" esté bien cacheada en históricos
            console.log(`📦 Archivando temporada ${CURRENT_SEASON_ID} en datos históricos...`);
            await realizarEscaneoInterno(CURRENT_SEASON_ID);

            // 2. Actualizar configuración
            const oldSeasonName = `Temporada ${CURRENT_SEASON_ID - 5}`; // Siguiendo el mapeo T.12 = ID 17
            const newSeasonNum = CURRENT_SEASON_ID - 5 + 1;

            CONFIG.currentSeason = nextSeasonId;
            CONFIG.seasons.unshift({
                id: nextSeasonId,
                name: `T. ${newSeasonNum} (Actual)`
            });

            // Actualizar el nombre de la que era "Actual"
            const prevSeason = CONFIG.seasons.find(s => s.id === CURRENT_SEASON_ID);
            if (prevSeason) prevSeason.name = `Temporada ${newSeasonNum - 1}`;

            CURRENT_SEASON_ID = nextSeasonId;

            // 3. Guardar seasons.json
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(CONFIG, null, 2));
            console.log("📝 seasons.json actualizado.");

            // 4. Iniciar escaneo de la nueva temporada
            await realizarEscaneoInterno(nextSeasonId);
            console.log(`✅ Transición a Season ${nextSeasonId} completada.`);
        } else {
            console.log("✅ Sin cambios de temporada detectados.");
        }
    } catch (e) {
        console.error("❌ Error al detectar nueva temporada:", e.message);
    }
}
