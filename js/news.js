document.addEventListener('DOMContentLoaded', loadNews);

async function loadNews() {
    try {
        const container = document.getElementById('news-feed');
        if (!container) return;

        // Check if user is logged in
        let user = null;
        try {
            const authRes = await fetch('/api/me');
            const authData = await authRes.json();
            user = authData.user;
        } catch (e) { }

        const res = await fetch('/api/news');
        const news = await res.json();

        container.innerHTML = '';

        if (news.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:#aaa;">No hay noticias aún.</div>';
            return;
        }

        news.forEach(item => {
            const card = document.createElement('div');
            card.className = 'news-card';

            const date = new Date(item.date).toLocaleDateString('es-ES', {
                year: 'numeric', month: 'long', day: 'numeric'
            });

            // Comments HTML
            const commentsHtml = (item.comments || []).map(c => `
                <div class="comment">
                    <div class="comment-author">${c.author} <span style="color:#666; font-size:0.8rem;">${new Date(c.date).toLocaleString()}</span></div>
                    <div class="comment-text">${parseMedia(c.content)}</div>
                </div>
            `).join('');

            const commentForm = user ? `
                <div class="comment-input-area">
                    <div style="margin-bottom:5px; display:flex; gap:5px;">
                        <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="insertMedia('comment-text-${item.id}', 'img')"><i class="fa-solid fa-image"></i> +Img</button>
                        <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="insertMedia('comment-text-${item.id}', 'yt')"><i class="fa-brands fa-youtube"></i> +YT</button>
                        <button class="btn-action" style="padding:4px 8px; font-size:0.75rem; background:#9146ff;" onclick="insertMedia('comment-text-${item.id}', 'tw')"><i class="fa-brands fa-twitch"></i> +Twitch</button>
                    </div>
                    <textarea id="comment-text-${item.id}" rows="2" placeholder="Escribe un comentario..."></textarea>
                    <button onclick="postComment(${item.id})">Enviar</button>
                </div>
            ` : `<div style="margin-top:15px; font-style:italic; color:#888;"><a href="/admin" style="color:var(--hs-gold);">Inicia sesión</a> para comentar.</div>`;

            card.innerHTML = `
                <div class="news-title">${item.title}</div>
                <div class="news-meta">Publicado el ${date} por ${item.author}</div>
                <div class="news-content">${parseMedia(item.content)}</div>
                
                <div class="comments-section">
                    <h4><i class="fa-solid fa-comments"></i> Comentarios (${item.comments ? item.comments.length : 0})</h4>
                    <div class="comments-list">${commentsHtml}</div>
                    ${commentForm}
                </div>
            `;
            container.appendChild(card);
        });
    } catch (e) {
        console.error("Error loading news:", e);
    }
}

async function postComment(newsId) {
    const txtArea = document.getElementById(`comment-text-${newsId}`);
    const content = txtArea.value;
    if (!content) return;

    try {
        const res = await fetch(`/api/news/${newsId}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
            loadNews(); // Reload to show new comment
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) { console.error(e); }
}

// Add styles
const nStyle = document.createElement('style');
nStyle.innerHTML = `
    .comments-section { margin-top: 20px; border-top: 1px solid #333; padding-top: 15px; }
    .comments-section h4 { color: #aaa; margin-bottom: 15px; font-size: 0.95rem; }
    .comment { background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #333; }
    .comment:hover { border-color: var(--hs-gold); background: rgba(255,255,255,0.02); }
    .comment-author { color: var(--hs-gold); font-weight: bold; font-size: 0.9rem; margin-bottom: 5px; }
    .comment-text { color: #ccc; font-size: 0.9rem; }
    .comment-input-area { margin-top: 15px; display: flex; flex-direction: column; gap: 10px; }
    .comment-input-area textarea { background: #1a1520; border: 1px solid #333; color: #fff; padding: 10px; border-radius: 6px; resize: vertical; font-family: inherit; }
    .comment-input-area textarea:focus { border-color: var(--hs-gold); outline: none; }
    .comment-input-area button { align-self: flex-end; background: var(--hs-gold); color: #000; border: none; padding: 10px 25px; font-weight: bold; cursor: pointer; border-radius: 6px; font-family: 'Cinzel'; }
    .comment-input-area button:hover { transform: scale(1.02); }
`;
document.head.appendChild(nStyle);
