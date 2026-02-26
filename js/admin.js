console.log(" Admin JS Loaded");

let quillNews = null;

function initQuill() {
    if (document.getElementById('news-editor-quill') && !quillNews) {
        quillNews = new Quill('#news-editor-quill', {
            theme: 'snow',
            placeholder: 'Escribe el contenido de la noticia aquí...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    ['blockquote', 'code-block'],
                    ['link'], // Imagen y video quitados para usar botones personalizados con código
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    [{ 'color': [] }, { 'background': [] }],
                    ['clean']
                ]
            }
        });
    }
}

function insertMediaToQuill(type) {
    const labels = { 'img': 'la imagen', 'yt': 'el vídeo de YouTube', 'tw': 'el clip de Twitch' };
    const url = prompt(`Introduce la URL de ${labels[type] || 'la media'}:`);
    if (!url) return;

    if (!quillNews) return;

    const range = quillNews.getSelection();
    const index = range ? range.index : quillNews.getLength();
    quillNews.insertText(index, `[${type}:${url}]`);
}

async function checkAuth() {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.user) {
        showPanel(data.user);
        initQuill();
        loadDashboard();
        handleUrlParams();
    } else {
        showLogin();
    }
}

async function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const edit = params.get('edit');

    if (tab) switchTab(`tab-${tab}`);
    if (edit && tab === 'news') {
        setTimeout(() => {
            if (currentNewsData.length > 0) startEditNews(parseInt(edit) || edit);
            else {
                const interval = setInterval(() => {
                    if (currentNewsData.length > 0) {
                        startEditNews(parseInt(edit) || edit);
                        clearInterval(interval);
                    }
                }, 500);
            }
        }, 500);
    }
}

function showLogin() {
    document.getElementById('login-view').style.display = 'block';
    document.getElementById('admin-panel').style.display = 'none';
}

function showPanel(user) {
    document.getElementById('login-view').style.display = 'none';
    const panel = document.getElementById('admin-panel');
    panel.style.display = 'block';

    // Personalize Title
    const title = panel.querySelector('h1');
    if (user.role === 'admin' || user.role === 'editor' || user.role === 'mod') {
        title.innerText = "Panel de Control";
    } else {
        title.innerText = "Mi Cuenta";
    }

    // Role display in header
    let roleDisplay = document.getElementById('panel-role-info');
    if (!roleDisplay) {
        roleDisplay = document.createElement('div');
        roleDisplay.id = 'panel-role-info';
        roleDisplay.style = "color:#aaa; margin-top:-20px; margin-bottom:20px; font-family:'Cinzel';";
        title.after(roleDisplay);
    }
    roleDisplay.innerHTML = `Rango: <span style="color:var(--hs-gold)">${user.role.toUpperCase()}</span> ${user.battleTag ? '  ' + user.battleTag : ''}`;

    // Fill profile tab
    const pUser = document.getElementById('profile-username');
    const pRole = document.getElementById('profile-role');
    const pBT = document.getElementById('profile-battletag');

    if (pUser) pUser.innerText = user.username;
    if (pRole) pRole.innerText = user.role;
    if (pBT) pBT.innerText = user.battleTag || 'No vinculado';

    // Hide tabs based on roles
    const tabNews = document.querySelector('[onclick="switchTab(\'tab-news\')"]');
    const tabUsers = document.querySelector('[onclick="switchTab(\'tab-users\')"]');
    const tabRanking = document.querySelector('[onclick="switchTab(\'tab-players\')"]');

    if (user.role !== 'admin' && user.role !== 'editor') {
        if (tabNews) tabNews.style.display = 'none';
    } else {
        if (tabNews) tabNews.style.display = 'inline-block';
    }

    if (user.role !== 'admin') {
        if (tabUsers) tabUsers.style.display = 'none';
        if (tabRanking) tabRanking.style.display = 'none';
        // If regular user has no tabs, show a welcome message
        if (user.role === 'user') {
            switchTab('tab-profile');
        } else {
            switchTab('tab-dashboard');
        }
    } else {
        if (tabUsers) tabUsers.style.display = 'inline-block';
        if (tabRanking) tabRanking.style.display = 'inline-block';
        switchTab('tab-dashboard');
    }
}

async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/stats');
        if (!res.ok) return;
        const stats = await res.json();

        if (document.getElementById('stat-news')) document.getElementById('stat-news').innerText = stats.newsCount || 0;
        if (document.getElementById('stat-players')) document.getElementById('stat-players').innerText = stats.playersCount || 0;
        if (document.getElementById('stat-users')) document.getElementById('stat-users').innerText = stats.usersCount || 0;
    } catch (e) { console.error("Error loading dashboard:", e); }
}

