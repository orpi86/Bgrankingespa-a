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
const MAX_PAGES_TO_SCAN = 300; // Máximo teórico (pero pararemos antes si se acaba)

// --- SEGURIDAD ANTI-BLOQUEO ---
const CONCURRENT_REQUESTS = 5; // Bajamos a 5 peticiones simultáneas para ser más suaves
const REQUEST_DELAY = 100;     // Pausa de 0.1s entre bloques

// --- MEMORIA RAM (CACHÉ) ---
// Aquí se guardan los datos para no escribirlos en disco (evita error EACCES)
const memoriaCache = {}; 
const TIEMPO_CACHE_ACTUAL = 30 * 60 * 1000; // La actual caduca en 30 min

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

    console.log(`📡 Petición recibida para Season ${seasonToScan}`);

    // 1. REVISAR MEMORIA RAM
    const datosGuardados = memoriaCache[seasonToScan];
    let usarMemoria = false;

    if (datosGuardados) {
        if (!isCurrentSeason) {
            // Si es una temporada vieja, SIEMPRE usamos la memoria (nunca cambia)
            usarMemoria = true;
        } else {
            // Si es la actual, usamos memoria si es reciente (< 30 min)
            if (Date.now() - datosGuardados.timestamp < TIEMPO_CACHE_ACTUAL) {
                usarMemoria = true;
            }
        }
    }

    if (usarMemoria) {
        console.log(`⚡ Sirviendo desde MEMORIA RAM (Sin molestar a Blizzard).`);
        const dataWithTwitch = await actualizarTwitchLive(datosGuardados.data);
        return res.json(dataWithTwitch);
    }

    // 2. SI NO ESTÁ EN MEMORIA, DESCARGAR
    console.log(`🌐 Iniciando descarga inteligente de Season ${seasonToScan}...`);

    const myPlayersRaw = loadPlayers();
    let results = myPlayersRaw.map(p => ({
        battleTag: p.battleTag,
        twitchUser: p.twitch || null,
        isLive: false,
        nameOnly: p.battleTag.split('#')[0].toLowerCase(),
        fullTag: p.battleTag.toLowerCase(),
        rank: null,
        rating: '< 8000', // Valor por defecto
        found: false
    }));

    try {
        // Bucle de escaneo CON FRENO AUTOMÁTICO
        for (let i = 1; i <= MAX_PAGES_TO_SCAN; i += CONCURRENT_REQUESTS) {
            const batchPromises = [];
            
            // Preparamos lote de 5 páginas
            for (let j = i; j < i + CONCURRENT_REQUESTS && j <= MAX_PAGES_TO_SCAN; j++) {
                batchPromises.push(
                    axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${j}&seasonId=${seasonToScan}`)
                    .then(r => r.data)
                    .catch(() => null)
                );
            }

            const batchResponses = await Promise.all(batchPromises);
            
            // Verificamos si encontramos ALGO en este lote
            let jugadoresEncontradosEnLote = 0;

            batchResponses.forEach(data => {
                if (!data || !data.leaderboard || !data.leaderboard.rows) return;
                
                const rows = data.leaderboard.rows;
                if (rows.length > 0) jugadoresEncontradosEnLote += rows.length;

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

            // *** EL FRENO DE MANO ***
            // Si Blizzard nos devuelve páginas vacías, significa que la temporada terminó.
            // PARAMOS AQUÍ para no generar errores 404 y que no nos baneen.
            if (jugadoresEncontradosEnLote === 0) {
                console.log(`🛑 Fin de la temporada detectado en página ${i}. Parando escaneo.`);
                break; 
            }

            // Esperar un poco antes del siguiente bloque
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

        // 4. GUARDAR EN MEMORIA RAM
        memoriaCache[seasonToScan] = {
            timestamp: Date.now(),
            data: finalResponse
        };
        console.log(`✅ Datos guardados en RAM para el futuro.`);

        // 5. AÑADIR TWITCH Y ENVIAR
        const dataWithTwitch = await actualizarTwitchLive(finalResponse);
        res.json(dataWithTwitch);

    } catch (error) {
        console.error("🚨 Error Servidor:", error.message);
        res.status(500).json({ error: "Error interno" });
    }
});

// Función auxiliar para Twitch
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
app.listen(PORT, () => { console.log(`🚀 Servidor RAM Listo en puerto ${PORT}`); });


