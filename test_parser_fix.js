// Standalone test for parseMedia fix
function parseMedia(content) {
    if (!content) return '';

    // Pre-process: Remove newlines and extra spaces between tags [img:...], [yt:...], [tw:...] 
    // to prevent <br> injection between side-by-side elements
    let text = content.replace(/(\]|\))\s*\n\s*(\[)/g, '$1$2');

    // 1. Convert [img:url] to <img> tags
    text = text.replace(/\[img:([^\]]+)\]/gi, (match, possibleUrl) => {
        // Strip HTML tags from possibleUrl (e.g., <a href="...">URL</a>)
        const url = possibleUrl.replace(/<[^>]*>?/gm, '').trim();
        // Check if the URL is valid (basic check for http/https)
        if (!url.startsWith('http')) return match; 
        return `<div class="media-container"><img src="${url}" alt="Imagen del usuario" class="embedded-img" loading="lazy"></div>`;
    });

    // 2. Convert [yt:url] to YouTube iframes
    text = text.replace(/\[yt:([^\]]+)\]/gi, (match, possibleUrl) => {
        const url = possibleUrl.replace(/<[^>]*>?/gm, '').trim();
        if (!url.startsWith('http')) return match;

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
    text = text.replace(/\[tw:([^\]]+)\]/gi, (match, possibleUrl) => {
        const url = possibleUrl.replace(/<[^>]*>?/gm, '').trim();
        if (!url.startsWith('http')) return match;

        let clipSlug = '';
        if (url.includes('clips.twitch.tv/')) {
            clipSlug = url.split('clips.twitch.tv/')[1].split('?')[0];
        } else if (url.includes('/clip/')) {
            clipSlug = url.split('/clip/')[1].split('?')[0];
        }

        if (clipSlug) {
            const parent = 'localhost'; // Simulated
            return `<div class="media-container"><iframe class="embedded-video" src="https://clips.twitch.tv/embed?clip=${clipSlug}&parent=${parent}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
        }
        return match;
    });

    // 4. Global Linkify: Convert remaining URLs to clickable links
    const parts = text.split(/(<[^>]+>)/g);
    text = parts.map(part => {
        if (part.startsWith('<')) return part;
        return part.replace(/(https?:\/\/[^\s<]+[^.,\s<])/gi, (url) => {
            return `<a href="${url}" target="_blank" class="hs-link">${url}</a>`;
        });
    }).join('');

    // 5. Basic line breaks
    return text.replace(/\n/g, '<br>');
}

// TEST CASES
const pollutedContent = '<p>Check out this image: [img:<a href="https://example.com/test.jpg">https://example.com/test.jpg</a>]</p>';
const result = parseMedia(pollutedContent);
console.log("Input:", pollutedContent);
console.log("Result:", result);

if (result.includes('<img src="https://example.com/test.jpg"')) {
    console.log("✅ TEST PASSED: Image extracted from linkified marker.");
} else {
    console.log("❌ TEST FAILED: Image not found.");
}

const ytPolluted = '[yt:<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">https://www.youtube.com/watch?v=dQw4w9WgXcQ</a>]';
const ytResult = parseMedia(ytPolluted);
if (ytResult.includes('src="https://www.youtube.com/embed/dQw4w9WgXcQ"')) {
    console.log("✅ TEST PASSED: YouTube extracted from linkified marker.");
} else {
    console.log("❌ TEST FAILED: YouTube not found.");
    console.log("YouTube Result:", ytResult);
}
