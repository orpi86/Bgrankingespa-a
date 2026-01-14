async function checkAuth() {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.user) {
        showPanel(data.user);
    } else {
        showLogin();
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
    roleDisplay.innerHTML = `Rango: <span style="color:var(--hs-gold)">${user.role.toUpperCase()}</span> ${user.battleTag ? ' • ' + user.battleTag : ''}`;

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
        }
    } else {
        if (tabUsers) tabUsers.style.display = 'inline-block';
        if (tabRanking) tabRanking.style.display = 'inline-block';
    }
}

async function login() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
    });

    const data = await res.json();
    if (data.success) {
        showPanel(data.user);
    } else {
        const err = document.getElementById('login-error');
        err.innerText = data.error;
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
        msg.innerText = `Jugador ${battleTag} añadido correctamente.`;
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
    document.getElementById('news-content').value = '';
    document.getElementById('news-form-title').innerText = "Publicar Noticia";
    document.getElementById('btn-post-news').innerText = "Publicar Noticia";
    document.getElementById('btn-cancel-edit').style.display = 'none';
    document.getElementById('news-comments-section').style.display = 'none';
}

async function postNews() {
    const id = document.getElementById('edit-news-id').value;
    const title = document.getElementById('news-title').value;
    const content = document.getElementById('news-content').value;
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
            msg.innerText = "Error del servidor (no JSON). Código: " + res.status;
        }
    } catch (error) {
        console.error("Error postNews:", error);
        msg.style.color = 'red';
        msg.innerText = "Error de conexión: " + error.message;
    }
}

let currentNewsData = [];

function startEditNews(id) {
    const news = currentNewsData.find(n => n.id === id);
    if (!news) return;

    document.getElementById('edit-news-id').value = id;
    document.getElementById('news-title').value = news.title;
    document.getElementById('news-content').value = news.content;
    document.getElementById('news-form-title').innerText = "Editar Noticia";
    document.getElementById('btn-post-news').innerText = "Guardar Cambios";
    document.getElementById('btn-cancel-edit').style.display = 'inline-block';

    // Cargar comentarios para moderación
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
            const div = document.createElement('div');
            div.className = 'user-row'; // Reuse styles
            div.style.marginBottom = '10px';
            div.innerHTML = `
                <div class="user-info">
                    <span style="font-weight:bold;">${n.title}</span>
                    <span class="user-role">${n.date} • por ${n.author}</span>
                </div>
                <div>
                    <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="startEditNews(${n.id})">Editar</button>
                    <button class="btn-action" style="padding:4px 8px; font-size:0.75rem; background:#ff4444;" onclick="deleteNews(${n.id})">Borrar</button>
                </div>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        container.innerHTML = "Error cargando noticias.";
    }
}

async function deleteNews(id) {
    if (!confirm("¿Seguro que quieres borrar esta noticia?")) return;
    const res = await fetch(`/api/news/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
        loadNewsList();
    } else {
        alert("Error: " + data.error);
    }
}

// ... existing functions ...

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById(tabId).style.display = 'block';

    if (tabId === 'tab-news') loadNewsList();

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    // Find the button that triggered this (event.target would be better but this is simple)
    // We'll trust the user clicks the buttons. 
    // Actually, let's just re-query by onclick attribute for simplicity in this context
    const btns = document.querySelectorAll('.tab-btn');
    btns.forEach(b => {
        if (b.getAttribute('onclick').includes(tabId)) b.classList.add('active');
    });
}

async function deletePlayer() {
    const battleTag = document.getElementById('del-player-bt').value;
    if (!battleTag) return alert("BattleTag requerido");

    if (!confirm(`¿Seguro que quieres eliminar a ${battleTag}? Esto afectará al ranking.`)) return;

    const res = await fetch('/api/admin/player', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battleTag })
    });
    const data = await res.json();
    if (data.success) {
        alert("Jugador eliminado");
        document.getElementById('del-player-bt').value = '';
    } else {
        alert("Error: " + data.error);
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
        alert("Rol actualizado");
        loadUsers();
    } else {
        alert("Error: " + data.error);
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

            const bannedBtn = u.banned
                ? `<button class="btn-unban" onclick="toggleBan(${u.id}, false)">Desbanear</button>`
                : `<button class="btn-ban" onclick="toggleBan(${u.id}, true)">Banear</button>`;

            const roleSelect = u.username !== 'admin' ? `
                <select onchange="changeUserRole(${u.id}, this.value)" style="background:#222; color:#fff; border:1px solid #444; font-size:0.8rem; margin-right:10px;">
                    <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuario</option>
                    <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option>
                    <option value="mod" ${u.role === 'mod' ? 'selected' : ''}>Mod</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
            ` : '';

            div.innerHTML = `
                <div class="user-info">
                    <span style="color: ${u.role === 'admin' ? 'var(--hs-gold)' : '#fff'}">${u.username}</span>
                    <span class="user-role">${u.role} ${u.battleTag ? '• ' + u.battleTag : ''}</span>
                </div>
                <div style="display:flex; align-items:center;">
                    ${roleSelect}
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
    if (data.success) loadUsers();
    else alert("Error: " + data.error);
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
        msg.innerText = "La nueva contraseña debe tener al menos 6 caracteres.";
        return;
    }

    if (newPassword !== confirm) {
        msg.style.color = 'red';
        msg.innerText = "Las nuevas contraseñas no coinciden.";
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
            msg.innerText = "¡Contraseña actualizada con éxito!";
            document.getElementById('pass-current').value = '';
            document.getElementById('pass-new').value = '';
            document.getElementById('pass-confirm').value = '';
        } else {
            msg.style.color = 'red';
            msg.innerText = data.error || "Error al cambiar contraseña.";
        }
    } catch (e) {
        msg.style.color = 'red';
        msg.innerText = "Error de conexión.";
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
                        onclick="deleteNewsComment(${newsId}, ${c.id})">Borrar</button>
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
        if (data.success) loadNewsComments(newsId);
        else alert("Error: " + data.error);
    } catch (e) { alert("Error de conexión"); }
}

async function updateBattleTag() {
    const battleTag = document.getElementById('new-battletag').value;
    const msg = document.getElementById('bt-msg');

    if (!battleTag) {
        msg.style.color = 'red';
        msg.innerText = "Introduce un BattleTag válido.";
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
            msg.innerText = "¡BattleTag actualizado!";
            document.getElementById('profile-battletag').innerText = data.battleTag;
            // Opcional: recargar auth para actualizar todo el UI
            checkAuth();
        } else {
            msg.style.color = 'red';
            msg.innerText = data.error;
        }
    } catch (e) {
        msg.style.color = 'red';
        msg.innerText = "Error de conexión.";
    }
}

document.addEventListener('DOMContentLoaded', checkAuth);
