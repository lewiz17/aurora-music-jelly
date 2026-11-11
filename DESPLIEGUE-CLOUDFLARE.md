# Desplegar Aurora en Cloudflare Workers (app + panel, estado en Neon, logos en R2)

La ruta elegida: **todo en el Worker** de la carpeta `worker/`. Sin Render, sin servidor
encendido en casa para la app: Cloudflare sirve la interfaz y el panel, hace de gateway
hacia tu Jellyfin, guarda el estado en **Neon** (Postgres) y los logos en **R2**.

Leyenda de quién hace cada paso:

- 🧑 **Tú (Lyam)** — pasos dentro de tus cuentas o con tus credenciales. Nadie más puede hacerlos.
- ✅ **Ya hecho** — quedó listo en el código; no tienes que tocar nada.

✅ **Ya hecho en el código** (rama `persistencia-db`):

- El Worker completo: gateway, panel, importador de YouTube Music, sesiones compatibles
  con el servidor Express (mismo `SESSION_SECRET` = mismas sesiones).
- El parche del panel para que las importaciones avancen por pasos contra el Worker
  (commit `c33b515`): sin él, importar listas quedaba roto en esta ruta.
- La configuración `worker/wrangler.jsonc`: nombre `aurora-music`, bucket declarado y
  `ADMIN_USER=admin`. No hay nada que rellenar en ese archivo.
- Las tablas de Neon se crean solas en el primer uso. **No hay que ejecutar ningún SQL.**
- Verificado antes de escribir esta guía: tests 68/68 del repo y 11/11 del Worker, y
  simulacro de despliegue (`npm run check`) en limpio.

---

## 1. 🧑 Cuentas (una sola vez, planes gratuitos)

