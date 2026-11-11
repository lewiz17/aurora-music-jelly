# Revisión del port a Cloudflare Workers (`worker/`) — Aurora Music

Auditoría de solo lectura sobre la rama `persistencia-db` (el `worker/` es idéntico en `main`:
`git diff main..persistencia-db -- worker/` no muestra diferencias). No se modificó código ni se
desplegó nada. Fecha: 2026-11-11.

**Resumen ejecutivo:** no es un esqueleto. Es un port fiel, bien estructurado y con tests que
prueban compatibilidad byte a byte con el Express. Estado: **casi listo**. El único hueco
funcional real es el flujo del importador en el panel (ver §1, fila 12). Paridad medida:
**17 completas / 3 parciales / 0 ausentes** sobre 20 filas.

---

## 1. Paridad funcional con el Express

El worker reutiliza por importación directa los módulos sin dependencias de Node del servidor:
`server/src/themes.js`, `server/src/match.js`, `server/src/ytmusic.js` y
`server/src/jellyfin-admin.js` no tienen ningún `import` de `node:` (verificado con grep), así que
temas, matching, lectura de YouTube Music y llamadas admin a Jellyfin son **el mismo código** en
ambos runtimes, no una reimplementación.

| # | Feature | Estado | Evidencia |
|---|---------|--------|-----------|
| 1 | Login con código de acceso (`POST /api/login`) | ✅ Completa | `worker/src/gateway.js:47-93` replica `server/src/proxy.js:76-112`: mismo auth contra Jellyfin (`/Users/AuthenticateByName`), mismos errores (`unknown_code` 404, `invalid_credentials` 401, `upstream_unreachable` 502) y solo cuenta el 401 como fallo. |
| 2 | `POST /api/resolve-code` (con anti-enumeración) | ✅ Completa | `gateway.js:95-110`; el fallo también suma intento, igual que `proxy.js:115-123`. |
| 3 | Sesiones del gateway (token cifrado) | ✅ Completa y **compatible** | AES-256-GCM, layout `base64url(iv 12 \| tag 16 \| cifrado)`, clave SHA-256(`SESSION_SECRET`): `worker/src/crypto.js:3-9, 47-84` vs `server/src/session.js:5-25`. Test cruzado en los dos sentidos: `worker/tests/crypto.test.js:24-32` (11/11 tests del worker en verde, §3). Un token emitido por el Express vale en el Worker y viceversa con el mismo secreto. |
| 4 | Token de admin (HMAC) | ✅ Completa y compatible | `crypto.js:110-141` vs `session.js:40-67`; test cruzado + caducidad + manipulación en `crypto.test.js:46-55`. Mismo formato `base64url(payload).base64url(HMAC)`, 12 h. |
| 5 | Proxy de streams/imágenes/HLS (`/jf/:token/*`) | ✅ Completa | `gateway.js:113-189`. **Streaming passthrough real**: devuelve `new Response(upstream.body, …)` sin bufferizar (`gateway.js:188`; el scrub solo toca JSON pequeño). Reenvía las cabeceras del cliente salvo hop-by-hop/`authorization`/`accept-encoding` (y además filtra `cf-*`/`x-forwarded-*`, mejora sobre el Express), así que **Range pasa** y `Content-Range`/`Content-Length` de la respuesta también. Elimina `apiKey`/`ApiKey` de la query (`gateway.js:130-131`), reescribe redirects absolutos del Jellyfin oculto (`:168-172`), no filtra `set-cookie` del upstream (`:160`) y aborta el upstream si el cliente se va (`signal: c.req.raw.signal`, `:152`). Equivalente a `server/src/proxy.js:128-208`. |
| 6 | Scrub de identidad ("Jellyfin"→marca) en JSON | ⚠️ Parcial | Mismo algoritmo (`gateway.js:177-186`), pero el umbral por defecto es **1 MB** (`SCRUB_MAX_BYTES`, `gateway.js:44`) frente a **2 MB** en el Express (`proxy.js:190`). Un JSON de 1–2 MB saldría sin scrub en el Worker. Ajustable por variable. |
| 7 | Auth del panel (login/logout/me, cookie + Bearer) | ✅ Completa | `worker/src/admin.js:82-124`. Diferencia de mecanismo, forzada por el runtime: compara contra los secretos `ADMIN_USER`/`ADMIN_PASSWORD` con comparación en tiempo constante (`crypto.js:safeEqual`) en vez del hash scrypt almacenado del Express — el propio código lo explica: scrypt reventaría el presupuesto de CPU del plan free (`admin.js:5-6`). Sin `ADMIN_PASSWORD`, login → 409 `no_admin` y `/me` reporta `configured:false`, como el Express sin admin. |
| 8 | Panel: settings | ✅ Completa | `admin.js:171-177`, mismas 6 claves permitidas que `server/src/admin.js:157-168`. |
| 9 | Panel: servidores/códigos (CRUD, test, apiKey, activo) | ✅ Completa | `admin.js:180-236`: mismas validaciones (URL http(s), código único → 409 `code_taken`), mismo `POST /servers/:id/test` con `publicInfo` + `pickUserId` si hay apiKey. |
| 10 | Panel: branding (subir/borrar/servir) | ✅ Completa | `admin.js:239-267` + `index.js:57-73`. Mismos 6 slots, mismos tipos MIME y mismos límites (4 MB, 12 MB fondo de login) que `server/src/admin.js:13-14`. En el Worker los bytes van a **R2** (clave `${slot}-${Date.now()}${ext}`) en vez de a disco; servido por `/branding/:slot` con `Cache-Control: public, max-age=60`, igual que el Express. |
| 11 | Sesión Jellyfin admin para el importador | ✅ Completa (**mejor que el Express**) | `worker/src/jellyfin.js:16-59`: misma regla (apiKey primero, cuenta conectada después, misma caducidad de 20 días que `server/src/jellyfin-admin.js:95-103`), pero la sesión se guarda **cifrada en la BD** (`sealJson`, `crypto.js:154-159`) en vez de en memoria. En el Express la sesión se pierde en cada reinicio/redespliegue y hay que reconectar la cuenta; en el Worker sobrevive. |
| 12 | Importador YT Music: lectura de la playlist | ✅ Completa | `admin.js:274-311` usa `readPlaylistPage` de `server/src/ytmusic.js:145` (el mismo módulo; `fetchPlaylist` del Express se apoya en él). Límite 500 pistas en ambos. |
| 13 | Importador: matching contra Jellyfin | ✅ Completa (backend) | `admin.js:318-364`: mismo `rankCandidates`/`mapLimit` importados de `server/src/match.js` y mismo `searchTracks` de `jellyfin-admin.js`. Cambia la forma: por pasos (`POST /imports/:id/step`), primero páginas restantes (`YT_PAGES_PER_STEP`=2) y luego lotes de `MATCH_BATCH`=25 búsquedas con concurrencia 4, para no reventar subrequests/CPU por petición. |
| 14 | Importador: **flujo completo en el panel** | ⚠️ Parcial — **el hueco real** | El panel que se sirve es `server/admin/index.html` **sin cambios** (`prepare-assets.mjs:23`), y el panel **nunca llama a `/step`**: tras `POST /api/imports` toma el registro como final (`server/admin/index.html:989-997`, toast «N pistas leídas» y render de estados/candidatos). Contra el Worker ese POST devuelve las pistas en estado `pending` y sin candidatos (solo primera página): el panel mostraría todo «pendiente», 0 emparejadas, y **Aplicar devuelve 409 `incomplete`** (`admin.js:396-398`). El comentario de `worker/src/admin.js:3` («the panel works unchanged») es cierto para el resto de rutas, pero no para este flujo. Arreglo pequeño y acotado: que el panel, tras crear la importación, llame a `/step` en bucle hasta `phase:'done'` (las respuestas ya traen progreso: `admin.js:366-371`). |
| 15 | Importador: revisión manual (overrides) y apply | ✅ Completa | `admin.js:373-433`: misma semántica de overrides que `server/src/admin.js:321-341` y mismo `selectPlaylistIds` para crear la lista; apply exige importación completa (409 si quedan `pending`). |
| 16 | Temas | ✅ Completa | Por construcción: `worker/src/store.js:1` importa `THEMES` de `../../server/src/themes.js` (las 414 líneas del catálogo, un solo origen). `/api/app-config` devuelve `themeVars` del tema por defecto (`index.js:33-44`). |
| 17 | Rate limiting de logins | ✅ Completa (**mejor**) | `worker/src/context.js:4-29` + tabla `aurora_attempts` (`backends.js:160-182`): mismos defaults (10 fallos / 15 min, variables `LOGIN_MAX_FAILURES`/`LOGIN_WINDOW_MS`), mismo 429 con `Retry-After`, claves separadas `admin:`/`gateway:`, IP real vía `cf-connecting-ip` no falsificable. Mejor que el Express porque el contador vive en Postgres (global entre isolates) y no en memoria por proceso (`server/src/ratelimit.js`). |
| 18 | `/api/app-config` | ✅ Completa | `index.js:33-44`: misma forma de respuesta que el Express (`publicBranding` + `assets` + `themeVars`), `Cache-Control: no-store`. |
| 19 | PWA / estáticos / favicon dinámico | ✅ Completa | Workers Static Assets: `prepare-assets.mjs` copia `../dist` (build de Vite, incluye `sw.js` y precache) + `server/admin/index.html` a `worker/public/`, y escribe `public/_headers` (cabeceras de seguridad + `immutable` para `/assets/*`). `wrangler.jsonc:8-22`: SPA fallback (`not_found_handling: single-page-application`) y `run_worker_first` solo para `/api/*`, `/jf/*`, `/admin/api/*`, `/branding/*` y los iconos — el resto se sirve como estático, gratis e ilimitado. El favicon/PWA usa el icono subido si existe (`index.js:75-84`), igual que el Express. |
| 20 | Cabeceras de seguridad | ⚠️ Parcial (menor) | `index.js:19-31` pone las mismas cabeceras y envuelve la respuesta como stream sin bufferizar. Dos diferencias: el default de `FRAME_ANCESTORS` es `'self'` (Express: `'self' https: http:`), y **no existe el extra CORS `SANDBOX_ORIGIN`** del Express (`server/src/index.js:82-98`) para incrustar app/panel en iframes sandbox con `Origin: null`. Solo afecta a vistas previas en sandbox, no a un despliegue normal. |

