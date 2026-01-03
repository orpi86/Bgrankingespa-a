const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// Servir los archivos estáticos (index.html, etc.)
app.use(express.static(__dirname));

// --- CONFIGURACIÓN ---
const REGION = 'EU';
const SEASON_ID = 17; // Temporada actual
const MAX_PAGES_TO_SCAN = 100; // Buscamos hasta 60 páginas. Si hay menos, no pasa nada.

// --- CARGAR LISTA DE JUGADORES ---
const loadPlayers = () => {
    try {
        // Usamos path.join para asegurar que encuentra el archivo en la nube
        const filePath = path.join(__dirname, 'jugadores.json');
        console.log("Leyendo lista desde:", filePath);
        
        const data = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(data);
        console.log(`Lista cargada con éxito: ${parsed.length} jugadores.`);
        return parsed;
    } catch (e) {
        console.error("ERROR: No se pudo leer jugadores.json. Asegúrate de que el formato es correcto.", e.message);
        return [];
    }
};

// --- RUTA PRINCIPAL (API) ---
app.get('/api/ranking', async (req, res) => {
    const myPlayers = loadPlayers();
    
    // Preparamos la lista para buscar de dos formas: Nombre exacto o solo Nombre
    let results = myPlayers.map(p => ({
        battleTag: p, 
        nameOnly: p.split('#')[0].toLowerCase(), // Ejemplo: "orpinell"
        fullTag: p.toLowerCase(),                // Ejemplo: "orpinell#2250"
        rank: null,
        rating: '< 8000', // Valor por defecto si no aparecen
        found: false
    }));

    try {
        const requests = [];
        
        // Lanzamos peticiones a las páginas de Blizzard
        for (let i = 1; i <= MAX_PAGES_TO_SCAN; i++) {
            requests.push(
                axios.get(`https://hearthstone.blizzard.com/en-us/api/community/leaderboardsData?region=${REGION}&leaderboardId=battlegrounds&page=${i}&seasonId=${SEASON_ID}`)
                    .catch(e => null) // IMPORTANTE: Si la página no existe, devuelve null en vez de error
            );
        }

        const responses = await Promise.all(requests);

        // Procesamos todas las páginas que han devuelto datos
        responses.forEach(response => {
            // Si la página dio error (era null) o no tiene filas, la saltamos
            if (!response || !response.data || !response.data.leaderboard || !response.data.leaderboard.rows) return;

            const rows = response.data.leaderboard.rows;
            
            rows.forEach(row => {
                // El ID que devuelve blizzard (a veces es "Nombre" y a veces "Nombre#1234")
                const blizzID = row.accountid ? row.accountid.toString().toLowerCase() : "";
                
                // Comparamos con nuestra lista
                results.forEach(player => {
                    if (player.found) return; // Si ya lo tenemos, siguiente

                    // OPCIÓN 1: Coincidencia Perfecta (Orpinell#2250 == Orpinell#2250)
                    if (blizzID === player.fullTag) {
                        player.rank = row.rank;
                        player.rating = row.rating;
                        player.found = true;
                    } 
                    // OPCIÓN 2: Coincidencia Parcial (Orpinell empieza con orpinell)
                    // Esto sirve si Blizzard decide ocultar los números en el ranking
                    else if (blizzID.startsWith(player.nameOnly)) {
                        player.rank = row.rank;
                        player.rating = row.rating;
                        player.found = true;
                    }
                });
            });
        });

        // Limpiamos los datos internos antes de enviarlos a la web
        const finalResponse = results.map(p => ({
            battleTag: p.battleTag,
            rank: p.rank,
            rating: p.rating,
            found: p.found
        }));

        // Ordenamos: Primero los encontrados (por rango), luego los no encontrados
        finalResponse.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            if (a.found && b.found) return a.rank - b.rank;
            return 0; // Si ninguno está, igual
        });

        res.json(finalResponse);

    } catch (error) {
        console.error("Error grave en el servidor:", error.message);
        res.status(500).json({ error: "Error obteniendo datos de Blizzard" });
    }
});

// --- RUTA PARA MOSTRAR LA WEB ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor funcionando en puerto ${PORT}`);
});

