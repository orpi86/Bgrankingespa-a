const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path'); // NUEVO

const app = express();
app.use(cors());

// NUEVO: Servir los archivos estáticos (el index.html)
app.use(express.static(__dirname));

const REGION = 'EU';
const SEASON_ID = 25;
const TOTAL_PAGES_TO_SCAN = 500;

// Cargar lista de jugadores (VERSIÓN MEJORADA)
const loadPlayers = () => {
    try {
        // Usamos path.join para asegurar que encuentra el archivo en Linux/Render
        const filePath = path.join(__dirname, 'jugadores.json');
        console.log("Intentando leer archivo en:", filePath); // Chivato 1
        
        const data = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(data);
        
        console.log(`¡Éxito! Se han cargado ${parsed.length} jugadores.`); // Chivato 2
        return parsed;
    } catch (e) {
        console.error("ERROR LEYENDO JUGADORES.JSON:", e.message); // Chivato de error
        return [];
    }
};

app.get('/api/ranking', async (req, res) => {
    const myPlayers = loadPlayers();
    let foundPlayers = [];
    const playersMap = new Map();
    myPlayers.forEach(p => playersMap.set(p.toLowerCase(), { battleTag: p, rank: null, rating: '< 8000', found: false }));

    try {
        const requests = [];
        for (let i = 1; i <= TOTAL_PAGES_TO_SCAN; i++) {
            requests.push(
                axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${i}&seasonId=${SEASON_ID}`)
            );
        }

        const responses = await Promise.all(requests);

        responses.forEach(response => {
            const rows = response.data.leaderboard.rows;
            rows.forEach(row => {
                const btag = row.accountid.toLowerCase();
                if (playersMap.has(btag)) {
                    playersMap.set(btag, {
                        battleTag: row.accountid,
                        rank: row.rank,
                        rating: row.rating,
                        found: true
                    });
                }
            });
        });

        const result = Array.from(playersMap.values());
        result.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0;
        });

        res.json(result);

    } catch (error) {
        console.error("Error conectando con Blizzard:", error.message);
        res.status(500).json({ error: "Error obteniendo datos de Blizzard" });
    }
});

// NUEVO: Enviar el index.html cuando entren a la web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// IMPORTANTE: Render nos da un puerto dinámico en process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor funcionando en puerto ${PORT}`);

});


