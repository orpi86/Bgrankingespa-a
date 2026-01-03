const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// --- CONFIGURACIÓN ---
const REGION = 'eu';
const CURRENT_SEASON_ID = 17; 
// CAMBIO IMPORTANTE: Subimos a 400 páginas (Top 10.000 jugadores)
const MAX_PAGES_TO_SCAN = 150; 

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// --- CARGAR LISTA ---
const loadPlayers = () => {
    try {
        const filePath = path.join(__dirname, 'jugadores.json');
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("❌ Error leyendo jugadores.json:", e.message);
        return [];
    }
};

// --- AUTH TWITCH ---
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
    const seasonToScan = req.query.season || CURRENT_SEASON_ID;
    console.log(`🔍 Iniciando escaneo de Season ${seasonToScan} (Hasta ${MAX_PAGES_TO_SCAN} páginas)...`);

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
        // 1. BLIZZARD - Bucle de peticiones
        const requests = [];
        for (let i = 1; i <= MAX_PAGES_TO_SCAN; i++) {
            requests.push(
                axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${i}&seasonId=${seasonToScan}`)
                .then(res => ({ page: i, data: res.data })) // Guardamos el número de página para el log
                .catch(e => null)
            );
        }
        
        // Esperamos a todas las peticiones
        const responses = await Promise.all(requests);
        console.log(`✅ Descargas finalizadas. Procesando datos...`);

        let totalBlizzardPlayersScanned = 0;

        responses.forEach(response => {
            if (!response || !response.data || !response.data.leaderboard || !response.data.leaderboard.rows) return;
            
            const rows = response.data.leaderboard.rows;
            totalBlizzardPlayersScanned += rows.length;

            // CHIVATO: Verificamos que estamos descargando datos reales en la primera página
            if (response.page === 1) {
                console.log(`ℹ️ DEBUG: Página 1 descargada. El Top 1 es: ${rows[0].accountid} con ${rows[0].rating} puntos.`);
            }
            
            rows.forEach(row => {
                const blizzID = row.accountid?.toString().toLowerCase() || "";
                
                results.forEach(player => {
                    if (player.found) return;

                    // Lógica de coincidencia
                    if (blizzID === player.fullTag || blizzID.startsWith(player.nameOnly)) {
                        player.rank = row.rank;
                        player.rating = row.rating;
                        player.found = true;
                        console.log(`🎉 ¡ENCONTRADO! ${player.battleTag} en Rank ${row.rank} (${row.rating})`);
                    }
                });
            });
        });

        console.log(`📊 Total jugadores escaneados en Europa: ${totalBlizzardPlayersScanned}`);

        // 2. TWITCH
        const twitchUsersToCheck = results.filter(r => r.twitchUser).map(r => r.twitchUser);
        if (twitchUsersToCheck.length > 0) {
            const token = await getTwitchToken();
            if (token) {
                const queryParams = new URLSearchParams();
                twitchUsersToCheck.forEach(user => queryParams.append('user_login', user));
                try {
                    const twitchResp = await axios.get(`https://api.twitch.tv/helix/streams?${queryParams.toString()}`, {
                        headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` }
                    });
                    twitchResp.data.data.forEach(stream => {
                        const player = results.find(p => p.twitchUser && p.twitchUser.toLowerCase() === stream.user_login.toLowerCase());
                        if (player) player.isLive = true;
                    });
                } catch (err) { console.error("Twitch Error:", err.message); }
            }
        }

        // 3. ORDENAR
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

        finalResponse.forEach((player, index) => player.spainRank = index + 1);
        res.json(finalResponse);

    } catch (error) {
        console.error("🚨 Error Fatal:", error.message);
        res.status(500).json({ error: "Error interno" });
    }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Servidor en puerto ${PORT}`); });