Notas menores: no hay equivalente del `DEBUG_PROXY` del Express (solo diagnóstico). La página
del panel se sirve como estático en `/admin/` (el Express la sirve en `/admin` y `/admin/`);
conviene verificar el comportamiento exacto de `/admin` sin barra tras desplegar.

**Conteo: 17 completas / 3 parciales (filas 6, 14 y 20) / 0 ausentes.**

---

## 2. Estado y datos

**Modelo: documento JSON único, no tablas normalizadas** — deliberado y documentado en
`worker/src/backends.js:14-17`:

- `aurora_config` — **una sola fila** (`id=1`) con `data jsonb` = el mismo objeto que
  `aurora.json` (settings, servers, assets, jfSessions) + columna `version` para concurrencia
  optimista. Las escrituras son read-modify-write con reintento (hasta 4) si otro isolate
  escribió entre medias (`worker/src/store.js:117-129`).
- `aurora_imports` — una fila por importación, con `summary jsonb` (conteos) separado del
  `data jsonb` completo (cientos de pistas con candidatos), para que listar sea barato y el
  gateway nunca cargue las importaciones.
- `aurora_attempts` — contadores del rate limiting (`key`, `count`, `reset_at`).

**Caché:** la config se cachea 15 s por isolate (`store.js:87-103`), así que el camino caliente
(un stream en curso) no toca la BD; el panel usa `snapshot()` sin caché para no ver datos
viejos tras guardar.

