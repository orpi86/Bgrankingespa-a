function parseMedia(content) {
    if (!content) return '';

    // Pre-process: Remove newlines and extra spaces between tags [img:...], [yt:...], [tw:...] 
    // to prevent <br> injection between side-by-side elements
    let text = content.replace(/(\]|\))\s*\n\s*(\[)/g, '$1$2');

    // 1. Convert [img:url] to <img> tags
    text = text.replace(/\[img:(https?:\/\/[^\]]+)\]/gi, (match, url) => {
        return `<div class="media-container"><img src="${url}" alt="Imagen del usuario" class="embedded-img" loading="lazy"></div>`;
    });

    // 2. Convert [yt:url] to YouTube iframes
    text = text.replace(/\[yt:(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\]]+)\]/gi, (match, url) => {
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

    // 3. Convert [tw:url] to Twitch Clips iframes
    text = text.replace(/\[tw:(https?:\/\/(?:www\.)?(?:twitch\.tv\/[^\/]+\/clip\/|clips\.twitch\.tv\/)[^\]]+)\]/gi, (match, url) => {
        let clipSlug = '';
        if (url.includes('clips.twitch.tv/')) {
            clipSlug = url.split('clips.twitch.tv/')[1].split('?')[0];
        } else if (url.includes('/clip/')) {
            clipSlug = url.split('/clip/')[1].split('?')[0];
        }

        if (clipSlug) {
            const parent = window.location.hostname;
            return `<div class="media-container"><iframe class="embedded-video" src="https://clips.twitch.tv/embed?clip=${clipSlug}&parent=${parent}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
        }
        return match;
    });

    // 4. Global Linkify: Convert remaining URLs to clickable links
    // Solo linkificamos texto que NO esté ya dentro de una etiqueta HTML (como un src="")
    const parts = text.split(/(<[^>]+>)/g);
    text = parts.map(part => {
        if (part.startsWith('<')) return part;
        // Regex para URLs: https?://... (evitando caracteres de puntuación finales comunes como .,)
        return part.replace(/(https?:\/\/[^\s<]+[^.,\s<])/gi, (url) => {
            return `<a href="${url}" target="_blank" class="hs-link">${url}</a>`;
        });
    }).join('');

    // 5. Basic line breaks
    return text.replace(/\n/g, '<br>');
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
    .media-container { margin: 15px auto; text-align: center; }
    .embedded-img { transition: transform 0.3s; }
    .embedded-img:hover { transform: scale(1.02); border-color: #fff; }
    .embedded-video { width: 100%; aspect-ratio: 16 / 9; max-width: 800px; border-radius: 8px; border: 1px solid var(--hs-gold); margin: 0 auto; display: block; }
    
    .hs-link { color: var(--hs-gold); text-decoration: none; border-bottom: 1px solid transparent; transition: all 0.2s; word-break: break-all; }
    .hs-link:hover { border-bottom-color: var(--hs-gold); filter: brightness(1.2); text-shadow: 0 0 5px var(--hs-gold); }

    @media (min-width: 768px) {
        /* If two media items are next to each other, show them side-by-side */
        .media-container:has(+ .media-container),
        .media-container + .media-container {
            display: inline-block;
            max-width: 48%;
            margin: 15px 1%;
            vertical-align: top;
        }
    }
    
    .particles { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; overflow: hidden; background: radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.4) 100%); }
    .particle { position: absolute; background: rgba(252, 209, 68, 0.4); border-radius: 50%; filter: blur(2px); animation: float 15s infinite linear; }
    .rune { position: absolute; font-family: 'Cinzel', serif; color: rgba(252, 209, 68, 0.2); pointer-events: none; animation: rune-float 20s infinite linear; opacity: 0; }

    /* Image Hover Preview Window - Full size and no cuts */
    #image-hover-preview {
        position: fixed;
        pointer-events: none;
        z-index: 10000;
        display: none;
        padding: 4px;
        background: rgba(10, 10, 20, 0.95);
        border: 2px solid var(--hs-gold);
        border-radius: 12px;
        box-shadow: 0 0 50px rgba(0,0,0,0.9), 0 0 20px rgba(252,209,68,0.3);
        backdrop-filter: blur(15px);
        max-width: 95vw;
        max-height: 95vh;
        overflow: hidden;
        transition: opacity 0.2s ease;
        opacity: 0;
    }
    #image-hover-preview img {
        display: block;
        width: auto;
        height: auto;
        max-width: 95vw;
        max-height: 95vh;
        object-fit: contain; /* Ensures no cuts */
        border-radius: 8px;
    }

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

// Image Hover Preview Logic
function initImageHoverPreview() {
    let preview = document.getElementById('image-hover-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'image-hover-preview';
        const previewImg = document.createElement('img');
        previewImg.id = 'image-hover-img';
        preview.appendChild(previewImg);
        document.body.appendChild(preview);
    }
    const previewImg = document.getElementById('image-hover-img');

    // Filter to exclude certain images (icons, UI elements that shouldn't zoom)
    function shouldShowPreview(el) {
        if (el.tagName !== 'IMG') return false;
        if (el.closest('.badge-stream') || el.closest('.badge')) return false;
        if (el.id === 'image-hover-img') return false;
        return true;
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (shouldShowPreview(target)) {
            previewImg.src = target.src;
            preview.style.display = 'block';
            setTimeout(() => { preview.style.opacity = '1'; }, 10);
            updatePreviewPosition(e);
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (preview.style.display === 'block') {
            updatePreviewPosition(e);
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target.tagName === 'IMG') {
            preview.style.opacity = '0';
            setTimeout(() => {
                if (preview.style.opacity === '0') {
                    preview.style.display = 'none';
                    previewImg.src = '';
                }
            }, 200);
        }
    });

    function updatePreviewPosition(e) {
        const offset = 15;
        let x = e.clientX + offset;
        let y = e.clientY + offset;

        const pRect = preview.getBoundingClientRect();

        if (x + pRect.width > window.innerWidth) {
            x = e.clientX - pRect.width - offset;
        }
        if (y + pRect.height > window.innerHeight) {
            y = e.clientY - pRect.height - offset;
        }

        if (x < 5) x = 5;
        if (y < 5) y = 5;

        preview.style.left = `${x}px`;
        preview.style.top = `${y}px`;
    }
}

document.addEventListener('DOMContentLoaded', initImageHoverPreview);

// ============================================================
// PROFESSIONAL POLISH — Global Utilities
// ============================================================

// --- Toast Notification System ---
function initToastContainer() {
    if (document.getElementById('toast-container')) return;
    const c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
}

/**
 * Show a toast notification.
 * @param {string} message - The message to display.
 * @param {'success'|'error'|'info'|'warning'} type - The type of toast.
 * @param {number} duration - Duration in ms before auto-dismiss.
 */
function showToast(message, type = 'info', duration = 3500) {
    initToastContainer();
    const container = document.getElementById('toast-container');

    const icons = {
        success: 'fa-solid fa-circle-check',
        error: 'fa-solid fa-circle-xmark',
        info: 'fa-solid fa-circle-info',
        warning: 'fa-solid fa-triangle-exclamation'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

// --- Top Loading Bar ---
function initLoadingBar() {
    if (document.getElementById('top-loading-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'top-loading-bar';
    document.body.appendChild(bar);
}

function showLoadingBar() {
    initLoadingBar();
    const bar = document.getElementById('top-loading-bar');
    bar.style.width = '0';
    bar.style.display = 'block';
    // Animate to 70% then hold
    requestAnimationFrame(() => {
        bar.style.width = '70%';
    });
}

function hideLoadingBar() {
    const bar = document.getElementById('top-loading-bar');
    if (!bar) return;
    bar.style.width = '100%';
    setTimeout(() => {
        bar.style.display = 'none';
        bar.style.width = '0';
    }, 400);
}

// --- Scroll-Triggered Fade-In Animations ---
function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target); // Only animate once
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    // Auto-tag common content cards for animation
    const animatableSelectors = [
        '.news-card',
        '.section-item',
        '.forum-category',
        '.panel-section',
        '.stat-card',
        '.user-row',
        '.podium-card'
    ];

    animatableSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            // Don't re-add if already animated
            if (!el.classList.contains('animate-in')) {
                el.classList.add('animate-in');
                observer.observe(el);
            }
        });
    });

    return observer;
}

// Re-run animations when new content is loaded (for dynamic content)
function refreshAnimations() {
    initScrollAnimations();
}

// Run scroll animations on page load
document.addEventListener('DOMContentLoaded', () => {
    // Delay slightly to allow dynamic content to render first
    setTimeout(initScrollAnimations, 300);
});

// --- Ripple Effect for Buttons ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.btn-action, .tab-btn, .season-btn').forEach(btn => {
        btn.classList.add('ripple-effect');
    });
});
