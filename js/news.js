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
            const itemId = item.id || item._id;

            const date = new Date(item.date).toLocaleDateString('es-ES', {
                year: 'numeric', month: 'long', day: 'numeric'
            });

            // Parse content
            const fullContent = parseMedia(item.content);
            const isLong = item.content.length > 1000; // Umbral más alto para mostrar más texto

            // Comments HTML
            const commentsHtml = (item.comments || []).map(c => {
                const canEdit = user && (user.role === 'admin' || user.username === c.author);
                const cid = c.id || c._id;
                const editBtn = canEdit ? `<button class="btn-action" onclick="editComment('${itemId}', '${cid}', this)" style="float:right; font-size:0.65rem; margin-left:5px;">✏️</button>` : '';

                return `
                <div class="comment">
                    <div class="comment-author">
                        ${c.author} <span style="color:#666; font-size:0.8rem;">${new Date(c.date).toLocaleString()}</span>
                        ${editBtn}
                    </div>
                    <div class="comment-text" id="comment-content-${cid}">${parseMedia(c.content)}</div>
                </div>
            `}).join('');

            const commentForm = user ? `
                <div class="comment-input-area">
                    <div style="margin-bottom:5px; display:flex; gap:5px;">
                        <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="insertMedia('comment-text-${itemId}', 'img')"><i class="fa-solid fa-image"></i> +Img</button>
                        <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="insertMedia('comment-text-${itemId}', 'yt')"><i class="fa-brands fa-youtube"></i> +YT</button>
                        <button class="btn-action" style="padding:4px 8px; font-size:0.75rem; background:#9146ff;" onclick="insertMedia('comment-text-${itemId}', 'tw')"><i class="fa-brands fa-twitch"></i> +Twitch</button>
                    </div>
                    <textarea id="comment-text-${itemId}" rows="2" placeholder="Escribe un comentario..."></textarea>
                    <button onclick="postComment('${itemId}')">Enviar</button>
                </div>
            ` : `<div style="margin-top:15px; font-style:italic; color:#888;"><a href="/login" style="color:var(--hs-gold);">Inicia sesión</a> para comentar.</div>`;

            card.innerHTML = `
                <div class="news-title" onclick="toggleNews('${itemId}')">
                    ${item.title}
                    ${user && (user.role === 'admin' || user.role === 'editor') ? `
                        <div style="float:right;" onclick="event.stopPropagation()">
                            <button onclick="editNews('${itemId}')" style="background:none; border:none; cursor:pointer;" title="Editar">✏️</button>
                            <button onclick="deleteNews('${itemId}')" style="background:none; border:none; cursor:pointer;" title="Borrar">🗑️</button>
                        </div>
                    ` : ''}
                </div>
                <div class="news-meta">Publicado el ${date} por ${item.author}</div>
                
                <div id="content-${itemId}" class="news-content ${isLong ? 'news-preview' : ''}">
                    ${fullContent}
                </div>
                
                ${isLong ? `<button id="btn-${itemId}" class="news-expand-btn" onclick="toggleNews('${itemId}')">Leer más...</button>` : ''}
                
                <div style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px;">
                    <button id="comment-btn-${itemId}" class="news-expand-btn" style="font-size: 0.85rem; color: #aaa;" onclick="toggleComments('${itemId}')">
                        <i class="fa-solid fa-comments"></i> Ver comentarios (${item.comments ? item.comments.length : 0})
                    </button>
                </div>

                <div id="comments-section-${itemId}" class="comments-section" style="display: none;">
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

function toggleNews(id) {
    const card = document.getElementById(`content-${id}`).parentElement;
    const content = document.getElementById(`content-${id}`);
    const btn = document.getElementById(`btn-${id}`);
    if (!content) return;

    if (content.classList.contains('news-preview')) {
        content.classList.remove('news-preview');
        if (btn) btn.innerText = "Mostrar menos";
        // Al expandir también nos aseguramos que el título esté visible
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        content.classList.add('news-preview');
        if (btn) btn.innerText = "Leer más...";
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function toggleComments(id) {
    const section = document.getElementById(`comments-section-${id}`);
    const btn = document.getElementById(`comment-btn-${id}`);
    if (!section) return;

    if (section.style.display === 'none') {
        section.style.display = 'block';
        if (btn) btn.innerHTML = `<i class="fa-solid fa-comment-slash"></i> Ocultar comentarios`;
    } else {
        section.style.display = 'none';
        const count = section.querySelectorAll('.comment').length;
        if (btn) btn.innerHTML = `<i class="fa-solid fa-comments"></i> Ver comentarios (${count})`;
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

async function editComment(newsId, commentId, btn) {
    const currentContent = document.getElementById(`comment-content-${commentId}`).innerText;
    const newContent = prompt("Edita tu comentario:", currentContent);
    if (newContent === null || newContent === currentContent) return;

    try {
        const res = await fetch(`/api/news/${newsId}/comment/${commentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent })
        });
        const data = await res.json();
        if (data.success) {
            loadNews();
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) { console.error(e); }
}



async function deleteNews(id) {
    if (!confirm("¿Seguro que quieres borrar esta noticia?")) return;
    try {
        const res = await fetch(`/api/news/${id}`, { method: 'DELETE' });
        if (res.ok) loadNews();
        else alert("Error al borrar");
    } catch (e) { console.error(e); }
}

async function editNews(id) {
    const newTitle = prompt("Nuevo Título (dejar vacío para no cambiar):");
    const newContent = prompt("Nuevo Contenido (dejar vacío para no cambiar):");

    if (!newTitle && !newContent) return;

    try {
        const res = await fetch(`/api/news/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle, content: newContent })
        });
        if (res.ok) loadNews();
        else alert("Error al editar");
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