1. **Cloudflare** — [dash.cloudflare.com](https://dash.cloudflare.com): crea tu cuenta si
   no tienes una. El plan Free de Workers + R2 alcanza de sobra para un uso familiar.
   Al registrarte, Cloudflare te asigna un subdominio de `workers.dev` (algo como
   `tunombre.workers.dev`); la app quedará en `aurora-music.tunombre.workers.dev`.
2. **Neon** — [neon.tech](https://neon.tech): crea tu cuenta (plan Free) y un proyecto
   (por ejemplo `aurora`). Deja la base que crea por defecto; en el paso 4 copias su
   cadena de conexión.

En tu PC necesitas **Node 20 o superior** (el repo trae `.nvmrc` con la versión usada) y Git.

## 2. Preparar el código en tu PC

Desde la carpeta del proyecto (la primera vez, instala dependencias en las dos carpetas):

```bash
npm install          # raíz: dependencias de la app web
npm run build        # compila la app a dist/ — obligatorio antes de desplegar
cd worker
npm install          # dependencias del Worker (Hono, driver de Neon…)
```

> Sin `dist/` el despliegue se detiene con un aviso claro: `prepare-assets` necesita la
> app compilada porque la copia, junto con el panel, a los archivos estáticos del Worker.

## 3. 🧑 Entrar a Cloudflare y crear el bucket de logos

Sigue dentro de `worker/`:

```bash
npx wrangler login
```

Se abre el navegador: autoriza con **tu** cuenta de Cloudflare.

```bash
npx wrangler r2 bucket create aurora-branding
```

El nombre tiene que ser exactamente `aurora-branding`: es el que declara `wrangler.jsonc`.
Ahí vivirán el logo, el icono y el fondo de login que subas desde el panel.

## 4. 🧑 La cadena de conexión de Neon

En la consola de Neon, abre tu proyecto → **Connection string** y copia la cadena
completa (empieza por `postgresql://…`). Es la que usarás como secreto `DATABASE_URL`
en el paso siguiente. No la pegues en ningún archivo del repo.

## 5. 🧑 Los tres secretos

Siguen siendo dentro de `worker/`. Cada comando te pide pegar el valor (no queda en el
historial de la terminal ni en el repo):

```bash
npx wrangler secret put ADMIN_PASSWORD
```

La contraseña con la que entrarás al panel. El usuario es `admin` (es la variable
`ADMIN_USER` de `wrangler.jsonc`; si quieres otro usuario, cámbiala ahí **antes** de
desplegar y vuelve a desplegar).

```bash
npx wrangler secret put SESSION_SECRET
```

Firma y cifra las sesiones. Tiene que ser una cadena aleatoria larga; genérala con:

```bash
openssl rand -hex 32
```

(en Windows sin `openssl`, sirve PowerShell:
`[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`).
Si algún día vienes del servidor Express, usa **el mismo** `SESSION_SECRET` y las
sesiones de tu familia siguen valiendo.

```bash
npx wrangler secret put DATABASE_URL
```

Pega aquí la cadena de conexión de Neon del paso 4.

## 6. Desplegar

Desde `worker/`:

```bash
npm run deploy
```

Ese comando ya hace todo: prepara los archivos estáticos (app compilada + panel) y
despliega con wrangler. Al terminar te muestra la URL, con esta forma:

```
https://aurora-music.<tu-subdominio>.workers.dev
```

La app vive en `/` y el panel en `/admin/`.

## 7. 🧑 Primer uso: dar de alta tu Jellyfin

1. Entra a `https://aurora-music.<tu-subdominio>.workers.dev/admin/` e inicia sesión
   con usuario `admin` y la contraseña del paso 5.
2. En la pestaña **Servidores**, añade tu servidor Jellyfin y deja que el panel lo pruebe
   (botón **Probar**).
   ⚠️ **Importante:** la URL de Jellyfin tiene que ser **alcanzable por HTTPS pública
   desde internet**. En esta ruta es el Worker, desde la nube de Cloudflare, quien llama
   a tu Jellyfin — no tu navegador ni un servidor en tu red. Una dirección tipo
   `http://192.168.1.x:8096` o `http://localhost:8096` **no** funciona aquí (eso solo
   valía con el servidor Express corriendo en tu red local). Necesitas tu Jellyfin
   publicado con HTTPS, por ejemplo con un dominio y Caddy delante, como describe
   `DEPLOY-ORACLE.md`.
3. Crea el **código de acceso** de ese servidor (es el que tu familia escribe para
   entrar; el servidor real queda oculto detrás del código).
4. Para que el importador de YouTube Music pueda crear listas, conecta tu cuenta de
   Jellyfin en la pestaña **Listas de YouTube Music** o guarda una clave API en el
   servidor. Ojo: en el Worker la sesión conectada se guarda cifrada en la base, así
   que no se pierde entre visitas.
5. Abre la app en `/`, entra con el código, y prueba a reproducir una canción y a
   importar una lista pequeña de YouTube Music: ahora el panel la lee y la empareja
   por pasos mostrando el progreso.

> La primera petición tras un rato sin uso puede tardar ~1 s más: Neon se duerme y
> despierta solo. Se nota en el login o el panel, no en una canción ya sonando.

## 8. Actualizar en el futuro

Cuando cambie el código (tuyo o porque te pase un parche), repite solo esto:

```bash
# desde la raíz del proyecto
npm run build
cd worker
npm run deploy
```

El estado (servidores, códigos, ajustes), los logos y las importaciones viven en Neon
y R2: un redespliegue no borra nada ni desloguea a nadie.

Si solo cambias un secreto o el `ADMIN_USER`, no hace falta tocar código: repite el
`wrangler secret put` correspondiente (o edita `wrangler.jsonc`) y vuelve a desplegar.

## 9. Notas

- **Dominio:** por defecto la app sale en `*.workers.dev`, que es gratis y trae HTTPS.
  Si algún día quieres tu propio dominio (p. ej. `musica.tudominio.com`), se añade en
  el panel de Cloudflare → Workers & Pages → `aurora-music` → Settings → Domains &
  Routes, sin tocar código. El dominio tiene que estar en tu cuenta de Cloudflare.
- **Límites del plan free:** 100.000 peticiones/día al Worker (los archivos estáticos
  no cuentan). Para una familia hay margen de sobra; los pasos del importador están
  troceados pensando en esos límites.
- **Riesgo a tener presente:** todo el audio atraviesa la red de Cloudflare sin estar
  alojado en ella (el origen es tu Jellyfin), y los términos de Cloudflare restringen
  servir media que no se entrega con sus productos de media (Stream/R2); el riesgo
  práctico para un reproductor familiar es bajo, pero es un riesgo de plataforma: si
  Cloudflare pusiera pegas algún día, la salida es la ruta Express (misma base Neon,
  mismo `SESSION_SECRET`, nadie tiene que volver a entrar).
- **Si algo falla al desplegar:** `cd worker && npm run check` es el simulacro sin
  subir nada; si pasa y el deploy no, el problema suele ser de cuenta o de secretos,
  no del código.
