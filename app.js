let allData = [];
let currentSeasonId = 17;
let realCurrentSeasonId = 17;

// Partículas de magia
function createParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    const runes = ["ᚠ", "ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᚷ", "ᚹ", "ᚺ", "ᚾ", "ᛁ", "ᛃ", "ᛈ", "ᛇ", "ᛉ", "ᛊ", "ᛏ", "ᛒ", "ᛖ", "ᛗ", "ᛚ", "ᛜ", "ᛞ", "ᛟ"];

    // Polvo de estrellas
    for (let i = 0; i < 60; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 5 + 2;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.animationDelay = Math.random() * 15 + 's';
        p.style.opacity = Math.random() * 0.5 + 0.2;
        container.appendChild(p);
    }

    // Runas flotantes
    for (let i = 0; i < 40; i++) {
        const r = document.createElement('div');
        r.className = 'rune';
        r.innerText = runes[Math.floor(Math.random() * runes.length)];
        r.style.left = Math.random() * 100 + 'vw';
        r.style.animationDuration = (Math.random() * 10 + 15) + 's';
        r.style.animationDelay = (Math.random() * 10) + 's';
        r.style.fontSize = (Math.random() * 1 + 1) + 'rem';
        container.appendChild(r);
    }
}

async function init() {
    // Force clear cache for debugging
    try {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('cachedRanking_')) localStorage.removeItem(key);
        });
    } catch (e) { }

    createParticles();
    await fetchSeasons();
    await loadRanking(currentSeasonId);
}

async function fetchSeasons() {
    try {
        const res = await fetch(`/api/seasons?_t=${Date.now()}`);
        const config = await res.json();
        const nav = document.getElementById('season-selector');
        nav.innerHTML = '';

        config.seasons.forEach(s => {
            const btn = document.createElement('button');
            btn.className = 'season-btn' + (s.id === config.currentSeason ? ' active' : '');

            // Extraer solo el número del nombre
            const numMatch = s.name.match(/\d+/);
            const displayNum = numMatch ? numMatch[0] : s.id;

            btn.innerText = displayNum;
            btn.onclick = () => switchSeason(s.id, s.name, btn);
            nav.appendChild(btn);
        });
        currentSeasonId = config.currentSeason;
        realCurrentSeasonId = config.currentSeason;

    } catch (e) { console.error(e); }
}

function switchSeason(id, name, btn) {
    document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSeasonId = id;
    loadRanking(id);
}

let lastRankingRequestId = 0;

async function loadRanking(seasonId) {
    const tbody = document.getElementById('leaderboard-body');
    const loading = document.getElementById('loading');
    const podium = document.getElementById('podium-top');

    const requestId = ++lastRankingRequestId;

    // CACHE LOCAL: Solo cargar si no hay datos nuevos pendientes
    const cached = localStorage.getItem('cachedRanking_' + seasonId);
    if (cached) {
        const cachedData = JSON.parse(cached);
        if (requestId === lastRankingRequestId) {
            allData = cachedData;
            renderTable(allData);
            renderPodium(allData.slice(0, 3));
            podium.style.display = 'flex';
            hydrateTwitch(requestId);
        }
    }

    // Limpiar vista para nueva carga si no hay cache o para refrescar
    if (requestId === lastRankingRequestId) {
        if (!cached) {
            tbody.innerHTML = '';
            podium.style.display = 'none';
        }
        loading.style.display = 'block';
    }

    try {
        console.log(`📡 Solicitando ranking para Season ${seasonId}...`);
        // Añadimos timestamp para evitar caché del navegador
        const res = await fetch(`/api/ranking?season=${seasonId}&_t=${Date.now()}`);
        const freshData = await res.json();

        // Ignorar si hay una petición más reciente
        if (requestId !== lastRankingRequestId) return;

        allData = freshData;
        localStorage.setItem('cachedRanking_' + seasonId, JSON.stringify(allData));

        selectedToCompare = [];
        updateCompareFab();
        closeSidebar();

        renderTable(allData);
        renderPodium(allData.slice(0, 3));

        loading.style.display = 'none';
        if (allData.length > 0) podium.style.display = 'flex';

        hydrateTwitch(requestId);
    } catch (e) {
        if (requestId === lastRankingRequestId && (!allData || allData.length === 0)) {
            loading.innerHTML = '<span style="color:#ff6b6b">Error de conexión con la Taberna.</span>';
        }
    }
}

