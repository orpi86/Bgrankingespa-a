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
const SEASON_ID = 17;
const MAX_PAGES_TO_SCAN = 60;

// Las claves las lee de Render (Environment Variables)
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// --- CARGAR LISTA (Nuevo formato objetos) ---
const loadPlayers = () => {
    try {
        const filePath = path.join(__dirname, 'jugadores.json');
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Error leyendo JSON:", e.message);
        return [];
    }
};

// --- FUNCIÓN: Obtener Token de Twitch ---
let twitchAccessToken = null;
async function getTwitchToken() {
    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) return null;
    try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: TWITCH_CLIENT_ID,
                client_secret: TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials'
            }
        });
        return response.data.access_token;
    } catch (error) {
        console.error("Error Auth Twitch:", error.message);
        return null;
    }
}

// --- API PRINCIPAL ---
app.get('/api/ranking', async (req, res) => {
    const myPlayersRaw = loadPlayers();
    
    // Preparar estructura de datos
    // Ahora 'p' es un objeto { battleTag: "...", twitch: "..." }
    let results = myPlayersRaw.map(p => ({
        battleTag: p.battleTag,
        twitchUser: p.twitch || null, // Guardamos el usuario de twitch
        isLive: false,                // Por defecto offline
        nameOnly: p.battleTag.split('#')[0].toLowerCase(),
        fullTag: p.battleTag.toLowerCase(),
        rank: null,
        rating: '< 8000',
        found: false
    }));

    try {
        // 1. BLIZZARD: Buscar Ranking
        const requests = [];
        for (let i = 1; i <= MAX_PAGES_TO_SCAN; i++) {
            requests.push(
                axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${i}&seasonId=${SEASON_ID}`)
                .catch(e => null)
            );
        }
        const responses = await Promise.all(requests);

        responses.forEach(response => {
            if (!response?.data?.leaderboard?.rows) return;
            response.data.leaderboard.rows.forEach(row => {
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

        // 2. TWITCH: Comprobar quién está en directo
        // Filtramos solo los que tienen usuario de Twitch puesto en el JSON
        const twitchUsersToCheck = results
            .filter(r => r.twitchUser)
            .map(r => r.twitchUser);

        if (twitchUsersToCheck.length > 0) {
            const token = await getTwitchToken();
            if (token) {
                // Twitch permite consultar hasta 100 usuarios en una sola llamada
                // Construimos la URL: user_login=user1&user_login=user2...
                const queryParams = new URLSearchParams();
                twitchUsersToCheck.forEach(user => queryParams.append('user_login', user));

                try {
                    const twitchResp = await axios.get(`https://api.twitch.tv/helix/streams?${queryParams.toString()}`, {
                        headers: {
                            'Client-ID': TWITCH_CLIENT_ID,
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    // Si devuelve datos, es que están online
                    const streams = twitchResp.data.data; // Array de streams activos
                    
                    streams.forEach(stream => {
                        // Buscamos al jugador que coincide con este stream
                        const player = results.find(p => p.twitchUser && p.twitchUser.toLowerCase() === stream.user_login.toLowerCase());
                        if (player) {
                            player.isLive = true;
                        }
                    });
                } catch (err) {
                    console.error("Error consultando Streams:", err.message);
                }
            }
        }

        // 3. ORDENAR Y ENVIAR
        const finalResponse = results.map(p => ({
            battleTag: p.battleTag,
            rank: p.rank,
            rating: p.rating,
            found: p.found,
            twitchUser: p.twitchUser,
            isLive: p.isLive
        }));

        finalResponse.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });

        // Asignar Ranking España
        finalResponse.forEach((player, index) => player.spainRank = index + 1);

        res.json(finalResponse);

    } catch (error) {
        console.error("Error General:", error.message);
        res.status(500).json({ error: "Error interno" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
});