async function login() {
    var u = document.getElementById('username').value;
    var p = document.getElementById('password').value;
    var err = document.getElementById('login-error');

    try {
        var res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });

        var data = await res.json();
        if (data.success) {
            showPanel(data.user);
        } else {
            err.innerText = data.error;
            err.style.display = 'block';
        }
    } catch (e) {
        console.error('Login error:', e);
        err.innerText = 'Error de conexion con el servidor.';
        err.style.display = 'block';
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    showLogin();
}

async function addPlayer() {
    const battleTag = document.getElementById('player-bt').value;
    const twitch = document.getElementById('player-twitch').value;
    const msg = document.getElementById('player-msg');

    if (!battleTag) { msg.innerText = "BattleTag requerido"; return; }

    const res = await fetch('/api/admin/add-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battleTag, twitch })
    });

    const data = await res.json();
    if (data.success) {
        msg.style.color = 'green';
        msg.innerText = `Jugador ${battleTag} aadido correctamente.`;
        document.getElementById('player-bt').value = '';
        document.getElementById('player-twitch').value = '';
    } else {
        msg.style.color = 'red';
        msg.innerText = "Error: " + data.error;
    }
}

function cancelNewsEdit() {
    document.getElementById('edit-news-id').value = '';
    document.getElementById('news-title').value = '';
    quillNews.root.innerHTML = '';
    document.getElementById('news-form-title').innerText = "Publicar Noticia";
    document.getElementById('btn-post-news').innerText = "Publicar Noticia";
    document.getElementById('btn-cancel-edit').style.display = 'none';
    document.getElementById('news-comments-section').style.display = 'none';
}

async function postNews() {
    const id = document.getElementById('edit-news-id').value;
    const title = document.getElementById('news-title').value;
    const content = quillNews.root.innerHTML;
    const msg = document.getElementById('news-msg');

    if (!title || !content) { msg.innerText = "Rellena todos los campos"; return; }

    try {
        const url = id ? `/api/news/${id}` : '/api/news';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content })
        });

        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await res.json();
            if (data.success) {
                msg.style.color = 'green';
                msg.innerText = id ? "Noticia actualizada." : "Noticia publicada.";
                cancelNewsEdit();
                loadNewsList();
            } else {
                msg.style.color = 'red';
                msg.innerText = "Error: " + (data.error || 'Desconocido');
            }
        } else {
            const text = await res.text();
            console.error("Respuesta no JSON:", text);
            msg.style.color = 'red';
            msg.innerText = "Error del servidor (no JSON). Cdigo: " + res.status;
        }
    } catch (error) {
        console.error("Error postNews:", error);
        msg.style.color = 'red';
        msg.innerText = "Error de conexin: " + error.message;
    }
}

let currentNewsData = [];

function startEditNews(id) {
    const news = currentNewsData.find(n => (n.id == id || n._id == id));
    if (!news) return;

    document.getElementById('edit-news-id').value = id;
    document.getElementById('news-title').value = news.title;
    quillNews.root.innerHTML = news.content;
    document.getElementById('news-form-title').innerText = "Editar Noticia";
    document.getElementById('btn-post-news').innerText = "Guardar Cambios";
    document.getElementById('btn-cancel-edit').style.display = 'inline-block';

    // Cargar comentarios para moderacin
    loadNewsComments(id);

    // Scroll to form
    document.getElementById('news-editor-container').scrollIntoView({ behavior: 'smooth' });
}

async function loadNewsList() {
    const container = document.getElementById('admin-news-list');
    if (!container) return;
    container.innerHTML = 'Cargando noticias...';

    try {
        const res = await fetch('/api/news');
        currentNewsData = await res.json();

        container.innerHTML = '';
        currentNewsData.forEach(n => {
            const newsId = n.id || n._id;
            const div = document.createElement('div');
            div.className = 'user-row'; // Reuse styles
            div.style.marginBottom = '10px';
            div.innerHTML = `
                <div class="user-info">
                    <span style="font-weight:bold;">${n.title}</span>
                    <span class="user-role">${n.date ? new Date(n.date).toLocaleDateString() : 'N/A'} por ${n.author}</span>
                </div>
                <div>
                    <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="startEditNews('${newsId}')">Editar</button>
                    <button class="btn-action" style="padding:4px 8px; font-size:0.75rem; background:#ff4444;" onclick="deleteNews('${newsId}')">Borrar</button>
                </div>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        container.innerHTML = "Error cargando noticias.";
    }
}

async function deleteNews(id) {
    if (!confirm("Seguro que quieres borrar esta noticia?")) return;
    const res = await fetch(`/api/news/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
        loadNewsList();
    } else {
        showToast("Error: " + data.error, 'error');
    }
}

// ... existing functions ...

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById(tabId).style.display = 'block';

    if (tabId === 'tab-news') loadNewsList();
    if (tabId === 'tab-dashboard') loadDashboard();
    if (tabId === 'tab-forum') loadForumAdmin();

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('onclick')?.includes(tabId)) {
            btn.classList.add('active');
        }
    });
}

