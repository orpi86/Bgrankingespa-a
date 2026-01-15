const mongoose = require('mongoose');

// --- USER SCHEMA ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, unique: true },
    role: { type: String, default: 'user' },
    battleTag: { type: String },
    banned: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

// --- NEWS SCHEMA ---
const commentSchema = new mongoose.Schema({
    author: String,
    content: String,
    date: { type: Date, default: Date.now }
});

const newsSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: String,
    date: { type: Date, default: Date.now },
    lastEdit: Date,
    comments: [commentSchema]
});

// --- FORUM SCHEMA ---
const postSchema = new mongoose.Schema({
    author: String,
    content: String,
    date: { type: Date, default: Date.now }
});

const topicSchema = new mongoose.Schema({
    title: String,
    author: String,
    date: { type: Date, default: Date.now },
    posts: [postSchema]
});

const sectionSchema = new mongoose.Schema({
    id: String,
    title: String,
    description: String,
    topics: [topicSchema]
});

const forumSchema = new mongoose.Schema({
    id: String,
    title: String,
    sections: [sectionSchema]
});

// --- PLAYER SCHEMA ---
const playerSchema = new mongoose.Schema({
    battleTag: { type: String, required: true, unique: true },
    twitch: { type: String, default: null }
});

const User = mongoose.model('User', userSchema);
const News = mongoose.model('News', newsSchema);
const Forum = mongoose.model('Forum', forumSchema);
const Player = mongoose.model('Player', playerSchema);

module.exports = { User, News, Forum, Player };
