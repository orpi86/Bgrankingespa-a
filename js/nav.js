document.addEventListener('DOMContentLoaded', async () => {
    const nav = document.getElementById('main-nav');
    if (!nav) return;

    // Check Auth Status
    let user = null;
    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        user = data.user;
    } catch (e) { }

    let authLinks = '';
    if (user) {
        authLinks = `
            <a href="/login" class="nav-link"><i class="fa-solid fa-circle-user"></i> Mi Perfil</a>
            <span style="color:var(--hs-gold); padding:5px 15px; font-family:'Cinzel'; display:flex; align-items:center; gap:5px;">
                ${user.username}
            </span>
            <a href="#" onclick="logoutNav()" class="nav-link"><i class="fa-solid fa-right-from-bracket"></i> Salir</a>
        `;
    } else {
        authLinks = `
            <a href="/login" class="nav-link"><i class="fa-solid fa-right-to-bracket"></i> Entrar</a>
            <a href="/register.html" class="nav-link"><i class="fa-solid fa-user-plus"></i> Registro</a>
        `;
    }

    nav.innerHTML = `
        <a href="/news" class="nav-link"><i class="fa-solid fa-newspaper"></i> Noticias</a>
        <a href="/forum" class="nav-link"><i class="fa-solid fa-comments"></i> Foro</a>
        <a href="/ranking" class="nav-link"><i class="fa-solid fa-trophy"></i> Ranking</a>
        <a href="https://hsreplay.net/battlegrounds/comps/" target="_blank" class="nav-link"><i class="fa-solid fa-chess-board"></i> Compos</a>
        ${authLinks}
    `;

    // Highlight active link
    const currentPath = window.location.pathname;
    const links = nav.querySelectorAll('a');
    links.forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPath || (currentPath === '/' && href === '/news')) {
            link.classList.add('active-link');
        }
    });
});

async function logoutNav() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.reload();
}

// Add styles dynamically if not present
const style = document.createElement('style');
style.innerHTML = `
    .main-nav {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 20px;
        background: rgba(27, 22, 38, 0.9);
        padding: 15px;
        margin: 0 auto 30px auto;
        border: 3px solid var(--hs-gold-dim);
        border-radius: 15px;
        flex-wrap: wrap;
        max-width: 950px;
        backdrop-filter: blur(15px);
        box-shadow: 0 0 40px rgba(0, 0, 0, 0.8), inset 0 0 20px rgba(252, 230, 68, 0.05);
        position: relative;
        z-index: 100;
    }
    .main-nav::before {
        content: "";
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: linear-gradient(90deg, transparent, var(--hs-gold), transparent);
    }
    .nav-link {
        color: #ddd;
        text-decoration: none;
        font-family: 'Cinzel', serif;
        font-size: 1.1rem;
        padding: 8px 15px;
        border-radius: 8px;
        transition: all 0.3s;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .nav-link:hover, .active-link {
        color: var(--hs-gold);
        background: rgba(252, 209, 68, 0.1);
        text-shadow: 0 0 10px rgba(252, 209, 68, 0.5);
    }
    .active-link {
        border: 1px solid rgba(252, 209, 68, 0.3);
    }
`;
document.head.appendChild(style);