async function deletePlayer() {
    const battleTag = document.getElementById('del-player-bt').value;
    if (!battleTag) return showToast("BattleTag requerido", 'warning');

    if (!confirm(`Seguro que quieres eliminar a ${battleTag}? Esto afectar al ranking.`)) return;

    const res = await fetch('/api/admin/player', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battleTag })
    });
    const data = await res.json();
    if (data.success) {
        showToast("Jugador eliminado", 'success');
        document.getElementById('del-player-bt').value = '';
    } else {
        showToast("Error: " + data.error, 'error');
    }
}

async function changeUserRole(userId, role) {
    const res = await fetch('/api/admin/change-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role })
    });
    const data = await res.json();
    if (data.success) {
        showToast("Rol actualizado", 'success');
        loadUsers();
    } else {
        showToast("Error: " + data.error, 'error');
    }
}

async function loadUsers() {
    const container = document.getElementById('users-list');
    container.innerHTML = 'Cargando...';

    try {
        const res = await fetch('/api/admin/users');
        const users = await res.json();

        container.innerHTML = '';
        users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'user-row';

            const userId = u.id || u._id;
            const bannedBtn = u.banned
                ? `<button class="btn-unban" onclick="toggleBan('${userId}', false)">Desbanear</button>`
                : `<button class="btn-ban" onclick="toggleBan('${userId}', true)">Banear</button>`;

            const roleSelect = u.username !== 'admin' ? `
                <select onchange="changeUserRole('${userId}', this.value)" style="background:#222; color:#fff; border:1px solid #444; font-size:0.8rem; margin-right:5px; padding:2px;">
                    <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuario</option>
                    <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option>
                    <option value="mod" ${u.role === 'mod' ? 'selected' : ''}>Mod</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
            ` : '';

            div.innerHTML = `
                <div class="user-info" style="gap:5px;">
                    <span style="color: ${u.role === 'admin' ? 'var(--hs-gold)' : '#fff'}; font-size:0.9rem;">${u.username}</span>
                    <span class="user-role" style="font-size:0.75rem;">${u.role}${u.battleTag ? ' | ' + u.battleTag : ''}</span>
                </div>
                <div style="display:flex; align-items:center; gap:5px;">
                    ${roleSelect}
                    <button class="btn-action" style="padding:2px 6px; font-size:0.7rem; background:#555;" onclick="adminResetPassword('${userId}', '${u.username}')">Reset</button>
                    ${u.role !== 'admin' ? bannedBtn : ''}
                </div>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        container.innerHTML = "Error cargando usuarios.";
    }
}

async function toggleBan(userId, ban) {
    const res = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ban })
    });
    const data = await res.json();
    if (data.success) {
        showToast(ban ? "Usuario baneado" : "Usuario desbaneado", 'success');
        loadUsers();
    } else {
        showToast("Error: " + data.error, 'error');
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('pass-current').value;
    const newPassword = document.getElementById('pass-new').value;
    const confirm = document.getElementById('pass-confirm').value;
    const msg = document.getElementById('pass-msg');

    if (!currentPassword || !newPassword || !confirm) {
        msg.style.color = 'red';
        msg.innerText = "Por favor, rellena todos los campos.";
        return;
    }

    if (newPassword.length < 6) {
        msg.style.color = 'red';
        msg.innerText = "La nueva contrasea debe tener al menos 6 caracteres.";
        return;
    }

    if (newPassword !== confirm) {
        msg.style.color = 'red';
        msg.innerText = "Las nuevas contraseas no coinciden.";
        return;
    }

    try {
        const res = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (data.success) {
            msg.style.color = 'green';
            msg.innerText = "Contrasea actualizada con xito!";
            document.getElementById('pass-current').value = '';
            document.getElementById('pass-new').value = '';
            document.getElementById('pass-confirm').value = '';
        } else {
            msg.style.color = 'red';
            msg.innerText = data.error || "Error al cambiar contrasea.";
        }
    } catch (e) {
        msg.style.color = 'red';
        msg.innerText = "Error de conexin.";
    }
}

async function loadNewsComments(newsId) {
    const section = document.getElementById('news-comments-section');
    const list = document.getElementById('news-comments-list');
    if (!section || !list) return;

    try {
        const res = await fetch('/api/news');
        const news = await res.json();
        const item = news.find(n => n.id === newsId);

        list.innerHTML = '';
        if (item && item.comments && item.comments.length > 0) {
            section.style.display = 'block';
            item.comments.forEach(c => {
                const div = document.createElement('div');
                div.className = 'user-row';
                div.style.padding = '8px';
                div.style.fontSize = '0.9rem';
                div.innerHTML = `
                    <div class="user-info">
                        <strong>${c.author}:</strong> ${c.content}
                    </div>
                    <button class="btn-action" style="background:#ff4444; padding:2px 6px; font-size:0.75rem;" 
                        onclick="deleteNewsComment('${newsId}', '${c.id}')">Borrar</button>
                `;
                list.appendChild(div);
            });
        } else {
            section.style.display = 'none';
        }
    } catch (e) { console.error("Error loading comments:", e); }
}

async function deleteNewsComment(newsId, commentId) {
    if (!confirm("¿Seguro que quieres borrar este comentario?")) return;
    try {
        const res = await fetch(`/api/news/${newsId}/comment/${commentId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast("Comentario borrado", 'success');
            loadNewsComments(newsId);
        } else {
            showToast("Error: " + data.error, 'error');
        }
    } catch (e) { showToast("Error de conexión", 'error'); }
}

