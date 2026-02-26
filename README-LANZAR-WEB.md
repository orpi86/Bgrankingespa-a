# 🏰 Guía de Lanzamiento: Ranking BG España

¡Enhorabuena! Tu ranking está listo para conquistar a la comunidad. Aquí tienes los pasos detallados para poner la web online de forma gratuita y profesional.

## ⚠️ Nota Importante sobre GitHub Pages
**GitHub Pages** solo permite archivos estáticos (HTML/CSS). Como tu proyecto usa un servidor (**Node.js**) para extraer datos de Blizzard y Twitch, el método más fácil y gratuito es usar **Render.com**.

---

## 🚀 Opción A: Despliegue en Render (Recomendado)
*Este método es el más sencillo y permite que el servidor de Node.js funcione 24/7.*

1. **Sube tu código a GitHub:**
   - Crea un repositorio nuevo en GitHub (ej: `ranking-hs-es`).
   - Sube todos estos archivos (incluyendo `server.js`, `package.json`, `index.html`, etc.).
2. **Conecta con Render:**
   - Ve a [Render.com](https://render.com/) y crea una cuenta gratuita.
   - Haz clic en **"New +"** -> **"Web Service"**.
   - Conecta tu repositorio de GitHub.
3. **Configuración en Render:**
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. **Variables de Entorno (Opcional):**
   - Si usas Twitch, ve a la pestaña **Environment** en Render y añade:
     - `TWITCH_CLIENT_ID`: (Tu ID)
     - `TWITCH_CLIENT_SECRET`: (Tu Secret)

---

## 🐙 Opción B: GitHub Pages (Solo diseño estático)
*Si solo quieres mostrar el diseño sin que los datos se actualicen en vivo (o usando un archivo JSON fijo).*

1. Ve a los **Settings** de tu repositorio en GitHub.
2. En la sección **Pages**, elige la rama `main` y la carpeta `/ (root)`.
3. Haz clic en **Save**.
4. *Nota: Para que esto funcione con datos reales, necesitarías configurar un "GitHub Action" que haga el escaneo por ti, pero es más avanzado.*

---

## 🛠️ Estructura del Proyecto
- `server.js`: El cerebro. Escanea Blizzard y gestiona el caché.
- `index.html`: La cara. El diseño premium inspirado en la taberna.
- `seasons.json`: Configuración de temporadas.
- `jugadores.json`: Tu lista de BattleTags para seguir.
- `bg.png` & `medals.png`: Los activos visuales mágicos.

---

## 🌟 Consejos para el Repositorio
- **README.md:** Usa el contenido de este archivo para que la gente sepa cómo se usa.
- **LICENSE:** Añade una licencia MIT si quieres que otros ayuden.
- **Issues:** Deja que la comunidad te pida añadir nuevos BattleTags por ahí.

¡Mucha suerte con el lanzamiento, tabernero! 🍻