// Nueva función para cargar Twitch progresivamente
async function hydrateTwitch(requestId) {
    try {
        const res = await fetch('/api/twitch-hydrate');
        const twitchData = await res.json();

        // Ignorar si la petición de ranking cambió
        if (requestId !== lastRankingRequestId) return;

        // Actualizar allData con la info de Twitch
        allData.forEach(p => {
            const twitchInfo = twitchData.find(t => t.battleTag === p.battleTag);
            if (twitchInfo) {
                p.isLive = twitchInfo.isLive;
                p.twitchAvatar = twitchInfo.twitchAvatar;
                p.twitchUser = twitchInfo.twitchUser;
            }
        });

        // Re-renderizar manteniendo el filtro actual
        const searchInput = document.getElementById('player-search');
        const searchVal = searchInput ? searchInput.value.toLowerCase() : '';

        if (!searchVal) {
            renderTable(allData);
            renderPodium(allData.slice(0, 3));
        } else {
            const filtered = allData.filter(p => p.battleTag.toLowerCase().includes(searchVal));
            renderTable(filtered);
        }
    } catch (e) {
        console.error("Error hidratando Twitch:", e);
    }
}

function formatNumber(num) {
    if (isNaN(num)) return num;
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

let selectedToCompare = [];

function renderTable(data) {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '';

    data.forEach(player => {
        const tr = document.createElement('tr');
        const [name, tag] = player.battleTag.split('#');

        const twitchClass = player.isLive ? 'live' : '';
        const twitchTitle = player.isLive ? '¡En directo!' : (player.twitchUser ? 'Ver en Twitch' : '');

        const defaultAvatar = './default_avatar.png';
        let avatarSrc = player.twitchUser && player.twitchAvatar ? player.twitchAvatar : defaultAvatar;

        const avatarHtml = `<a href="${player.twitchUser ? 'https://twitch.tv/' + player.twitchUser : '#'}" target="${player.twitchUser ? '_blank' : '_self'}" title="${twitchTitle}" class="player-avatar-link ${twitchClass}" style="${!player.twitchUser ? 'pointer-events:none;' : ''}">
            <img src="${avatarSrc}" class="player-avatar ${twitchClass}" alt="${player.battleTag}" 
                onerror="this.onerror=null; this.src='${defaultAvatar}';">
        </a>`;

        const ratingFormatted = formatNumber(player.rating);
        let badgesHtml = '';

        // Solo mostrar badges en la temporada actual
        if (parseInt(currentSeasonId) === parseInt(realCurrentSeasonId)) {
            // Icono de Twitch siempre si tiene cuenta
            if (player.twitchUser) {
                badgesHtml += `<span class="badge badge-stream" style="background:#9146ff" title="Twitch: ${player.twitchUser}"><i class="fa-brands fa-twitch"></i></span>`;
            }

            if (player.badges && player.badges.length > 0) {
                player.badges.forEach(b => {
                    const bClass = b.type === 'fire' ? 'badge-fire' : (b.type === 'stream' ? 'badge-stream' : 'badge-' + b.type);
                    // Omitir duplicado de stream si ya lo pusimos arriba
                    if (b.type === 'stream') return;

                    badgesHtml += `<span class="badge ${bClass}" title="${b.text}">${b.type === 'fire' ? '🔥' : b.text}</span>`;
                });
            }
        }

        const searchVal = document.getElementById('player-search').value.toLowerCase();
        const isSelected = searchVal && player.battleTag.toLowerCase().includes(searchVal);
        const rowStyle = isSelected ? 'background: rgba(252, 209, 68, 0.2); transition: all 0.5s;' : '';

        tr.style = rowStyle;
        tr.className = 'table-row-animate';

        tr.innerHTML = `
            <td class="col-rank-es">#${player.spainRank}</td>
            <td class="col-rank-eu">${player.found ? '#' + player.rank : '-'}</td>
            <td class="col-player">
                ${avatarHtml}
                <div class="player-info">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="player-name" style="${isSelected ? 'color: var(--hs-gold);' : ''}">${name}</span>
                        <div class="badges-wrapper">${badgesHtml}</div>
                    </div>
                    <span class="player-tag">#${tag}</span>
                </div>
            </td>
            <td style="text-align: center;">
                <button class="stats-btn" onclick="showHistory('${player.battleTag}')" title="Ver Historial">
                    <i class="fa-solid fa-chart-line"></i>
                </button>
            </td>
            <td class="col-mmr">${ratingFormatted}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPodium(top3) {
    const container = document.getElementById('podium-top');
    container.innerHTML = '';

    top3.forEach((p, i) => {
        if (!p) return;
        const card = document.createElement('div');
        card.className = `podium-card rank-${i + 1}`;
        const [name, tag] = p.battleTag.split('#');
        card.onclick = () => showHistory(p.battleTag);

        const ratingFormatted = formatNumber(p.rating);
        const twitchClass = p.isLive ? 'live' : '';
        const defaultAvatar = './default_avatar.png';
        const avatarSrc = p.twitchAvatar || defaultAvatar;

        card.innerHTML = `
            <div class="rank-medal"></div>
            <div class="podium-info">
                <div class="podium-name">${name}</div>
            </div>
        `;
        container.appendChild(card);
    });
}

document.getElementById('player-search').addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase();
    const filtered = allData.filter(p => p.battleTag.toLowerCase().includes(val));
    renderTable(filtered);
});

function closeSidebar() { }

function updateCompareFab() {
    const fab = document.getElementById('compare-fab');
    const count = document.getElementById('compare-count');
    if (selectedToCompare.length > 0) {
        fab.style.display = 'flex';
        count.innerText = selectedToCompare.length;
    } else {
        fab.style.display = 'none';
    }
}

function showComparison() {
    const target = document.getElementById('comparison-target');
    target.innerHTML = '';
    if (selectedToCompare.length === 2) {
        const p1 = allData.find(x => x.battleTag === selectedToCompare[0]);
        const p2 = allData.find(x => x.battleTag === selectedToCompare[1]);
        target.innerHTML = `
            <div class="duel-stage">
                <div class="comparison-col">
                    <div class="comp-header">${p1.battleTag.split('#')[0]}</div>
                    <div class="duel-rank-badge">RANK #${p1.spainRank}</div>
                    <div class="duel-stat-big">${formatNumber(p1.rating)}</div>
                    <div class="stat-row"><span>Global EU</span> <span>#${p1.found ? p1.rank : '---'}</span></div>
                </div>
                <div class="duel-vs-circle">VS</div>
                <div class="comparison-col">
                    <div class="comp-header">${p2.battleTag.split('#')[0]}</div>
                    <div class="duel-rank-badge">RANK #${p2.spainRank}</div>
                    <div class="duel-stat-big">${formatNumber(p2.rating)}</div>
                    <div class="stat-row"><span>Global EU</span> <span>#${p2.found ? p2.rank : '---'}</span></div>
                </div>
            </div>`;
    } else {
        selectedToCompare.forEach(tag => {
            const p = allData.find(x => x.battleTag === tag);
            const col = document.createElement('div');
            col.className = 'comparison-col';
            col.innerHTML = `
                <div class="comp-header">${p.battleTag.split('#')[0]}</div>
                <div class="stat-row"><span>Rango ES</span> <span>#${p.spainRank}</span></div>
                <div class="stat-row"><span>Rango EU</span> <span>#${p.found ? p.rank : '-'}</span></div>
                <div class="stat-row"><span>MMR</span> <span>${formatNumber(p.rating)}</span></div>
                <div class="stat-row"><span>Estado</span> <span>${p.isLive ? '🔴 LIVE' : '💤 Offline'}</span></div>`;
            target.appendChild(col);
        });
    }
    document.getElementById('compare-modal').style.display = 'flex';
}

let myChart = null;

async function showHistory(tag) {
    const player = allData.find(p => p.battleTag === tag);
    const modal = document.getElementById('history-modal');
    document.getElementById('modal-player-name').innerText = tag.split('#')[0];
    document.getElementById('modal-player-badges').innerHTML = '';
    document.getElementById('trophy-case').innerHTML = '<span style="color:#666">Cargando logros...</span>';
    modal.style.display = 'flex';
    const avatarImg = document.getElementById('modal-player-avatar');
    const liveInd = document.getElementById('modal-live-indicator');
    avatarImg.src = player.twitchAvatar || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/ebe4cd89-b4f4-4f9e-a8cf-c1d420019876-profile_image-70x70.png';
    liveInd.style.display = player.isLive ? 'block' : 'none';
    if (player.badges) {
        player.badges.forEach(b => {
            const bClass = b.type === 'fire' ? 'badge-fire' : (b.type === 'stream' ? 'badge-stream' : 'badge-' + b.type);
            const span = document.createElement('span');
            span.className = `badge ${bClass}`;
            span.innerText = b.text;
            document.getElementById('modal-player-badges').appendChild(span);
        });
    }
    document.getElementById('stat-mmr').innerText = formatNumber(player.rating);
    document.getElementById('stat-rank-es').innerText = `#${player.spainRank}`;
    document.getElementById('stat-rank-eu').innerText = player.found ? `#${player.rank}` : '--';
    try {
        const summaryRes = await fetch(`/api/player-summary?player=${encodeURIComponent(tag)}`);
        const summary = await summaryRes.json();
        document.getElementById('stat-peak').innerText = formatNumber(summary.peak || player.rating);
        const caseDiv = document.getElementById('trophy-case');
        caseDiv.innerHTML = '';
        if (summary.historical && summary.historical.length > 0) {
            summary.historical.reverse().forEach(h => {
                const trophy = document.createElement('div');
                trophy.className = 'trophy-item';
                trophy.innerHTML = `<span class="t-season">T.${parseInt(h.seasonId) - 5}</span><span class="t-rank">#${h.spainRank}</span><span style="font-size:0.6rem; color:#666;">${formatNumber(h.rating)} MMR</span>`;
                caseDiv.appendChild(trophy);
            });
        } else {
            caseDiv.innerHTML = '<span style="color:#666">Sin participaciones registradas en temporadas pasadas.</span>';
        }
        const historyRes = await fetch(`/api/history?player=${encodeURIComponent(tag)}`);
        const history = await historyRes.json();
        if (history.length >= 2) {
            const latest = history[history.length - 1].rating;
            const prev = history[history.length - 2].rating;
            const delta = latest - prev;
            const deltaDiv = document.getElementById('delta-24h');
            if (delta !== 0) {
                deltaDiv.className = delta > 0 ? 'm-delta delta-up' : 'm-delta delta-down';
                deltaDiv.innerHTML = `<i class="fa-solid fa-caret-${delta > 0 ? 'up' : 'down'}"></i> ${delta > 0 ? '+' : ''}${delta}`;
            } else deltaDiv.innerText = '';
        }
        const oneWeekAgo = new Date(); oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const filteredHistory = history.filter(h => new Date(h.date) >= oneWeekAgo);
        if (filteredHistory.length < 2 && !filteredHistory.find(h => h.date === new Date().toISOString().split('T')[0])) {
            filteredHistory.push({ date: new Date().toISOString().split('T')[0], rating: player.rating });
        }
        const labels = filteredHistory.map(h => h.date.split('-').slice(1).reverse().join('/'));
        const data = filteredHistory.map(h => h.rating);
        const ctx = document.getElementById('historyChart').getContext('2d');
        if (myChart) myChart.destroy();
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(252, 209, 68, 0.4)');
        gradient.addColorStop(1, 'rgba(252, 209, 68, 0)');
        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{ label: 'Evolución MMR', data: data, borderColor: '#fcd144', backgroundColor: gradient, borderWidth: 4, fill: true, tension: 0.4, pointRadius: 6, pointHoverRadius: 10, pointBackgroundColor: '#fcd144', pointBorderColor: '#0b0d12', pointBorderWidth: 2 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', titleFont: { family: 'Cinzel', size: 14 }, bodyFont: { family: 'Lato', size: 13 }, padding: 12, displayColors: false } },
                scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', font: { family: 'Lato', size: 11 } } }, x: { grid: { display: false }, ticks: { color: '#888', font: { family: 'Lato', size: 10 } } } }
            }
        });
    } catch (e) { console.error("Error cargando estadísticas:", e); }
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

init();
