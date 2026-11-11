# Fase 1 — Persistencia en Postgres con fallback total a aurora.json

Rama: `persistencia-db` (desde `main`; ya publicada en GitHub). Todo el trabajo es del servidor
(`server/`); el comportamiento sin `DATABASE_URL` es idéntico al anterior.

## Diseño

La API del Store sigue siendo **síncrona** y nadie que la usa (admin.js,
index.js, proxy.js) tuvo que cambiar su forma de llamarla. Postgres es una
capa espejo en segundo plano, nunca la fuente en caliente:

- **`server/src/persist.js`** (nuevo). Sólo se activa si existe `DATABASE_URL`
  (Postgres genérico: Neon, Supabase vía pooler o uno propio; usa el paquete
  `pg`, Pool máx. 2 conexiones). TLS según la URL: `sslmode=require|prefer|
  verify-*` → `{ rejectUnauthorized: false }`; `sslmode=disable` → sin TLS;
  sin `sslmode`, TLS para hosts `*.neon.tech` / `*.supabase.co|.com` y sin TLS
  en local. Dos tablas, creadas con `CREATE TABLE IF NOT EXISTS`:
  - `aurora_state (id int PK, data jsonb, updated_at timestamptz)` — una sola
    fila `id=1` con el estado completo, el mismo objeto de `aurora.json`.
  - `aurora_assets (slot text PK, filename text, mime text, bytes bytea,
    updated_at timestamptz)` — los bytes de cada logo/branding por slot.
  - Funciones: `initPersist()`, `loadState()`, `saveState()` (upsert),
    `loadAsset()`, `saveAsset()`, `deleteAsset()`. **Todas** capturan sus
    errores, hacen `console.warn('[aurora] persist: …')` y devuelven
    `null`/`false`: nunca lanzan. Si `initPersist` falla, no memoriza el
    fallo: el siguiente guardado lo reintenta.
- **`server/src/config.js`**: `config.databaseUrl = process.env.DATABASE_URL || ''`.
- **`server/src/store.js`**:
  - `save()` escribe primero el JSON local (tmp + rename, como siempre) y
    después encola `saveState(snapshot)` en **segundo plano**. Los guardados
    en Postgres van serializados por una cola interna (`#persistQueue`) para
    que el último estado gane siempre y no se pisen entre sí.
  - `Store.hydrate()` (async, lo llama el arranque): si persist está activo y
    Postgres tiene estado, ese estado **manda** — se fusiona con
    `DEFAULT_DATA` igual que hace la carga del JSON — y se vuelca también a
    `aurora.json` para que el fallback local quede al día. Si Postgres aún no
    tiene estado, se **siembra** con el JSON local (primera migración
    automática). Si Postgres está caído, devuelve `false` y se sigue con el
    JSON como siempre.
  - Assets: `setAsset()` no cambia; nuevo `saveAssetBytes(slot, buffer,
    {filename, mime})` para sincronizar los bytes (segundo plano), y
    `removeAsset()` ahora también encola `deleteAsset(slot)`. Nuevo
    `loadAssetBytes(slot)` para leer de Postgres al servir.
- **`server/src/admin.js`**: en `POST /api/assets/:slot`, tras el rename a
  disco y `Store.setAsset` de siempre, lee el archivo final y llama a
  `Store.saveAssetBytes(...)` con los bytes y el `mimetype` de multer
  (envuelto en try/catch: una subida nunca falla por esto). El `DELETE` no
  necesitó cambios: pasa por `Store.removeAsset()`, que ya sincroniza la
  baja. La copia en disco se mantiene en todos los casos como fallback.
- **`server/src/index.js`**:
  - `await Store.hydrate()` antes del bootstrap del admin. No hizo falta
    envolver nada en un `main()`: el archivo ya usaba top-level await
    (`await bootstrap()`).
  - `GET /branding/:slot` y el favicon (`sendIcon`) ahora son async: sirven
    el archivo local si existe; si no existe (disco efímero tras un reinicio
    o redeploy) y persist está activo, sirven los bytes desde Postgres con
    su mime. Si tampoco está allí, el comportamiento anterior (404 / icono
    por defecto).
