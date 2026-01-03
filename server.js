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

// --- CARGAR LISTA ---
const loadPlayers = () => {
    try {
        const filePath = path.join(__dirname, 'jugadores.json');
        console.log("Leyendo lista desde:", filePath);
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("ERROR leyendo jugadores.json:", e.message);
        return [];
    }
};

// --- API ---
app.get('/api/ranking', async (req, res) => {
    const myPlayers = loadPlayers();
    
    let results = myPlayers.map(p => ({
        battleTag: p, 
        nameOnly: p.split('#')[0].toLowerCase(), 
        fullTag: p.toLowerCase(),               
        rank: null,
        rating: '< 8000', 
        found: false
    }));

    try {
        const requests = [];
        for (let i = 1; i <= MAX_PAGES_TO_SCAN; i++) {
            requests.push(
                axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${i}&seasonId=${SEASON_ID}`)
                    .catch(e => null) 
            );
        }

        const responses = await Promise.all(requests);

        responses.forEach(response => {
            if (!response || !response.data || !response.data.leaderboard || !response.data.leaderboard.rows) return;
            const rows = response.data.leaderboard.rows;
            
            rows.forEach(row => {
                const blizzID = row.accountid ? row.accountid.toString().toLowerCase() : "";
                
                results.forEach(player => {
                    if (player.found) return; 

                    if (blizzID === player.fullTag) {
                        player.rank = row.rank;
                        player.rating = row.rating;
                        player.found = true;
                    } 
                    else if (blizzID.startsWith(player.nameOnly)) {
                        player.rank = row.rank;
                        player.rating = row.rating;
                        player.found = true;
                    }
                });
            });
        });

        // 1. Limpiamos datos
        const finalResponse = results.map(p => ({
            battleTag: p.battleTag,
            rank: p.rank,
            rating: p.rating,
            found: p.found
        }));

        // 2. Ordenamos por Rango Europeo (Mejor a Peor)
        finalResponse.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });

        // 3. NUEVO: Asignamos el Rango de España (1, 2, 3...) basado en el orden actual
        finalResponse.forEach((player, index) => {
            player.spainRank = index + 1;
        });

        res.json(finalResponse);

    } catch (error) {
        console.error("Error servidor:", error.message);
        res.status(500).json({ error: "Error obteniendo datos" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor funcionando en puerto ${PORT}`);
});
