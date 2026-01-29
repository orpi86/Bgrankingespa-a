function initFooter() {
    const footer = document.querySelector('footer');
    if (!footer) return;

    footer.innerHTML = `
        <div class="footer-content">
            <div class="footer-section">
                <h4>Sitemap</h4>
                <ul>
                    <li><a href="/">Inicio / Noticias</a></li>
                    <li><a href="/ranking">Ranking EU</a></li>
                    <li><a href="/forum">Foro de la Taberna</a></li>
                    <li><a href="/compos">Composiciones</a></li>
                </ul>
            </div>
            <div class="footer-section">
                <h4>Comunidad</h4>
                <ul>
                    <li><a href="https://discord.gg/UUhG4msT" target="_blank"><i class="fa-brands fa-discord"></i> Discord</a></li>
                    <li><a href="https://x.com/NellOrpi" target="_blank"><i class="fa-brands fa-twitter"></i> Twitter / X</a></li>
                    <li><a href="https://www.twitch.tv/orpi86" target="_blank"><i class="fa-brands fa-twitch"></i> Twitch</a></li>
                </ul>
            </div>
            <div class="footer-section">
                <h4>Legal</h4>
                <ul>
                    <li><a href="/cookies.txt">Cookies</a></li>
                    <li><a href="#">Privacidad</a></li>
                </ul>
            </div>
            <div class="footer-logo-section">
                <div class="footer-logo">BG Ranking <span>España</span></div>
                <p>El portal líder para los campos de batalla en español.</p>
                <div id="last-updated-footer" style="margin-top: 15px; font-size: 0.8rem; color: #888;">
                    Actualizado en tiempo real con Blizzard API
                </div>
            </div>
        </div>
        <div class="footer-bottom">
            &copy; ${new Date().getFullYear()} BG Ranking España - Proyecto Comunitario
        </div>
    `;
    footer.className = 'professional-footer';
}

document.addEventListener('DOMContentLoaded', initFooter);
