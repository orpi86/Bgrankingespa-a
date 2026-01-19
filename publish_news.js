const mongoose = require('mongoose');
const { News } = require('./models');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI no definida en .env");
    process.exit(1);
}

async function publish() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Conectado a MongoDB");

        const newsItem = {
            id: Date.now(),
            title: "📢 Importante: Actualización de Cuentas y Mejoras en la Web",
            content: `¡Hola a todos! Hemos completado una importante migración a una base de datos más robusta para mejorar la velocidad y estabilidad de la web.

🔒 **Seguridad y Cuentas**:
Debido a estos cambios de seguridad, **las contraseñas antiguas han sido restablecidas**.
Se ha asignado una contraseña temporal a todas las cuentas: \`cambiame123\`
Por favor, **iniciad sesión y cambiadla inmediatamente** desde vuestro perfil.

✨ **Novedades**:
- **Foro Mejorado**: Ahora podéis editar vuestros propios temas y ver respuestas de forma más clara.
- **Comentarios**: ¡Ya funcionan los comentarios en las noticias! Y también podéis editarlos.
- **Rendimiento**: La web carga mucho más rápido gracias al nuevo motor de base de datos.
- **Mejoras visuales**: Se han corregido errores en la visualización de imágenes y perfiles.

¡Gracias por formar parte de esta comunidad! Nos vemos en la taberna. 🍻`,
            author: "Admin",
            date: new Date(),
            comments: []
        };

        await News.create(newsItem);
        console.log("📰 Noticia publicada correctamente.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error al publicar:", error);
        process.exit(1);
    }
}

publish();
