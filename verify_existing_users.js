const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, 'data', 'users.json');
const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));

console.log('Verifying existing users...');
users.forEach(user => {
    if (user.isVerified === undefined) {
        user.isVerified = true;
        console.log(`Setting ${user.username} as verified.`);
    }
});

fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
console.log('Migration complete.');
