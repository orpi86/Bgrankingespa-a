const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const { User, News, Forum, Player } = require('./models');

const app = express();
app.set('trust proxy', 1); // Confiar en el proxy de Render para express-rate-limit

// --- MIDDLEWARE DE SEGURIDAD Y RENDIMIENTO ---
app.use(compression()); // Compresión gzip para respuestas
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session Setup
app.use(session({
    secret: 'hearthstone-ranking-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

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

// --- CONEXIÓN MONGODB ---
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000, // No esperar más de 5s si falla
        socketTimeoutMS: 45000,
    })
        .then(() => console.log("🚀 Conectado a MongoDB Atlas"))
        .catch(err => {
            console.error("❌ Error conectando a MongoDB:", err.message);
            console.log("⚠️ Fallback: Usando archivos JSON locales por error de conexión.");
        });
} else {
    console.warn("⚠️ MONGODB_URI no detectada. Usando JSON (Modo temporal)");
}

// Global Error Handling to prevent crashes from bringing down the service without logs
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

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

const loadPlayers = async () => {
    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        try {
            const players = await Player.find();
            return players.map(p => ({ battleTag: p.battleTag, twitch: p.twitch }));
        } catch (e) {
            console.error("❌ Error leyendo jugadores de MongoDB:", e.message);
        }
    }

    // Fallback to JSON
    try {
        const filePath = path.join(__dirname, 'jugadores.json');
        if (!fs.existsSync(filePath)) return [];

        const stats = fs.statSync(filePath);
        if (playersCache.mtime === stats.mtimeMs) {
            return playersCache.data;
        }

        const players = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

async function ensurePlayerInRanking(battleTag, twitch = null) {
    if (!battleTag) return;

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        try {
            const player = await Player.findOne({ battleTag: { $regex: new RegExp(`^${battleTag}$`, 'i') } });
            if (!player) {
                await Player.create({ battleTag, twitch });
                console.log(`✅ Jugador auto-añadido a MongoDB: ${battleTag} (Twitch: ${twitch})`);
            } else if (twitch && player.twitch !== twitch) {
                player.twitch = twitch;
                await player.save();
                console.log(`🔄 Twitch actualizado para ${battleTag}: ${twitch}`);
            }
            return;
        } catch (e) {
            console.error("Error en ensurePlayerInRanking (Mongo):", e.message);
        }
    }

    // Fallback to JSON
    try {
        let players = [];
        if (fs.existsSync(PLAYERS_PATH)) {
            players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
        }
        const index = players.findIndex(p => p.battleTag.toLowerCase() === battleTag.toLowerCase());
        if (index === -1) {
            players.push({ battleTag, twitch });
            fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2));
            console.log(`✅ Jugador auto-añadido al ranking JSON: ${battleTag}`);
        } else if (twitch && players[index].twitch !== twitch) {
            players[index].twitch = twitch;
            fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2));
            console.log(`🔄 Twitch actualizado JSON para ${battleTag}`);
        }
    } catch (e) {
        console.error("Error en ensurePlayerInRanking (JSON):", e.message);
    }
}

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

