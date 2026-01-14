const fs = require('fs');
const bcrypt = require('bcrypt');
const path = require('path');

const usersPath = path.join(__dirname, 'data', 'users.json');
const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));

async function migrate() {
    for (let user of users) {
        if (!user.password.startsWith('$2b$')) {
            console.log(`Hashing password for ${user.username}`);
            user.password = await bcrypt.hash(user.password, 10);
        }
        if (!user.email) {
            user.email = `${user.username.toLowerCase()}@example.com`;
        }
    }
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    console.log('Migration complete');
}

migrate();
