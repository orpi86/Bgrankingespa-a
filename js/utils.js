/**
 * Parses content to convert [img:url] and [yt:url] tags into HTML elements.
 * Also handles basic line breaks.
 */
function parseMedia(content) {
    if (!content) return '';

    // Convert [img:url] to <img> tags
    let parsed = content.replace(/\[img:(https?:\/\/[^\]]+)\]/gi, (match, url) => {
        return `<div class="media-container"><img src="${url}" alt="Imagen del usuario" class="embedded-img" loading="lazy"></div>`;
    });

    // Convert [yt:url] to YouTube iframes
    parsed = parsed.replace(/\[yt:(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\]]+)\]/gi, (match, url) => {
        let videoId = '';
        if (url.includes('v=')) {
            videoId = url.split('v=')[1].split('&')[0];
        } else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split('?')[0];
        }

        if (videoId) {
            return `<div class="media-container"><iframe class="embedded-video" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
        }
        return match;
    });

    // Convert [tw:url] to Twitch Clips iframes
    parsed = parsed.replace(/\[tw:(https?:\/\/(?:www\.)?(?:twitch\.tv\/[^\/]+\/clip\/|clips\.twitch\.tv\/)[^\]]+)\]/gi, (match, url) => {
        let clipSlug = '';
        if (url.includes('clips.twitch.tv/')) {
            clipSlug = url.split('clips.twitch.tv/')[1].split('?')[0];
        } else if (url.includes('/clip/')) {
            clipSlug = url.split('/clip/')[1].split('?')[0];
        }

        if (clipSlug) {
            // Note: Replace parent with your actual domain in production (e.g. &parent=bg-ranking.es)
            // For local dev, 'localhost' is usually fine if specified, or omit for auto-detection in some cases
            const parent = window.location.hostname;
            return `<div class="media-container"><iframe class="embedded-video" src="https://clips.twitch.tv/embed?clip=${clipSlug}&parent=${parent}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
        }
        return match;
    });

    // Basic line breaks
    return parsed.replace(/\n/g, '<br>');
}

function insertMedia(id, type) {
    const area = document.getElementById(id);
    const labels = { 'img': 'la imagen', 'yt': 'el vídeo de YouTube', 'tw': 'el clip de Twitch' };
    const url = prompt(`Introduce la URL de ${labels[type] || 'la media'}:`);
    if (!url) return;

    area.value += `[${type}:${url}]`;
}

// Particles magic
function createParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    const runes = ["ᚠ", "ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᚷ", "ᚹ", "ᚺ", "ᚾ", "ᛁ", "ᛃ", "ᛈ", "ᛇ", "ᛉ", "ᛊ", "ᛏ", "ᛒ", "ᛖ", "ᛗ", "ᛚ", "ᛜ", "ᛞ", "ᛟ"];

    // Star dust
    for (let i = 0; i < 40; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 4 + 2;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.animationDelay = Math.random() * 15 + 's';
        p.style.opacity = Math.random() * 0.4 + 0.1;
        container.appendChild(p);
    }

    // Floating runes
    for (let i = 0; i < 20; i++) {
        const r = document.createElement('div');
        r.className = 'rune';
        r.innerText = runes[Math.floor(Math.random() * runes.length)];
        r.style.left = Math.random() * 100 + 'vw';
        r.style.animationDuration = (Math.random() * 10 + 15) + 's';
        r.style.animationDelay = (Math.random() * 10) + 's';
        r.style.fontSize = (Math.random() * 0.8 + 0.8) + 'rem';
        container.appendChild(r);
    }
}

document.addEventListener('DOMContentLoaded', createParticles);

// Global styles for media and particles
const utilsStyle = document.createElement('style');
utilsStyle.innerHTML = `
    .media-container { margin: 15px 0; text-align: center; }
    .embedded-img { max-width: 100%; border-radius: 8px; border: 1px solid var(--hs-gold); }
    .embedded-video { width: 100%; aspect-ratio: 16 / 9; max-width: 600px; border-radius: 8px; border: 1px solid var(--hs-gold); }
    
    .particles { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; overflow: hidden; background: radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.4) 100%); }
    .particle { position: absolute; background: rgba(252, 209, 68, 0.4); border-radius: 50%; filter: blur(2px); animation: float 15s infinite linear; }
    .rune { position: absolute; font-family: 'Cinzel', serif; color: rgba(252, 209, 68, 0.2); pointer-events: none; animation: rune-float 20s infinite linear; opacity: 0; }

    @keyframes float {
        0% { transform: translateY(105vh) scale(0); opacity: 0; }
        10% { opacity: 0.6; }
        90% { opacity: 0.6; }
        100% { transform: translateY(-10vh) scale(1.5); opacity: 0; }
    }
    @keyframes rune-float {
        0% { transform: translateY(105vh) rotate(0deg); opacity: 0; }
        10% { opacity: 0.4; }
        90% { opacity: 0.4; }
        100% { transform: translateY(-10vh) rotate(360deg); opacity: 0; }
    }
`;
document.head.appendChild(utilsStyle);
