const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const USERS_PATH = path.join(__dirname, 'data', 'users.json');

async function reset() {
    console.log("🛠️ Iniciando reset de contraseñas...");

    if (!fs.existsSync(USERS_PATH)) {
        console.error("❌ No se encontró users.json en " + USERS_PATH);
        return;
    }

    const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));

    // Nueva contraseña para ambos: "admin123" (puedes cambiarla aquí si quieres)
    const newPassword = "admin123";
    const hashed = await bcrypt.hash(newPassword, 10);

    let updated = false;
    users.forEach(user => {
        if (user.username.toLowerCase() === 'admin' || user.username.toLowerCase() === 'orpi') {
            user.password = hashed;
            user.isVerified = true;
            user.banned = false;
            console.log(`✅ Contraseña reseteada para: ${user.username}`);
            updated = true;
        }
    });

    if (updated) {
        fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
        console.log("\n🚀 ¡LISTO! Las cuentas 'admin' y 'Orpi' ahora tienen la contraseña: " + newPassword);
        console.log("⚠️ RECUERDA: Ahora DEBES REINICIAR el servidor (node server.js) para que los cambios surtan efecto.");
    } else {
        console.log("❓ No se encontraron los usuarios admin o Orpi.");
    }
}

reset();
