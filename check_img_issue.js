const mongoose = require('mongoose');
const { News } = require('./models');
require('dotenv').config();

async function checkNews() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const news = await News.find().sort({ date: -1 }).limit(1);
        if (news.length > 0) {
            console.log("TITLE:", news[0].title);
            console.log("CONTENT START:", news[0].content.substring(0, 500));
            // Find all [img:] tags
            const imgMatches = news[0].content.match(/\[img:[^\]]+\]/g);
            console.log("IMG TAGS FOUND:", imgMatches);
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkNews();