**R2:** solo para branding. Binding `BRANDING` → bucket `aurora-branding`
(`wrangler.jsonc:25`). La config guarda el nombre de objeto por slot; al sustituir un logo se
borra el objeto anterior (`admin.js:258-259`). Hay un `MemoryBucket` de sustitución para
`wrangler dev`/tests si no hay binding (`worker/src/bucket.js:30-34`) — ojo: **si el binding
faltara en producción, los logos vivirían en memoria del isolate y se perderían**; el dry-run
confirma que el binding queda bien declarado (§3).

**Migraciones: automáticas y perezosas.** No hay archivos de migración. `PgBackend.ready()`
ejecuta los 3 `CREATE TABLE IF NOT EXISTS` la primera vez que un backend toca la BD, con
reintento si falla (`backends.js:110-120`), y la primera lectura siembra la fila de config con
`DEFAULT_CONFIG` (`store.js:91-99`). Cero SQL manual al desplegar.

**Si Neon no responde:** es el punto débil estructural del Worker. No hay fallback local
posible (un Worker no tiene disco): `getStore` sin `DATABASE_URL` lanza `not_configured` →
**503** (`store.js:230-236`, `index.js:91-94`); con BD caída, las queries lanzan y el handler
global responde **500** (`index.js:90-98`). Matiz: el gateway puede seguir sirviendo mientras
la caché de config del isolate esté caliente (15 s), pero logins y panel caen con la BD. El
Express de la fase 1 es al revés: `server/src/persist.js` captura todos sus errores y sigue con
`aurora.json` — Postgres es allí un respaldo, aquí es **la** fuente. A cambio, Neon escala a
cero: la primera petición tras un rato sin uso paga el despertar de la BD (típicamente ~1 s),
visible sobre todo en login/panel, no en un stream ya en curso.