// --- DATA MANAGERS ---
const DATA_DIR = path.join(__dirname, 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const NEWS_PATH = path.join(DATA_DIR, 'news.json');
const FORUM_PATH = path.join(DATA_DIR, 'forum.json');
const COMPOS_PATH = path.join(DATA_DIR, 'compos.json');
const PLAYERS_PATH = path.join(__dirname, 'jugadores.json');

// ...

// --- COMPOS API ---




function loadJson(path) {
    try {
        if (fs.existsSync(path)) return JSON.parse(fs.readFileSync(path, 'utf8'));
    } catch (e) {
        console.error(`Error loading ${path}:`, e.message);
    }
    return [];
}

function saveJson(path, data) {
    try {
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Error saving ${path}:`, e.message);
    }
}

// --- MIDDLEWARE AUTH ---
function isAuthenticated(req, res, next) {
    if (req.session.user) next();
    else res.status(401).json({ error: 'No autorizado' });
}

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') next();
    else res.status(403).json({ error: 'Requiere permiso de Admin' });
}

function isEditor(req, res, next) {
    if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'editor')) next();
    else res.status(403).json({ error: 'Requiere permiso de Editor' });
}

function isMod(req, res, next) {
    if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'mod')) next();
    else res.status(403).json({ error: 'Requiere permiso de Moderador' });
}

// --- API ---

// Endpoint para obtener las temporadas configuradas
app.get('/api/seasons', (req, res) => {
    res.json(CONFIG);
});

app.get('/api/config', (req, res) => {
    res.json({
        turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null
    });
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

    const playersList = await loadPlayers();
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
        const currentPlayersList = await loadPlayers();
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



// Serve specific HTML files
app.get('/ranking', (req, res) => { res.sendFile(path.join(__dirname, 'ranking.html')); });
app.get('/news', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); }); // index is News now
app.get('/forum', (req, res) => { res.sendFile(path.join(__dirname, 'forum.html')); });
app.get('/login', (req, res) => { res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/admin', (req, res) => { res.redirect('/login'); });

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

// --- STATS API ---
app.get('/api/admin/stats', isAdmin, async (req, res) => {
    try {
        const players = await loadPlayers();
        let newsCount = 0;
        let usersCount = 0;

        if (MONGODB_URI && mongoose.connection.readyState === 1) {
            newsCount = await News.countDocuments();
            usersCount = await User.countDocuments();
        } else {
            newsCount = loadJson(NEWS_PATH).length;
            usersCount = loadJson(USERS_PATH).length;
        }

        res.json({
            success: true,
            stats: {
                totalPlayers: players.length,
                totalNews: newsCount,
                totalUsers: usersCount,
                currentSeason: CURRENT_SEASON_ID
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- AUTH API ---

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    let user;
    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    } else {
        const users = loadJson(USERS_PATH);
        user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }

    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    if (user.banned) return res.status(403).json({ error: 'Usuario baneado' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    req.session.user = {
        username: user.username,
        role: user.role || 'user',
        id: user._id || user.id, // Compatibilidad Mongo vs JSON
        battleTag: user.battleTag || null
    };
    res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    res.json({ user: req.session.user || null });
});

app.post('/api/register', async (req, res) => {
    const { username, email, password, battleTag, website } = req.body;

    // Honeypot check (website field should be empty)
    if (website) {
        console.warn(`Spam bot detectado: ${username}`);
        return res.status(403).json({ error: 'Registro rechazado por seguridad (Anti-Spam).' });
    }

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Usuario, email y contraseña requeridos' });
    }

    // Validar email format basic
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Formato de email inválido' });

    // Validar BattleTag format (e.g., Tag#1234)
    if (battleTag && !/^\w+#\d+$/.test(battleTag)) {
        return res.status(400).json({ error: 'Formato BattleTag inválido (Ej: Nombre#1234)' });
    }

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const existing = await User.findOne({
            $or: [
                { username: { $regex: new RegExp(`^${username}$`, 'i') } },
                { email: email.toLowerCase() }
            ]
        });
        if (existing) return res.status(400).json({ error: 'El usuario o email ya existe' });
    } else {
        const users = loadJson(USERS_PATH);
        if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }
        if (users.some(u => u.email && u.email.toLowerCase() === email.toLowerCase())) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let newUser;
    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        newUser = await User.create({
            username,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'user',
            battleTag: battleTag || null,
            isVerified: true
        });
    } else {
        const users = loadJson(USERS_PATH);
        newUser = {
            id: Date.now(),
            username,
            email,
            password: hashedPassword,
            role: 'user',
            battleTag: battleTag || null,
            banned: false,
            isVerified: true,
            createdAt: new Date().toISOString()
        };
        users.push(newUser);
        saveJson(USERS_PATH, users);
    }

    // Auto-login
    req.session.user = {
        username: newUser.username,
        role: newUser.role,
        id: newUser._id || newUser.id,
        battleTag: newUser.battleTag
    };

    // Auto-add to ranking if BattleTag provided
    if (newUser.battleTag) {
        ensurePlayerInRanking(newUser.battleTag);
    }

    res.json({ success: true, user: req.session.user });
});

// --- NEWS API ---

app.get('/api/news', async (req, res) => {
    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const news = await News.find().sort({ date: -1 });
        res.json(news);
    } else {
        const news = loadJson(NEWS_PATH);
        res.json(news.sort((a, b) => new Date(b.date) - new Date(a.date)));
    }
});

app.post('/api/news', isEditor, async (req, res) => {
    const { title, content } = req.body;
    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const newEntry = await News.create({
            title,
            content,
            author: req.session.user.username,
            date: new Date()
        });
        res.json({ success: true, news: newEntry });
    } else {
        const news = loadJson(NEWS_PATH);
        const newEntry = {
            id: Date.now(),
            title,
            content,
            date: new Date().toISOString().split('T')[0],
            author: req.session.user.username
        };
        news.unshift(newEntry);
        saveJson(NEWS_PATH, news);
        res.json({ success: true, news: newEntry });
    }
});

app.put('/api/news/:id', isEditor, async (req, res) => {
    const newsId = req.params.id;
    const { title, content } = req.body;

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const news = await News.findById(newsId);
        if (!news) return res.status(404).json({ error: 'Noticia no encontrada' });
        news.title = title || news.title;
        news.content = content || news.content;
        news.lastEdit = new Date();
        await news.save();
        res.json({ success: true, news });
    } else {
        const id = parseInt(newsId);
        const newsList = loadJson(NEWS_PATH);
        const index = newsList.findIndex(n => n.id === id);
        if (index === -1) return res.status(404).json({ error: 'Noticia no encontrada' });

        newsList[index].title = title || newsList[index].title;
        newsList[index].content = content || newsList[index].content;
        newsList[index].lastEdit = new Date().toISOString();

        saveJson(NEWS_PATH, newsList);
        res.json({ success: true, news: newsList[index] });
    }
});


app.delete('/api/news/:id', isEditor, async (req, res) => {
    const newsId = req.params.id;

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        // Try id (number) or _id (ObjectId)
        const news = await News.findOneAndDelete({ $or: [{ id: newsId }, { _id: newsId }] }).catch(() => null)
            || await News.findByIdAndDelete(newsId).catch(() => null);

        if (!news) return res.status(404).json({ error: 'Noticia no encontrada' });
        res.json({ success: true });
    } else {
        const id = parseInt(newsId);
        let newsList = loadJson(NEWS_PATH);
        const originalLen = newsList.length;
        newsList = newsList.filter(n => n.id !== id);

        if (newsList.length === originalLen) return res.status(404).json({ error: 'Noticia no encontrada' });

        saveJson(NEWS_PATH, newsList);
        res.json({ success: true });
    }
});

app.post('/api/news/:id/comment', isAuthenticated, async (req, res) => {
    const newsId = req.params.id; // Puede ser String (Mongo) o Number (JSON)
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Comentario vacío' });

    if (MONGODB_URI && mongoose.connection.readyState === 1) {

        // Usar findOne con $or para soportar items antiguos (id number) y nuevos (Mongo _id)
        // Intentar parsear a número si es posible para búsqueda legacy, o string para _id
        const query = [];
        // Si parece ObjectId válido
        if (mongoose.Types.ObjectId.isValid(newsId)) {
            query.push({ _id: newsId });
        }
        // Si parece un número entero (Legacy ID)
        if (/^\d+$/.test(newsId)) {
            query.push({ id: parseInt(newsId) });
        }

        if (query.length === 0) return res.status(404).json({ error: 'ID inválido' });

        const news = await News.findOne({ $or: query });

        if (!news) return res.status(404).json({ error: 'Noticia no encontrada' });

        const newComment = {
            id: Date.now(), // Añadir ID también para coherencia
            author: req.session.user.username,
            content,
            date: new Date()
        };
        if (!news.comments) news.comments = [];
        news.comments.push(newComment);
        await news.save();
        res.json({ success: true, comment: newComment });
    } else {
        const nid = parseInt(newsId);
        const newsList = loadJson(NEWS_PATH);
        const itemIndex = newsList.findIndex(n => n.id === nid);
        if (itemIndex === -1) return res.status(404).json({ error: 'Noticia no encontrada' });

        if (!newsList[itemIndex].comments) newsList[itemIndex].comments = [];
        const newComment = {
            id: Date.now(),
            author: req.session.user.username,
            content,
            date: new Date().toISOString()
        };
        newsList[itemIndex].comments.push(newComment);
        saveJson(NEWS_PATH, newsList);
    }
});

app.put('/api/news/:newsId/comment/:commentId', isAuthenticated, async (req, res) => {
    const { newsId, commentId } = req.params;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Comentario vacío' });

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const news = await News.findOne({ id: newsId });
        if (!news) return res.status(404).json({ error: 'Noticia no encontrada' });

        const comment = news.comments.find(c => (c._id && c._id.toString() === commentId) || c.id == commentId);
        if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

        if (comment.author !== req.session.user.username && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'No tienes permiso' });
        }

        comment.content = content;
        await news.save();
        res.json({ success: true, comment });
    } else {
        const nid = parseInt(newsId);
        const cid = parseInt(commentId);
        const newsList = loadJson(NEWS_PATH);
        const itemIndex = newsList.findIndex(n => n.id === nid);
        if (itemIndex === -1) return res.status(404).json({ error: 'Noticia no encontrada' });

        const comment = newsList[itemIndex].comments.find(c => c.id === cid);
        if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

        if (comment.author !== req.session.user.username && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'No tienes permiso' });
        }

        comment.content = content;
        saveJson(NEWS_PATH, newsList);
        res.json({ success: true, comment });
    }
});

app.delete('/api/news/:newsId/comment/:commentId', isMod, async (req, res) => {
    const { newsId, commentId } = req.params;

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const news = await News.findById(newsId);
        if (!news) return res.status(404).json({ error: 'Noticia no encontrada' });
        news.comments = news.comments.filter(c => c._id.toString() !== commentId);
        await news.save();
        res.json({ success: true });
    } else {
        const nid = parseInt(newsId);
        const cid = parseInt(commentId);
        const newsList = loadJson(NEWS_PATH);
        const newsIndex = newsList.findIndex(n => n.id === nid);
        if (newsIndex === -1) return res.status(404).json({ error: 'Noticia no encontrada' });

        const initialLen = newsList[newsIndex].comments ? newsList[newsIndex].comments.length : 0;
        if (newsList[newsIndex].comments) {
            newsList[newsIndex].comments = newsList[newsIndex].comments.filter(c => c.id !== cid);
        }

        if (newsList[newsIndex].comments && newsList[newsIndex].comments.length < initialLen) {
            saveJson(NEWS_PATH, newsList);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Comentario no encontrado' });
        }
    }
});

// --- USER MANAGEMENT / PROFILE ---

app.post('/api/user/change-password', isAuthenticated, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    let user;
    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        user = await User.findById(userId);
    } else {
        const users = loadJson(USERS_PATH);
        user = users.find(u => u.id === userId);
    }

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    if (MONGODB_URI) {
        await user.save();
    } else {
        const users = loadJson(USERS_PATH);
        const idx = users.findIndex(u => u.id === userId);
        users[idx].password = hashedPassword;
        saveJson(USERS_PATH, users);
    }
    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
});

app.post('/api/user/update-battletag', isAuthenticated, async (req, res) => {
    const { battleTag, twitch } = req.body;
    // BattleTag es opcional si solo actualiza Twitch, pero idealmente pedimos BT siempre que se toque el perfil
    // Para simplificar, permitimos actualizar si al menos uno está presente
    if (!battleTag && !twitch) return res.status(400).json({ error: 'Nada que actualizar' });

    const userId = req.session.user.id;

    if (MONGODB_URI) {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (battleTag) user.battleTag = battleTag;
        if (twitch !== undefined) user.twitch = twitch; // Permite borrar si se manda null/empty, pero undefined no toca
        await user.save();
    } else {
        const users = loadJson(USERS_PATH);
        const user = users.find(u => u.id === userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (battleTag) user.battleTag = battleTag;
        if (twitch !== undefined) user.twitch = twitch;
        saveJson(USERS_PATH, users);
    }

    // Update session
    if (battleTag) req.session.user.battleTag = battleTag;
    if (twitch !== undefined) req.session.user.twitch = twitch;

    // Auto-add/update ranking
    // Si hay batletag (o ya lo tenia), sincronizar
    const finalBT = battleTag || req.session.user.battleTag;
    const finalTwitch = twitch !== undefined ? twitch : req.session.user.twitch;

    if (finalBT) {
        ensurePlayerInRanking(finalBT, finalTwitch);
    }

    res.json({ success: true, message: 'Perfil actualizado correctamente', battleTag: finalBT, twitch: finalTwitch });
});



// --- FORUM API ---

app.get('/api/forum', async (req, res) => {
    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const forum = await Forum.find();
        res.json(forum);
    } else {
        const forum = loadJson(FORUM_PATH);
        res.json(forum);
    }
});

app.post('/api/forum', isAuthenticated, async (req, res) => {
    const { title, content, sectionId } = req.body;
    if (!sectionId) return res.status(400).json({ error: 'sectionId es requerido' });

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const forumCat = await Forum.findOne({ "sections.id": sectionId });
        if (!forumCat) return res.status(404).json({ error: 'Sección no encontrada' });

        const section = forumCat.sections.id(sectionId) || forumCat.sections.find(s => s.id === sectionId);
        const newTopic = {
            title,
            author: req.session.user.username,
            date: new Date(),
            posts: [{
                author: req.session.user.username,
                content,
                date: new Date()
            }]
        };
        section.topics.push(newTopic);
        await forumCat.save();
        res.json({ success: true, topic: newTopic });
    } else {
        const forum = loadJson(FORUM_PATH);
        let section = null;
        for (let cat of forum) {
            section = cat.sections.find(s => s.id === sectionId);
            if (section) break;
        }
        if (!section) return res.status(404).json({ error: 'Sección no encontrada' });

        const newTopic = {
            id: Date.now(),
            title,
            author: req.session.user.username,
            date: new Date().toISOString(),
            posts: [{
                id: Date.now() + 1,
                author: req.session.user.username,
                content,
                date: new Date().toISOString()
            }]
        };

        if (!section.topics) section.topics = [];
        section.topics.push(newTopic);
        saveJson(FORUM_PATH, forum);
        res.json({ success: true, topic: newTopic });
    }
});

app.post('/api/forum/topic/:topicId/post', isAuthenticated, async (req, res) => {
    const { topicId } = req.params;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Mensaje vacío' });

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        // Buscar topic por su ID numérico dentro de las secciones
        const forumCat = await Forum.findOne({ "sections.topics.id": topicId });
        if (!forumCat) return res.status(404).json({ error: 'Tema no encontrado' });

        let foundTopic = null;
        for (const sec of forumCat.sections) {
            foundTopic = sec.topics.find(t => t.id == topicId); // == para permitir string/number match
            if (foundTopic) break;
        }

        const newPost = {
            author: req.session.user.username,
            content,
            date: new Date()
        };
        foundTopic.posts.push(newPost);
        await forumCat.save();
        res.json({ success: true, post: newPost });
    } else {
        const tid = parseInt(topicId);
        const forum = loadJson(FORUM_PATH);
        let foundTopic = null;

        for (let cat of forum) {
            for (let sec of cat.sections) {
                foundTopic = sec.topics.find(t => t.id === tid);
                if (foundTopic) break;
            }
            if (foundTopic) break;
        }

        if (!foundTopic) return res.status(404).json({ error: 'Tema no encontrado' });

        const newPost = {
            id: Date.now(),
            author: req.session.user.username,
            content,
            date: new Date().toISOString()
        };

        foundTopic.posts.push(newPost);
        saveJson(FORUM_PATH, forum);
        res.json({ success: true, post: newPost });
    }
});

app.put('/api/forum/post/:postId', isAuthenticated, async (req, res) => {
    const { postId } = req.params;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenido vacío' });

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        // En mongo los subdocumentos tienen _id, pero en local tienen id number.
        // Buscar el post en TODAS las secciones/topics
        const cats = await Forum.find();
        let found = false;

        for (let cat of cats) {
            for (let sec of cat.sections) {
                for (let topic of sec.topics) {
                    // Intentar buscar por _id si es mongo puro o id si es migrado
                    // Como migramos conservando id, puede que tengamos ambos.
                    // El frontend manda el _id si está disponible, o el id number.
                    // Vamos a asumir que postId puede se cualquiera.

                    const post = topic.posts.find(p => (p._id && p._id.toString() === postId) || p.id == postId);
                    if (post) {
                        if (post.author !== req.session.user.username && req.session.user.role !== 'admin') {
                            return res.status(403).json({ error: 'No tienes permiso' });
                        }
                        post.content = content;
                        found = true;
                        await cat.save();
                        break;
                    }
                }
                if (found) break;
            }
            if (found) break;
        }

        if (found) res.json({ success: true });
        else res.status(404).json({ error: 'Post no encontrado' });

    } else {
        const pid = parseInt(postId); // JSON usa IDs numéricos
        const forum = loadJson(FORUM_PATH);
        let found = false;

        for (let cat of forum) {
            for (let sec of cat.sections) {
                for (let topic of sec.topics) {
                    const post = topic.posts.find(p => p.id === pid);
                    if (post) {
                        if (post.author !== req.session.user.username && req.session.user.role !== 'admin') {
                            return res.status(403).json({ error: 'No tienes permiso' });
                        }
                        post.content = content;
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            if (found) break;
        }

        if (found) {
            saveJson(FORUM_PATH, forum);
            res.json({ success: true, post: { content } });
        } else {
            res.status(404).json({ error: 'Post no encontrado' });
        }
    }
});

app.delete('/api/forum/post/:postId', isAuthenticated, async (req, res) => {
    const { postId } = req.params;

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const cats = await Forum.find();
        let found = false;

        for (let cat of cats) {
            for (let sec of cat.sections) {
                for (let topic of sec.topics) {
                    // Check for post by _id or id
                    const postIndex = topic.posts.findIndex(p => (p._id && p._id.toString() === postId) || p.id == postId);
                    if (postIndex !== -1) {
                        const post = topic.posts[postIndex];
                        if (post.author !== req.session.user.username && req.session.user.role !== 'admin') {
                            return res.status(403).json({ error: 'No tienes permiso' });
                        }
                        topic.posts.splice(postIndex, 1);
                        await cat.save();
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            if (found) break;
        }
        if (found) res.json({ success: true });
        else res.status(404).json({ error: 'Post no encontrado' });

    } else {
        const pid = parseInt(postId);
        const forum = loadJson(FORUM_PATH);
        let found = false;

        for (let cat of forum) {
            for (let sec of cat.sections) {
                for (let topic of sec.topics) {
                    const postIndex = topic.posts.findIndex(p => p.id == pid || p.id == postId);
                    if (postIndex !== -1) {
                        const post = topic.posts[postIndex];
                        if (post.author !== req.session.user.username && req.session.user.role !== 'admin') {
                            return res.status(403).json({ error: 'No tienes permiso' });
                        }
                        topic.posts.splice(postIndex, 1);
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            if (found) break;
        }

        if (found) {
            saveJson(FORUM_PATH, forum);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Post no encontrado' });
        }
    }
});

app.delete('/api/forum/:id', isMod, async (req, res) => {
    const topicId = req.params.id;

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const forumCat = await Forum.findOne({ "sections.topics._id": topicId });
        if (!forumCat) return res.status(404).json({ error: 'Tema no encontrado' });

        for (const sec of forumCat.sections) {
            const topic = sec.topics.id(topicId);
            if (topic) {
                topic.remove();
                break;
            }
        }
        await forumCat.save();
        res.json({ success: true });
    } else {
        const tid = parseInt(topicId);
        const forum = loadJson(FORUM_PATH);
        let deleted = false;

        for (let cat of forum) {
            for (let sec of cat.sections) {
                const index = sec.topics.findIndex(t => t.id === tid);
                if (index !== -1) {
                    sec.topics.splice(index, 1);
                    deleted = true;
                    break;
                }
            }
            if (deleted) break;
        }

        if (deleted) {
            saveJson(FORUM_PATH, forum);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Tema no encontrado' });
        }
    }
});

// --- ADMIN PLAYER MANAGMENT ---

app.post('/api/admin/add-player', isAdmin, async (req, res) => {
    const { battleTag, twitch } = req.body;
    if (!battleTag) return res.status(400).json({ error: 'BattleTag es obligatorio' });

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        const exists = await Player.findOne({ battleTag: { $regex: new RegExp(`^${battleTag}$`, 'i') } });
        if (exists) return res.status(400).json({ error: 'El jugador ya existe' });
        const newPlayer = await Player.create({ battleTag, twitch: twitch || null });
        return res.json({ success: true, player: newPlayer });
    } else {
        let rawPlayers = [];
        try {
            rawPlayers = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
        } catch (e) { rawPlayers = []; }

        const exists = rawPlayers.some(p => p.battleTag.toLowerCase() === battleTag.toLowerCase());
        if (exists) return res.status(400).json({ error: 'El jugador ya existe' });

        const newPlayer = { battleTag, twitch: twitch || null };
        rawPlayers.push(newPlayer);
        fs.writeFileSync(PLAYERS_PATH, JSON.stringify(rawPlayers, null, 2));
        res.json({ success: true, player: newPlayer });
    }
});

app.get('/api/admin/users', isAdmin, async (req, res) => {
    if (MONGODB_URI) {
        const users = await User.find();
        const safeUsers = users.map(u => ({
            id: u._id,
            username: u.username,
            role: u.role,
            battleTag: u.battleTag,
            banned: u.banned
        }));
        res.json(safeUsers);
    } else {
        const users = loadJson(USERS_PATH);
        const safeUsers = users.map(u => ({ id: u.id, username: u.username, role: u.role, battleTag: u.battleTag, banned: u.banned }));
        res.json(safeUsers);
    }
});

app.post('/api/admin/ban', isAdmin, async (req, res) => {
    const { userId, ban } = req.body; // ban: true/false

    if (MONGODB_URI) {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (user.username === 'admin' && ban) return res.status(403).json({ error: 'No puedes banear al admin principal' });
        user.banned = ban;
        await user.save();
        res.json({ success: true });
    } else {
        const users = loadJson(USERS_PATH);
        const user = users.find(u => u.id === userId);
        if (user) {
            if (user.username === 'admin' && ban) return res.status(403).json({ error: 'No puedes banear al admin principal' });
            user.banned = ban;
            saveJson(USERS_PATH, users);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    }
});

app.post('/api/admin/change-role', isAdmin, async (req, res) => {
    const { userId, role } = req.body;
    const validRoles = ['user', 'mod', 'editor', 'admin'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Rol inválido' });

    if (MONGODB_URI) {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (user.username === 'admin') return res.status(403).json({ error: 'No puedes cambiar el rol al admin principal' });
        user.role = role;
        await user.save();
        res.json({ success: true });
    } else {
        const users = loadJson(USERS_PATH);
        const user = users.find(u => u.id === userId);
        if (user) {
            if (user.username === 'admin') return res.status(403).json({ error: 'No puedes cambiar el rol al admin principal' });
            user.role = role;
            saveJson(USERS_PATH, users);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    }
});

app.post('/api/admin/reset-password', isAdmin, async (req, res) => {
    const { userId, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Contraseña demasiado corta (min 6)' });

    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    if (MONGODB_URI) {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        user.password = hashedPassword;
        await user.save();
        res.json({ success: true });
    } else {
        const users = loadJson(USERS_PATH);
        const user = users.find(u => u.id === userId);
        if (user) {
            user.password = hashedPassword;
            saveJson(USERS_PATH, users);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    }
});

app.delete('/api/admin/player', isAdmin, async (req, res) => {
    const { battleTag } = req.body;
    if (!battleTag) return res.status(400).json({ error: 'BattleTag requerido' });

    if (MONGODB_URI && mongoose.connection.readyState === 1) {
        try {
            const result = await Player.findOneAndDelete({ battleTag: { $regex: new RegExp(`^${battleTag}$`, 'i') } });
            if (!result) return res.status(404).json({ error: 'Jugador no encontrado' });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Error en la base de datos' });
        }
    } else {
        let players = [];
        try {
            players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
        } catch (e) { return res.status(500).json({ error: 'Error DB' }); }

        const initLen = players.length;
        players = players.filter(p => p.battleTag.toLowerCase() !== battleTag.toLowerCase());

        if (players.length < initLen) {
            try {
                fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2));
                await loadPlayers(); // Refrescar cache local
                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: 'Error guardando cambios' });
            }
        } else {
            res.status(404).json({ error: 'Jugador no encontrado' });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Servidor con Persistencia en puerto ${PORT}`);

    // 1. GESTIONAR TEMPORADA ACTUAL
    const cacheValida = memoriaCache[CURRENT_SEASON_ID] &&
        (Date.now() - memoriaCache[CURRENT_SEASON_ID].timestamp < TIEMPO_CACHE_ACTUAL);

    if (!cacheValida) {
        console.log("⚡ Cache actual vacía o expirada. Escaneando Season Actual en background...");
        realizarEscaneoInterno(CURRENT_SEASON_ID).catch(e => console.error("❌ Error en escaneo inicial:", e.message));
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
                await loadPlayers(); // Recargar lista ram

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
    // Y al iniciar (en background)
    detectarNuevaTemporada().catch(e => console.error("❌ Error detectando temporada inicial:", e.message));

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

    const allPlayers = await loadPlayers();
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
                    axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${j}&seasonId=${seasonId}`, {
                        timeout: 15000,
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                    })
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
    const currentPlayersList = await loadPlayers();
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
        const response = await axios.get(url, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });

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

// Periodic checks
setInterval(verificarIntegridadTemporadas, 12 * 60 * 60 * 1000); // 12h
setInterval(detectarNuevaTemporada, 60 * 60 * 1000); // 1h
