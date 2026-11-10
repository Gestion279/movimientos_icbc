# Movimientos ICBC – Fábrica SRL

App web instalable (PWA) para identificar, asignar y conciliar los movimientos de la cuenta corriente ICBC 0517/02000498/46.

- Datos en **Supabase** (proyecto `zewgswnatkthgzqahdeq`).
- Publicada en **Vercel** como sitio estático: no requiere compilación ni variables de entorno.
- Se instala en la PC (Chrome o Edge) y en el celular (Android e iPhone).

## Estructura

```
index.html                 Pantallas y configuración de Supabase (URL y anon key)
styles.css                 Estilos (colores de la empresa)
app.js                     Lógica: ingreso, movimientos, comentarios, importación, usuarios
importador.js              Lectura de las planillas .xlsx (11 columnas + celdas verdes)
sw.js                      Service worker (instalación y apertura rápida)
manifest.webmanifest       Datos de instalación (nombre, íconos, colores)
icons/                     Íconos de la app
vendor/                    Librerías incluidas: supabase-js 2.45.4 y ExcelJS 4.4.0
vercel.json                Encabezados para Vercel
supabase/functions/        Copia de la función de ingreso (ya desplegada en Supabase)
```

## Subir a GitHub

1. Crear un repositorio nuevo en GitHub (por ejemplo `movimientos-icbc`), privado.
2. Subir todo el contenido de esta carpeta a la raíz del repositorio. Se puede hacer desde la web de GitHub ("Add file" → "Upload files", arrastrando todos los archivos y carpetas) o con git:

```bash
git init
git add .
git commit -m "Movimientos ICBC: primera versión"
git branch -M main
git remote add origin https://github.com/USUARIO/movimientos-icbc.git
git push -u origin main
```

## Publicar en Vercel

1. En Vercel: **Add New → Project** e importar el repositorio de GitHub.
2. **Framework Preset:** `Other`. Dejar vacíos *Build Command* y *Output Directory*.
3. **Deploy.** No hace falta configurar variables de entorno.
4. Cada vez que se suba un cambio a la rama `main`, Vercel publica la nueva versión automáticamente.

## Instalar la app

- **PC (Chrome o Edge):** abrir la dirección de Vercel y tocar el ícono de instalar en la barra de direcciones.
- **Android (Chrome):** menú ⋮ → *Instalar app* o *Agregar a pantalla principal*.
- **iPhone (Safari):** botón *Compartir* → *Agregar a inicio*.

## Cómo funciona

- **Ingreso:** solo con el correo, sin verificación. La función `bco-login` de Supabase comprueba que el correo esté activo en `bco_usuarios` y abre la sesión. La sesión queda abierta en el dispositivo hasta tocar *Salir*.
- **Roles:**
  - *Administrador:* todo, más la gestión de usuarios.
  - *Editor:* consulta, asigna responsable, marca identificado y conciliado, comenta e importa.
  - *Solo lectura:* solo consulta.
- **Identificado:** se toma del verde de la planilla (celda de Débito o Crédito) y se puede cambiar en la app.
- **Comentarios:** quedan en el historial y no se pueden editar ni borrar.
- **Historial de cambios:** cada cambio de responsable, identificado y conciliado queda registrado con quién y cuándo.
- **Tiempo real:** los cambios de un usuario aparecen en las pantallas de los demás sin recargar.
- **Importación:** se pueden subir las planillas mensuales del banco. Los registros repetidos, ya sea entre hojas o en archivos subidos de nuevo, no se duplican.

## Seguridad

La *anon key* que figura en `index.html` es pública por diseño. Los datos están protegidos con Row Level Security: solo los usuarios activos de `bco_usuarios` pueden leer, y nadie puede modificar los importes ni los datos del banco.

Como el ingreso es solo con el correo, cualquiera que conozca un correo habilitado puede entrar. Si se quiere reforzar más adelante, se puede agregar un código enviado por correo sin cambiar el resto de la app.

Recomendado en Supabase: **Authentication → Sign In / Providers → desactivar "Allow new users to sign up"**. La app crea los usuarios por su cuenta, así que esto no afecta el ingreso.