**Sesiones del gateway:** sin estado en servidor en ambos runtimes (token cifrado autocontenido),
así que ni dormidas ni reinicios echan a los oyentes en ninguna de las dos rutas.

---

## 3. Desplegabilidad

`worker/wrangler.jsonc` completo (36 líneas): nombre `aurora-music`, `main: src/index.js`,
`compatibility_date: 2026-11-11`, assets con `run_worker_first` acotado, bucket R2 declarado y
`vars: { ADMIN_USER: "admin" }`. **No hay dominio ni rutas personalizadas**: saldría en
`https://aurora-music.<subdominio>.workers.dev`. No hay placeholders tipo «CAMBIA-ESTO» que
rellenar (a diferencia del `fly.toml` del Express); el nombre del Worker es por cuenta, no
global.

**Hay que crear antes (una sola vez):**

1. La app web compilada: `npm run build` en la raíz — sin `../dist`, `prepare-assets.mjs:10-13`
   aborta con error claro. Es paso previo a `dev`/`deploy`/`check`.
2. El bucket R2: `npx wrangler r2 bucket create aurora-branding` (nombre exacto del binding).
3. Un proyecto/base en **Neon** y su cadena de conexión.
4. Tres secretos (lista exacta, de `wrangler.jsonc:28-31`):
   - `npx wrangler secret put ADMIN_PASSWORD`
   - `npx wrangler secret put SESSION_SECRET` (si se reutiliza el del Express, las sesiones
     existentes siguen valiendo, §1 fila 3)
   - `npx wrangler secret put DATABASE_URL`
5. Cuenta de Cloudflare y login de wrangler (`wrangler login`) — es lo único que el dry-run no
   ejercita.

**Opcionales** (variables, con defaults sensatos): `LOGIN_MAX_FAILURES`, `LOGIN_WINDOW_MS`,
`FRAME_ANCESTORS`, `MATCH_BATCH`, `YT_PAGES_PER_STEP`, `SCRUB_MAX_BYTES`.

**Verificaciones ejecutadas en esta auditoría (resultados reales):**

- `npm run check` (= `prepare-assets` + `wrangler deploy --dry-run`): **✅ pasa sin credenciales**.
  Salida de wrangler 4.160.1: «Read 99 files from the assets directory», **Total Upload:
  362.04 KiB / gzip: 90.79 KiB**, bindings reconocidos: `env.BRANDING (aurora-branding)` R2,
  `env.ASSETS` Assets, `env.ADMIN_USER ("admin")`. `--dry-run: exiting now.`
  Nota: **wrangler no está fijado como dependencia** (no está en `worker/package.json` ni en el
  lockfile); `npx` descargó la 4.160.1 sobre la marcha. Funciona, pero la versión puede cambiar
  entre despliegues; conviene fijarla en `devDependencies`.
- Tests del worker (`node --test tests/backend.test.js tests/crypto.test.js`): **11/11 ✅**
  (contrato de almacenamiento contra memoria y contra Postgres real en WASM —PGlite—;
  compatibilidad cruzada de tokens Node↔Worker). Nota: `node --test tests/` a secas falla en
  Node 24 por cómo resuelve el directorio, no por los tests.
- Suite completa del repo (`npm test` en la raíz): **68/68 ✅** (incluye los 11 del worker y
  los 57 del servidor Express).

---

## 4. Riesgos y límites del plan free de Cloudflare, aplicados a este Worker

