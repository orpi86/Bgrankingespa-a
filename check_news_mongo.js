const mongoose = require('mongoose');
const { News } = require('./models');
require('dotenv').config();

async function checkNews() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const news = await News.find().sort({ date: -1 }).limit(5);
        console.log(JSON.stringify(news, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkNews();
