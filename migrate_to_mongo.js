const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { User, News, Forum, Player } = require('./models');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const NEWS_PATH = path.join(DATA_DIR, 'news.json');
const FORUM_PATH = path.join(DATA_DIR, 'forum.json');
const PLAYERS_PATH = path.join(__dirname, 'jugadores.json');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI no definida en .env");
    process.exit(1);
}

async function migrate() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Conectado a MongoDB");

        // CLEAN UP OPTION (To fix schema issues)
        // Uncomment to wipe DB and request cleanly:
        // await User.deleteMany({}); await News.deleteMany({}); await Forum.deleteMany({}); await Player.deleteMany({});
        // console.log("🧹 Base de datos limpiada para re-migración.");

        // Instead of full wipe, let's try to update logic or warn. 
        // For the user's specific case (missing IDs), a wipe of specific collections (Forum/News) is best if they want to restore from JSON.
        // Let's wipe Forum and News to ensure they get recreated with IDs.
        await Forum.deleteMany({});
        await News.deleteMany({});
        console.log("🧹 Colecciones Forum y News limpiadas para corregir IDs.");


        // --- MIGRAR USUARIOS ---
        if (fs.existsSync(USERS_PATH)) {
            const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
            for (const u of users) {
                // Evitar duplicados
                const exists = await User.findOne({ username: u.username });
                if (!exists) {
                    await User.create({
                        username: u.username,
                        password: u.password || '$2b$10$C8.2pNC0lzU.CAn2A9K/A.m0VzLz.v2XyGf7p1K5y7y7y7y7y7y7y', // Default: 'cambiame123'
                        email: u.email || `${u.username.toLowerCase()}@example.com`,
                        role: u.role,
                        battleTag: u.battleTag || u.battletag,
                        banned: u.banned,
                        isVerified: u.isVerified,
                        createdAt: u.createdAt || new Date()
                    });
                    console.log(`👤 Usuario migrado: ${u.username}`);
                }
            }
        }

        // --- MIGRAR NOTICIAS ---
        if (fs.existsSync(NEWS_PATH)) {
            const news = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf8'));
            for (const n of news) {
                const exists = await News.findOne({ title: n.title, date: n.date });
                if (!exists) {
                    await News.create(n);
                    console.log(`📰 Noticia migrada: ${n.title}`);
                }
            }
        }

        // --- MIGRAR JUGADORES ---
        if (fs.existsSync(PLAYERS_PATH)) {
            const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
            for (const p of players) {
                const exists = await Player.findOne({ battleTag: p.battleTag });
                if (!exists) {
                    await Player.create(p);
                    console.log(`🎮 Jugador migrado: ${p.battleTag}`);
                }
            }
        }

        // --- MIGRAR FORO ---
        if (fs.existsSync(FORUM_PATH)) {
            const forumData = JSON.parse(fs.readFileSync(FORUM_PATH, 'utf8'));
            for (const cat of forumData) {
                const exists = await Forum.findOne({ id: cat.id });
                if (!exists) {
                    await Forum.create(cat);
                    console.log(`🗣️ Categoría de foro migrada: ${cat.title}`);
                } else {
                    console.log(`⚠️ Categoría ya existe: ${cat.title}`);
                }
            }
        }

        console.log("🏁 Migración completada correctamente.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error en la migración:", error);
        process.exit(1);
    }
}

migrate();
