document.addEventListener('DOMContentLoaded', loadForum);

let currentTopicId = null;
let currentSectionId = null;
let forumData = [];

let currentUser = null;
let quillNew = null;
let quillEdit = null;

function initQuill() {
    if (document.getElementById('editor-container-new') && !quillNew) {
        quillNew = new Quill('#editor-container-new', {
            theme: 'snow',
            placeholder: 'Escribe el contenido de tu tema aquí...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, false] }],
                    ['bold', 'italic', 'underline'],
                    ['link'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['clean']
                ]
            }
        });
    }
    if (document.getElementById('editor-container-edit') && !quillEdit) {
        quillEdit = new Quill('#editor-container-edit', {
            theme: 'snow',
            placeholder: 'Edita tu mensaje...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, false] }],
                    ['bold', 'italic', 'underline'],
                    ['link'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['clean']
                ]
            }
        });
    }
}

function insertMediaToForumQuill(target, mediaType) {
    const labels = { 'img': 'la imagen', 'yt': 'el vídeo de YouTube', 'tw': 'el clip de Twitch' };
    const url = prompt(`Introduce la URL de ${labels[mediaType] || 'la media'}:`);
    if (!url) return;

    const quill = (target === 'new') ? quillNew : quillEdit;
    if (!quill) return;

    const range = quill.getSelection();
    const index = range ? range.index : quill.getLength();
    quill.insertText(index, `[${mediaType}:${url}]`);
}

async function loadForum() {
    try {
        // Fetch User first
        try {
            const auth = await fetch('/api/me');
            const authData = await auth.json();
            currentUser = authData.user;
        } catch (e) { }

        const res = await fetch('/api/forum');
        forumData = await res.json();
        renderCategories();
        initQuill();
    } catch (e) {
        console.error("Error loading forum:", e);
    }
}

function showForumHome() {
    currentSectionId = null;
    currentTopicId = null;
    document.getElementById('forum-view').style.display = 'block';
    document.getElementById('topic-view').style.display = 'none';
    renderCategories();
}

function renderCategories() {
    const list = document.getElementById('topic-list');
    list.innerHTML = `
        <div class="panel-section" style="border-left: 4px solid var(--hs-gold); background: rgba(252, 209, 68, 0.05); margin-bottom: 30px;">
            <h3 style="margin-top:0"><i class="fa-solid fa-gavel"></i> Normas de la Taberna</h3>
            <ul style="color: #ccc; font-size: 0.95rem; line-height: 1.6;">
                <li><b>Respeto:</b> Trata a los demás como te gustaría que te tratasen.</li>
                <li><b>Orden:</b> Publica cada tema en su sección correspondiente.</li>
                <li><b>Contenido:</b> No se permite spam, contenido ilegal o inapropiado.</li>
                <li><b>Diversión:</b> ¡Estamos aquí para disfrutar de los Campos de Batalla!</li>
            </ul>
        </div>
    `;

    forumData.forEach(cat => {
        const catDiv = document.createElement('div');
        catDiv.className = 'forum-category';
        catDiv.innerHTML = `<h2 class="category-title">${cat.title}</h2>`;

        const sectionsDiv = document.createElement('div');
        sectionsDiv.className = 'sections-list';

        cat.sections.forEach(sec => {
            const secItem = document.createElement('div');
            secItem.className = 'section-item';
            secItem.style.cursor = 'pointer';
            secItem.onclick = () => openSection(sec.id);
            secItem.innerHTML = `
                <div class="section-info">
                    <span class="section-title">${sec.title}</span>
                    <div class="section-desc">${sec.description}</div>
                </div>
                <div class="section-stats">${sec.topics.length} temas</div>
            `;
            sectionsDiv.appendChild(secItem);
        });

        catDiv.appendChild(sectionsDiv);
        list.appendChild(catDiv);
    });
}

function openSection(id) {
    currentSectionId = id;
    document.getElementById('forum-view').style.display = 'block';
    document.getElementById('topic-view').style.display = 'none';

    const list = document.getElementById('topic-list');
    const section = findSection(id);

    // Breadcrumb
    list.innerHTML = `
        <div class="breadcrumb">
            <a href="#" onclick="showForumHome()">Foro</a> &gt; <span>${section.title}</span>
        </div>
        <div class="section-header">
            <h2>${section.title}</h2>
            <button class="new-topic-btn" onclick="openNewTopicModal()" style="margin:0"><i class="fa-solid fa-plus"></i> Nuevo Tema</button>
        </div>
    `;

    if (section.topics.length === 0) {
        list.innerHTML += '<div style="padding:20px; text-align:center;">No hay temas en esta sección. ¡Sé el primero!</div>';
        return;
    }

    section.topics.forEach(t => {
        const item = document.createElement('div');
        item.className = 'topic-item';
        item.style.cursor = 'pointer';
        item.onclick = () => openTopic(t.id, t.title);
        const date = new Date(t.date).toLocaleDateString();
        item.innerHTML = `
            <div>
                <span class="topic-title">${t.title}</span>
                <div class="topic-meta">Por ${t.author} - ${date}</div>
            </div>
            <div style="color:#666;">${t.posts.length} respuestas</div>
        `;
        list.appendChild(item);
    });
}