async function updateBattleTag() {
    const battleTag = document.getElementById('new-battletag').value;
    const msg = document.getElementById('bt-msg');

    if (!battleTag) {
        msg.style.color = 'red';
        msg.innerText = "Introduce un BattleTag vlido.";
        return;
    }

    try {
        const res = await fetch('/api/user/update-battletag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battleTag })
        });
        const data = await res.json();
        if (data.success) {
            msg.style.color = 'green';
            msg.innerText = "BattleTag actualizado!";
            document.getElementById('profile-battletag').innerText = data.battleTag;
            // Opcional: recargar auth para actualizar todo el UI
            checkAuth();
        } else {
            msg.style.color = 'red';
            msg.innerText = data.error;
        }
    } catch (e) {
        msg.style.color = 'red';
        msg.innerText = 'Error de conexion';
    }
}

async function adminResetPassword(userId, username) {
    const newPassword = prompt(`Introduce la nueva contrasea para ${username}:`, 'cambiame123');
    if (!newPassword) return;

    if (newPassword.length < 6) return showToast("Mínimo 6 caracteres", 'warning');

    try {
        const res = await fetch('/api/admin/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, newPassword })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Contraseña de ${username} actualizada con éxito!`, 'success');
        } else {
            showToast("Error: " + data.error, 'error');
        }
    } catch (e) { showToast("Error de conexión", 'error'); }
}

document.addEventListener('DOMContentLoaded', checkAuth);

