# Cómo probar Aurora en este workspace

## Está corriendo ahora mismo

El servidor de demo ya está levantado en el puerto **8787** (mira la vista previa).

| Qué | Cómo entrar |
|---|---|
| **App** | `/` |
| **Código de acceso** | `FAMILIA` |
| **Usuario / contraseña** | `demo` / *(vacío)* |
| **Panel** | `/admin` → usuario `admin`, contraseña `test1234` |

El servidor configurado en el panel apunta al demo público de Jellyfin, para que puedas probar sin exponer tu biblioteca. En el panel puedes cambiar la URL y el código por los tuyos.

### Si el panel no entraba desde la vista previa

La vista previa mete la app en un `<iframe sandbox="allow-scripts">`, y en ese contexto el navegador:

- bloquea el envío de formularios (`allow-forms` no está activado) → el botón «Entrar» parecía no hacer nada,
- bloquea cookies, `localStorage`, `sessionStorage` e IndexedDB,
- manda `Origin: null` en cada petición, así que hacía falta CORS.

Ya está resuelto: el login del panel y el de la app funcionan con click (sin `<form>`), el panel guarda el token en memoria cuando no hay storage, el servidor arranca con `SANDBOX_ORIGIN=1` para aceptar ese origen nulo, y la portada usa almacenamiento en memoria si el navegador lo niega. En un navegador normal nada de esto cambia el comportamiento (la sesión persiste al recargar).

### Sobre la sesión del panel

El login del panel devuelve un **token firmado** (12 h) que el navegador guarda y envía en la cabecera `Authorization: Bearer …`. Se hace así porque la cookie `httpOnly` no sobrevive dentro de la vista previa en iframe; la cookie sigue enviándose como respaldo cuando el navegador la acepta. Si el token caduca, el panel vuelve solo a la pantalla de acceso con el aviso «Sesión caducada».

En esta vista previa el iframe **no puede reproducir sonido**: el navegador no crea el elemento `<audio>` (de ahí el mensaje "Failed to play"). Para oír música, abre la app en una pestaña aparte con el mismo puerto.

## Reconstruir tras un cambio

```bash
cd /home/user/aurora
npm run build            # compila la app web en /dist
# el servidor sirve /dist automáticamente; sólo hay que recargar el navegador
```

Si cambias algo del backend, reinicia el proceso:

```bash
ADMIN_PASSWORD=test1234 SESSION_SECRET=devsecret PORT=8787 node server/src/index.js
```

## Probar en local desde cero

```bash
cd /home/user/aurora
npm install
npm run build
ADMIN_PASSWORD=test1234 SESSION_SECRET=devsecret npm run serve
```

## Verificado en este workspace

- `npx tsc --noEmit` → **sin errores** (TypeScript 6)
- `npx eslint .` → **0 errores** (34 avisos del React Compiler, intencionados)
- `npx vite build` → **OK**, bundle inicial ~150 kB gzip (antes 411 kB)
- Login por código contra Jellyfin real (demo público) → **OK**
- Proxy de audio con `Range` → **206 Partial Content** (streaming correcto)
- Importación real de YouTube Music (100 pistas + continuación) → **OK**
- Creación de playlist en Jellyfin desde el panel → **OK**
- Recorrido con navegador real: login → home → búsqueda → ajustes → temas → inglés → panel → **sin errores de JS**
- Now Playing: portada centrada, «Reproduciendo de …», calidad localizada (`Baja · 192 kbps`), letra vacía como «Esta canción no tiene letra»
- Panel sin cookies (simulando el iframe): entra con el token y sobrevive a la recarga
- Proxy tras el arreglo: `Sessions/Playing` **204**, `Sessions/Playing/Progress` **204**, `PlaybackInfo` **200**, `UserFavoriteItems` **200**, `Audio/.../universal` con `Range` **206**
- Iconos propios del PWA (`public/icon.svg`, `favicon-96x96.png`, `web-app-manifest-*`), sin logo de Jellyfin
- Los 404 que quedan en la consola son de una carátula ausente en el servidor demo y de `Audio/<id>/Lyrics` (esa pista no tiene letra): esperados
- Títulos de página y `<title>` del navegador en español: Canciones, Álbumes, Artistas de álbum, Géneros, Favoritos, Escuchado hace poco, Más escuchado, Descargadas, Cola, Ajustes
- Menú contextual de una canción en español: «Reproducir después · Añadir a la cola · Ir a la mezcla · Ver artista · Ver álbum · Añadir a favoritos · Añadir a lista · Descargar»