- **`server/package.json` / `package-lock.json`**: nueva dependencia `pg@^8.23.1`.
- **`.env.example` y `deploy/aurora.env.example`**: `DATABASE_URL` documentada
  como opcional y comentada, sin valores reales.

## Cómo se activa

Define `DATABASE_URL` en el entorno del servidor (p. ej. la cadena de
conexión del pooler de Neon o Supabase, con `?sslmode=require`). Nada más:
al arrancar se crean las tablas y se siembra/hidrata el estado. Sin la
variable, esta fase es invisible.

## Qué pasa si la DB cae

- **Al arrancar**: `hydrate()` no consigue estado → se arranca desde
  `aurora.json` y el servidor responde normal (verificado, ver abajo).
- **En caliente**: cada `save()` deja el JSON local al día en el acto; el
  guardado en Postgres falla en segundo plano con un `console.warn` y se
  reintenta en el siguiente `save()` (los snapshots van por cola, el más
  reciente es el último en escribirse). Cuando la DB vuelve, el estado se
  reconcilia solo con el siguiente cambio guardado.
- **Assets**: si Postgres cae, las subidas siguen guardándose en disco; al
  servir, manda el archivo local si existe.

Limitación conocida de esta fase: si la DB cae *durante* el arranque y el
JSON local estaba vacío/desactualizado (p. ej. primer arranque en un disco
efímero), no hay de dónde recuperar hasta que la DB vuelva; el servidor
arranca igual con el estado por defecto/local. Es el mismo riesgo que ya
existía sin esta fase.

## Pruebas realizadas (2026-11-11)

1. **Línea base en `main`** (antes de tocar nada): `npm test` → 62/68 con un
   fallo preexistente (`worker/tests/backend.test.js` no encontraba
   `@electric-sql/pglite` por no estar instaladas las dependencias de
   `worker/`). Instaladas éstas: **68/68**.
2. **Suite tras los cambios**: `npm test` (raíz, `node --test`: server +
   worker) → **68/68, 0 fallos**. ESLint sobre los 5 archivos tocados del
   servidor: limpio.
3. **Arranque sin `DATABASE_URL`**: `/api/app-config` → HTTP 200, sin una
   sola línea de persist en el log; comportamiento idéntico al actual.
4. **Arranque con `DATABASE_URL` inválida** (`postgres://…@127.0.0.1:1/…`):
   el servidor arranca igual, `/api/app-config` → HTTP 200, `aurora.json` se
   crea en local y el log muestra los avisos
   `persist: initPersist falló (connect ECONNREFUSED…); sigo con aurora.json`.
   Es el test del fallback pedido.
5. **Postgres real** (instancia local desechable con `embedded-postgres`,
   fuera del repo, sin credenciales reales):
   - Arranque 1 con DB vacía: tablas creadas, estado sembrado; vía panel se
     creó un servidor (código `FAMILIA1`) y se subió un logo PNG de 67 bytes.
   - Arranque 2 borrando **sólo los archivos** de `data/assets`:
     `estado cargado desde Postgres` y `GET /branding/logo` → HTTP 200 con
     los 67 bytes exactos servidos desde la tabla `aurora_assets`.
   - Arranque 3 borrando **`aurora.json`**: el estado (1 servidor `FAMILIA1`
     y el índice de assets) se recuperó de Postgres y `aurora.json` quedó
     reconstruido en local.

## Qué falta (Fase 2)

- Worker de Cloudflare para el ancho de banda (el proxy de audio/HLS sigue
  pasando por el servidor Node en esta fase). Nota: el repo ya contiene una
  carpeta `worker/` (gateway en Workers con estado en Neon y logos en R2)
  que parece ser la base de esa fase.
- Migración de assets *huérfanos*: los logos subidos **antes** de activar
  `DATABASE_URL` sólo se sincronizan a Postgres cuando se vuelve a subir
  cada slot (el estado `aurora.json` sí se siembra entero al primer
  arranque; los bytes no). Si hiciera falta, sería un script de una sola vez
  que recorra `data/assets`.
- Sin cambios en despliegue: en Render/hosts de disco efímero hay que
  definir `DATABASE_URL` (y el cron de keep-alive sigue siendo asunto
  aparte, no de esta fase).
