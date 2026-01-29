console.log(" Admin JS Loaded");

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

    // Premium Badge & Header
    const pUsername = document.getElementById('panel-username');
    const pRoleLabel = document.getElementById('panel-role');
    if (pUsername) pUsername.innerText = user.username;
    if (pRoleLabel) pRoleLabel.innerText = user.role.toUpperCase();

    // Fill profile tab
    const pUser = document.getElementById('profile-username');
    const pRole = document.getElementById('profile-role');
    const pBT = document.getElementById('profile-battletag');
    const pTwitch = document.getElementById('profile-twitch');

    if (pUser) pUser.innerText = user.username;
    if (pRole) pRole.innerText = user.role;
    if (pBT) pBT.innerText = user.battleTag || 'No vinculado';
    if (pTwitch) pTwitch.innerHTML = user.twitch ? `<a href="https://twitch.tv/${user.twitch}" target="_blank" style="color:#9146ff; text-decoration:none;">${user.twitch}</a>` : 'No vinculado';

    // Role-based visibility for TABS
    const isAdmin = user.role === 'admin';
    const isStaff = isAdmin || user.role === 'editor' || user.role === 'mod';

    const btnNews = document.getElementById('btn-tab-news');
    const btnPlayers = document.getElementById('btn-tab-players');
    const btnUsers = document.getElementById('btn-tab-users');
    const btnDashboard = document.getElementById('btn-tab-dashboard');

    if (btnDashboard) btnDashboard.style.display = isStaff ? 'inline-block' : 'none';
    if (btnNews) btnNews.style.display = (isAdmin || user.role === 'editor') ? 'inline-block' : 'none';
    if (btnPlayers) btnPlayers.style.display = isAdmin ? 'inline-block' : 'none';
    if (btnUsers) btnUsers.style.display = isAdmin ? 'inline-block' : 'none';

    // Default Tab
    if (isStaff) {
        switchTab('tab-dashboard');
        loadAdminStats();
    } else {
        switchTab('tab-profile');
    }
}

async function loadAdminStats() {
    try {
        const res = await fetch('/api/admin/stats');
        const data = await res.json();
        if (data.success) {
            document.getElementById('stat-players').innerText = data.stats.totalPlayers;
            document.getElementById('stat-news').innerText = data.stats.totalNews;
            document.getElementById('stat-users').innerText = data.stats.totalUsers;
            document.getElementById('stat-season').innerText = data.stats.currentSeason;
        }
    } catch (e) {
        console.error("Error loading stats:", e);
    }
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

async function forceRefreshRanking() {
    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "Refrescando...";
    btn.disabled = true;

    try {
        const res = await fetch('/api/force-refresh');
        const data = await res.json();
        if (data.success) {
            alert("Ranking actualizado correctamente.");
        } else {
            alert("Error al refrescar: " + data.error);
        }
    } catch (e) {
        alert("Error de conexión al refrescar el ranking.");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
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
    const news = currentNewsData.find(n => n.id == id); // Loose equality for string/number match
    if (!news) return;

    document.getElementById('edit-news-id').value = id;
    document.getElementById('news-title').value = news.title;
    document.getElementById('news-content').value = news.content;
    document.getElementById('news-form-title').innerText = "Editar Noticia";
    document.getElementById('btn-post-news').innerText = "Guardar Cambios";
    document.getElementById('btn-cancel-edit').style.display = 'inline-block';

    // Cargar comentarios para moderacin
    loadNewsComments(id);

    // Scroll to form
    document.getElementById('news-editor-container').scrollIntoView({ behavior: 'smooth' });
}

function insertMedia(targetId, type) {
    const txtArea = document.getElementById(targetId);
    if (!txtArea) return;

    let tag = '';
    let placeholder = '';

    if (type === 'img') { tag = 'img'; placeholder = 'URL_DE_LA_IMAGEN'; }
    else if (type === 'yt') { tag = 'yt'; placeholder = 'URL_DE_YOUTUBE'; }
    else if (type === 'tw') { tag = 'tw'; placeholder = 'URL_DE_TWITCH_O_CLIP'; }

    const start = txtArea.selectionStart;
    const end = txtArea.selectionEnd;
    const text = txtArea.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);

    txtArea.value = before + `[${tag}:${placeholder}]` + after;
    txtArea.focus();
    // Poner el cursor dentro del placeholder
    txtArea.setSelectionRange(start + tag.length + 2, start + tag.length + 2 + placeholder.length);
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
                    <span class="user-role">${n.date}  por ${n.author}</span>
                </div>
                <div>
                    <button class="btn-action" style="padding:4px 8px; font-size:0.75rem;" onclick="startEditNews('${n.id}')">Editar</button>
                    <button class="btn-action" style="padding:4px 8px; font-size:0.75rem; background:#ff4444;" onclick="deleteNews('${n.id}')">Borrar</button>
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
        alert("Error: " + data.error);
    }
}