async function loadForumAdmin() {
    const list = document.getElementById('admin-forum-list');
    if (!list) return;
    try {
        const res = await fetch('/api/forum');
        const data = await res.json();
        list.innerHTML = '';

        data.forEach(cat => {
            cat.sections.forEach(sec => {
                sec.topics.forEach(topic => {
                    const topicId = topic.id || topic._id;
                    const row = document.createElement('div');
                    row.className = 'user-row';
                    row.style.marginBottom = '5px';
                    row.style.flexDirection = 'column';
                    const date = topic.date ? new Date(topic.date).toLocaleDateString() : 'N/A';
                    const postCount = topic.posts ? topic.posts.length : 0;

                    row.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                            <div class="user-info">
                                <strong>${topic.title}</strong><br>
                                <span style="font-size:0.8rem; color:#ccc;">Sección: ${sec.title} | Autor: ${topic.author} | ${date} | ${postCount} posts</span>
                            </div>
                            <div class="user-actions" style="display:flex; gap:5px; flex-shrink:0;">
                                <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="toggleForumPosts(this, '${topicId}')"><i class="fa-solid fa-eye"></i> Posts</button>
                                <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="window.location.href='/forum.html?topic=${topicId}'">Ver</button>
                                <button class="btn-action" style="padding:4px 8px; font-size:0.75rem; background:#ff4444;" onclick="deleteForumTopicAdmin('${topicId}')">Borrar</button>
                            </div>
                        </div>
                        <div class="forum-posts-detail" id="posts-${topicId}" style="display:none; width:100%; margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.1);">
                            <!-- Posts will be loaded here -->
                        </div>
                    `;
                    list.appendChild(row);
                });
            });
        });

        if (list.innerHTML === '') {
            list.innerHTML = '<div style="text-align:center; padding:20px;">No hay temas en el foro.</div>';
        }
    } catch (e) {
        console.error("Error loading forum admin:", e);
        list.innerHTML = '<div style="text-align:center; padding:20px; color:red;">Error al cargar foro.</div>';
    }
}

async function toggleForumPosts(btn, topicId) {
    const container = document.getElementById(`posts-${topicId}`);
    if (!container) return;

    if (container.style.display !== 'none') {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = '<div style="text-align:center; padding:10px; color:#aaa;">Cargando posts...</div>';

    try {
        const res = await fetch('/api/forum');
        const data = await res.json();
        let foundTopic = null;

        for (const cat of data) {
            for (const sec of cat.sections) {
                const t = sec.topics.find(t => (t.id || t._id) === topicId);
                if (t) { foundTopic = t; break; }
            }
            if (foundTopic) break;
        }

        if (!foundTopic || !foundTopic.posts || foundTopic.posts.length === 0) {
            container.innerHTML = '<div style="padding:10px; color:#aaa; font-size:0.85rem;">Sin posts en este tema.</div>';
            return;
        }

        container.innerHTML = '';
        foundTopic.posts.forEach((post, i) => {
            const postId = post.id || post._id;
            const pDate = post.date ? new Date(post.date).toLocaleDateString() : '';
            const preview = (post.content || '').replace(/<[^>]*>/g, '').substring(0, 120);
            const postDiv = document.createElement('div');
            postDiv.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 12px; margin-bottom:4px; background:rgba(255,255,255,0.03); border-radius:6px; gap:10px;';
            postDiv.innerHTML = `
                <div style="flex:1; min-width:0;">
                    <span style="font-size:0.85rem; color:#ccc;">#${i + 1} <strong>${post.author || 'Anónimo'}</strong> — ${pDate}</span>
                    <div style="font-size:0.8rem; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${preview}...</div>
                </div>
                <div style="display:flex; gap:4px; flex-shrink:0;">
                    <button class="btn-action" style="padding:3px 6px; font-size:0.7rem;" onclick="editForumPostAdmin('${postId}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-action" style="padding:3px 6px; font-size:0.7rem; background:#ff4444;" onclick="deleteForumPostAdmin('${postId}', '${topicId}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            container.appendChild(postDiv);
        });
    } catch (e) {
        container.innerHTML = '<div style="padding:10px; color:red;">Error cargando posts.</div>';
    }
}

async function deleteForumPostAdmin(postId, topicId) {
    if (!confirm("¿Seguro que quieres borrar este post?")) return;
    try {
        const res = await fetch(`/api/forum/post/${postId}`, { method: 'DELETE' });
        if (res.ok) {
            showToast("Post borrado con éxito", 'success');
            // Re-expand the posts for this topic
            const container = document.getElementById(`posts-${topicId}`);
            if (container) container.style.display = 'none';
            toggleForumPosts(null, topicId);
        } else {
            showToast("Error al borrar post", 'error');
        }
    } catch (e) { console.error(e); showToast("Error de conexión", 'error'); }
}

async function editForumPostAdmin(postId) {
    const newContent = prompt("Editar contenido del post:");
    if (!newContent) return;
    try {
        const res = await fetch(`/api/forum/post/${postId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent })
        });
        if (res.ok) {
            showToast("Post editado con éxito", 'success');
            loadForumAdmin();
        } else {
            const data = await res.json();
            showToast("Error: " + (data.error || 'Desconocido'), 'error');
        }
    } catch (e) { showToast("Error de conexión", 'error'); }
}

async function deleteForumTopicAdmin(topicId) {
    if (!confirm("¿Seguro que quieres borrar este tema y todos sus mensajes?")) return;
    try {
        const res = await fetch(`/api/forum/topic/${topicId}`, { method: 'DELETE' });
        if (!res.ok) {
            // Try alternate endpoint
            const res2 = await fetch(`/api/forum/${topicId}`, { method: 'DELETE' });
            if (res2.ok) {
                showToast("Tema borrado con éxito", 'success');
                loadForumAdmin();
                loadDashboard();
                return;
            }
            showToast("Error al borrar tema", 'error');
            return;
        }
        showToast("Tema borrado con éxito", 'success');
        loadForumAdmin();
        loadDashboard();
    } catch (e) { console.error(e); }
}
