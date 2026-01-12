const fs = require('fs');

console.log('--- DEBUG START ---');

try {
    const seasons = JSON.parse(fs.readFileSync('seasons.json', 'utf8'));
    console.log('Current Season Config:', seasons.currentSeason);
} catch (e) { console.log('Error reading seasons.json', e.message); }

try {
    const historical = JSON.parse(fs.readFileSync('historical_data.json', 'utf8'));
    const s16 = historical.seasons['16'];
    console.log('Historical Season 16 (T.11):', s16 ? `Found ${s16.length} players` : 'MISSING');
    if (s16 && s16.length > 0) {
        console.log('  Sample S16:', s16[0]);
        console.log('  Count found:', s16.filter(p => p.found).length);
    }
} catch (e) { console.log('Error reading historical_data.json', e.message); }

try {
    const cache = JSON.parse(fs.readFileSync('cache.json', 'utf8'));
    const s17 = cache['17'];
    console.log('Cache Season 17 (T.12):', s17 ? `Found ${s17.data.length} players` : 'MISSING');
    if (s17 && s17.data.length > 0) {
        console.log('  Sample S17:', s17.data[0]);
    }
} catch (e) { console.log('Error reading cache.json', e.message); }

console.log('--- DEBUG END ---');