// ... existing functions ...

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    const target = document.getElementById(tabId);
    if (target) target.style.display = 'block';

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

    if (!confirm(`Seguro que quieres eliminar a ${battleTag}? Esto afectar al ranking.`)) return;

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
                <select onchange="changeUserRole(${u.id}, this.value)">
                    <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuario</option>
                    <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option>
                    <option value="mod" ${u.role === 'mod' ? 'selected' : ''}>Mod</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
            ` : '';

            div.innerHTML = `
                <div class="user-info">
                    <span style="color: ${u.role === 'admin' ? 'var(--hs-gold)' : '#fff'}; font-weight: bold;">${u.username}</span>
                    <span class="user-role" style="font-size: 0.7rem; color: #888; text-transform: uppercase;">${u.role} | ${u.battleTag || 'Sin Vincular'}</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    ${roleSelect}
                    <button class="btn-action-small" onclick="adminResetPassword('${u.id}', '${u.username}')" title="Reset Password">
                        <i class="fa-solid fa-key"></i>
                    </button>
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
        const item = news.find(n => n.id == newsId); // Loose equality

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
                        onclick="deleteNewsComment('${newsId}', '${c.id || c._id}')">Borrar</button>
                `;
                list.appendChild(div);
            });
        } else {
            section.style.display = 'none';
        }
    } catch (e) { console.error("Error loading comments:", e); }
}

async function deleteNewsComment(newsId, commentId) {
    if (!confirm("Seguro que quieres borrar este comentario?")) return;
    try {
        const res = await fetch(`/api/news/${newsId}/comment/${commentId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) loadNewsComments(newsId);
        else alert("Error: " + data.error);
    } catch (e) { alert("Error de conexin"); }
}

async function updateBattleTag() {
    const battleTag = document.getElementById('new-battletag').value;
    const twitch = document.getElementById('new-twitch').value;
    const msg = document.getElementById('bt-msg');

    if (!battleTag && !twitch) {
        msg.style.color = 'red';
        msg.innerText = "Introduce un BattleTag o Canal de Twitch.";
        return;
    }

    try {
        const res = await fetch('/api/user/update-battletag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battleTag, twitch })
        });
        const data = await res.json();
        if (data.success) {
            msg.style.color = 'green';
            msg.innerText = "¡Perfil actualizado!";
            if (data.battleTag) document.getElementById('profile-battletag').innerText = data.battleTag;
            if (data.twitch) {
                document.getElementById('profile-twitch').innerHTML = `<a href="https://twitch.tv/${data.twitch}" target="_blank" style="color:#9146ff; text-decoration:none;">${data.twitch}</a>`;
            } else if (data.twitch === "" || data.twitch === null) {
                document.getElementById('profile-twitch').innerText = 'No vinculado';
            }
            // Sync with backend session and state
            setTimeout(() => {
                checkAuth(); // Refresh whole panel to be sure
                msg.innerText = "";
            }, 2000);
        } else {
            msg.style.color = 'red';
            msg.innerText = data.error;
        }
    } catch (e) {
        msg.style.color = 'red';
        msg.innerText = 'Error de conexión';
    }
}

async function adminResetPassword(userId, username) {
    const newPassword = prompt(`Introduce la nueva contrasea para ${username}:`, 'cambiame123');
    if (!newPassword) return;

    if (newPassword.length < 6) return alert("Debe tener al menos 6 caracteres.");

    try {
        const res = await fetch('/api/admin/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, newPassword })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Contrasea de ${username} actualizada con xito!`);
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) { alert("Error de conexin"); }
}

document.addEventListener('DOMContentLoaded', checkAuth);