function findSection(id) {
    for (let cat of forumData) {
        const sec = cat.sections.find(s => s.id == id || (s._id && s._id.toString() === id));
        if (sec) return sec;
    }
    return null;
}

function findTopic(id) {
    for (let cat of forumData) {
        for (let sec of cat.sections) {
            const topic = sec.topics.find(t => t.id == id || (t._id && t._id.toString() === id));
            if (topic) return topic;
        }
    }
    return null;
}

function openTopic(id, title) {
    currentTopicId = id;
    document.getElementById('forum-view').style.display = 'none';
    document.getElementById('topic-view').style.display = 'block';
    document.getElementById('view-topic-title').innerText = title || "Tema";

    const topic = findTopic(id);
    if (topic) renderPosts(topic.posts);
    else {
        // Simple fallback if topic not in current forumData (e.g. after fresh save)
        console.warn("Topic not found in local data:", id);
    }
}

function renderPosts(posts) {
    const container = document.getElementById('posts-list');
    container.innerHTML = '';

    posts.forEach(p => {
        const div = document.createElement('div');
        div.className = 'post-card';
        const date = new Date(p.date).toLocaleString();

        // Check ownership or mod/admin role
        const isOwner = currentUser && currentUser.username === p.author;
        const isModOrAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'mod');
        const canEdit = isOwner || isModOrAdmin;

        const editBtn = canEdit ? `
            <div style="float:right;">
                <button class="btn-action" onclick="openEditPostModal('${p.id || p._id}')" style="font-size:0.7rem;">✏️ Editar</button>
                <button class="btn-action" onclick="deletePost('${p.id || p._id}')" style="font-size:0.7rem; color:red; margin-left:5px;">🗑️ Borrar</button>
            </div>
        ` : '';

        div.innerHTML = `
            <div class="post-header">
                <div>
                    <span class="post-author">${p.author}</span>
                    <span>${date}</span>
                </div>
                ${editBtn}
            </div>
            <div class="post-content" id="post-content-${p.id || p._id || 'unknown'}">${parseMedia(p.content)}</div>
        `;
        container.appendChild(div);
    });
}

function openEditPostModal(postId) {
    const postContentDiv = document.getElementById(`post-content-${postId}`);
    if (!postContentDiv) return;

    document.getElementById('edit-post-id').value = postId;
    document.getElementById('edit-post-modal').style.display = 'flex';

    // Quill uses HTML
    quillEdit.root.innerHTML = postContentDiv.innerHTML;
    document.getElementById('edit-post-msg').innerText = '';
}

function closeEditPostModal() {
    document.getElementById('edit-post-modal').style.display = 'none';
}

async function savePostEdit() {
    const postId = document.getElementById('edit-post-id').value;
    const content = quillEdit.root.innerHTML;
    const msg = document.getElementById('edit-post-msg');

    if (!content || content === '<p><br></p>') return alert("Mensaje vacío");

    try {
        const res = await fetch(`/api/forum/post/${postId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
            closeEditPostModal();
            await loadForum();
            const topic = findTopic(currentTopicId);
            if (topic) renderPosts(topic.posts);
        } else {
            msg.innerText = "Error: " + data.error;
            msg.style.color = 'red';
        }
    } catch (e) { console.error(e); }
}

async function deletePost(postId) {
    if (!confirm("¿Seguro que quieres borrar este mensaje?")) return;
    try {
        const res = await fetch(`/api/forum/post/${postId}`, { method: 'DELETE' });
        if (res.ok) {
            await loadForum();
            const topic = findTopic(currentTopicId);
            if (topic) renderPosts(topic.posts);
        } else alert("Error al borrar");
    } catch (e) { console.error(e); }
}

function showTopicList() {
    if (currentSectionId) openSection(currentSectionId);
    else showForumHome();
}

function openNewTopicModal() {
    document.getElementById('new-topic-modal').style.display = 'flex';
}

async function createTopic() {
    const title = document.getElementById('new-topic-title').value;
    const content = quillNew.root.innerHTML;

    if (!title || !content || content === '<p><br></p>') return alert("Rellena todos los campos");

    const res = await fetch('/api/forum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, sectionId: currentSectionId })
    });

    const data = await res.json();
    if (data.success) {
        document.getElementById('new-topic-modal').style.display = 'none';
        document.getElementById('new-topic-title').value = '';
        quillNew.root.innerHTML = '';
        await loadForum();
        openSection(currentSectionId);
    } else {
        alert("Error: " + (data.error || "Login requerido"));
    }
}

async function submitReply() {
    const content = document.getElementById('reply-content').value;
    if (!content) return;

    const res = await fetch(`/api/forum/topic/${currentTopicId}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });

    const data = await res.json();
    if (data.success) {
        document.getElementById('reply-content').value = '';
        await loadForum();
        const topic = findTopic(currentTopicId);
        if (topic) renderPosts(topic.posts);
    } else {
        alert("Error: " + (data.error || "Login requerido"));
    }
}