1. **Peticiones: 100.000/día (free).** Los estáticos no cuentan (van por Static Assets, gratis
   e ilimitados), pero **cada stream, cada imagen y cada llamada a la API de Jellyfin pasa por
   el Worker**. Una familia navegando la librería genera miles de peticiones/día (portadas,
   listas, segmentos HLS); aun así hay un orden de magnitud de margen. No es el límite que
   muerde primero.
2. **CPU: 10 ms por petición (free).** El diseño está pensado para ello: el cuerpo del upstream
   se devuelve como stream (`gateway.js:188`) y **esperar a la red no consume CPU**, así que un
   stream largo no quema presupuesto; el scrub solo procesa JSON < 1 MB (`gateway.js:176`); y
   hasta el login evita scrypt por este motivo (`admin.js:5-6`). El trabajo pesado (matching)
   está troceado en pasos de 25 búsquedas. Riesgo bajo y bien gestionado.
3. **Subrequests: 50 por petición (free).** Camino caliente: 0–4 fetches a Neon (caché de 15 s)
   + 1 al Jellyfin. El paso de matching: 25 búsquedas a Jellyfin + ~3 a Neon + credenciales ≈
   30 — dentro, pero es el margen más estrecho; subir `MATCH_BATCH` mucho lo rompería.
4. **Términos de media de Cloudflare — el riesgo estratégico.** Todo el audio de la familia
   atravesaría la red de Cloudflare **sin estar alojado en Cloudflare** (el origen es un
   Jellyfin externo). Los términos de Cloudflare restringen históricamente servir vídeo/audio
   a través de su red cuando el contenido no se entrega con sus productos de media (Stream/R2);
   el plan free no tiene SLA y el ancho de banda «desproporcionado» puede acabar en limitación
   de la cuenta. Para una familia el volumen real es modesto y el riesgo práctico es bajo, pero
   es un riesgo de plataforma que la ruta Express no tiene, y es el argumento más serio contra
   el todo-Cloudflare a largo plazo.
5. **Dependencia dura de Neon** (§2): sin fallback local; caída de Neon = login y panel caídos
   (500/503) y gateway solo con la caché caliente. El plan free de Neon (escala a cero) añade
   latencia de despertar en la primera petición tras inactividad.
6. **Menores:** wrangler sin fijar (§3); si el binding R2 faltara, `bucket.js` degradaría a
   memoria sin avisar; el subdominio `workers.dev` deja el panel expuesto a internet (como
   cualquier despliegue: lo protegen contraseña + rate limiting en BD).

---

## 5. Veredicto

**El Worker está «casi listo», no es un esqueleto:** paridad 17/3/0, tests 68/68, dry-run
limpio. Lo que falta, en orden:

1. **Parche del panel** para conducir el importador por pasos (bucle a `/imports/:id/step`
   hasta `phase:'done'`, mostrando el progreso que la API ya devuelve). Un solo archivo
   (`server/admin/index.html`), cambio pequeño; sin él, importar playlists queda roto en la
   ruta Cloudflare aunque el backend esté completo.
2. **Montaje de cuentas/recursos** (bucket R2, proyecto Neon, 3 secretos, build) — una tarde,
   sin escribir SQL ni código de servidor.
3. Opcional: fijar wrangler en `devDependencies` y, más adelante, dominio propio.

**Recomendación: ruta (A), todo-Cloudflare con `worker/`**, para este caso (reproductor
familiar, Jellyfin externo):

- **Menos trabajo restante:** la (B) ya tiene la fase 1, pero le quedan el pinger anti-dormida,
  aceptar el techo de **5 GB/mes de salida de Render free** (con suspensión sin tarjeta) — que
  para streaming de audio en familia es estructural, no un detalle — y la sesión admin del
  importador que se pierde en cada reinicio. La (A) solo necesita el parche del panel y el
  alta de recursos.
- **Mejor experiencia:** sin dormidas ni arranques en frío del servidor (borde de Cloudflare;
  solo despierta Neon, y solo lo notan login/panel), estáticos gratis e ilimitados, ancho de
  banda de Workers sin el contador de 5 GB, y la misma Neon sirve de estado a ambas rutas —
  con tokens compatibles, migrar de una a otra no desloguea a nadie.
- **La salvedad honesta:** el riesgo de términos de media de Cloudflare (§4.4). Si algún día
  Cloudflare pusiera pegas, la salida natural es la ruta (B) pagando el Render de $7/mes (sin
  dormidas y con disco), reutilizando la misma base Neon y el mismo `SESSION_SECRET`.
