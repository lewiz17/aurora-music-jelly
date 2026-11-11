# Desplegar Aurora en Fly.io (sin tocar tu instancia de Oracle)

Funciona **igual que ahora**: es el mismo contenedor (app + panel `/admin`), con un volumen para
`aurora.json` y los logos. Fly pone el HTTPS y el dominio `https://TU-APP.fly.dev`.

> No lo he podido ejecutar contra una cuenta de Fly: el `fly.toml` usa sólo claves de su
> documentación, pero revisa la salida de cada comando.

## Qué cuesta (precios de la documentación de Fly, en la fecha de esta guía)

- Máquina `shared-cpu-1x` 512 MB siempre encendida: **3,69 USD/mes** (la de 256 MB: 2,19).
- Volumen de 1 GB: 0,15 USD/mes. Tráfico de salida: 0,02 USD/GB (Norteamérica y Europa).
- **No hay capa gratuita** para cuentas nuevas y piden **tarjeta**, pero si la factura mensual de
  tu organización personal es **menor de 5 USD, la perdonan** ("free waiver"). Con este uso
  (unos 4 USD) sale a 0, mientras esa política siga vigente.

## Qué tiene que cumplirse

- Tu **Jellyfin debe ser alcanzable desde internet** con una URL **HTTPS**. Aurora lo llama desde
  los servidores de Fly: si usas `http://IP:8096`, el usuario y la contraseña viajarían sin cifrar.
- Una sola máquina con un solo volumen: la documentación de Fly avisa de que implica **un corte
  breve en cada despliegue** y riesgo de pérdida si el disco falla. Por eso hay que hacer copias
  (paso 7). No se pueden poner dos réplicas: Aurora guarda su estado en un fichero local.

## Pasos

1. Instala `flyctl` (<https://fly.io/docs/flyctl/install/>), crea cuenta y añade la tarjeta:
   `fly auth login`.
2. Edita `fly.toml`: cambia `app` por un nombre único y, si quieres, `primary_region`.
3. Crea la app y el volumen (misma región que `primary_region`):

   ```bash
   fly apps create TU-APP
   fly volumes create aurora_data --size 1 --region iad
   ```

4. Guarda los secretos (no van en `fly.toml`). En PowerShell:

   ```powershell
   $secret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
   fly secrets set ADMIN_PASSWORD="UNA-CLAVE-LARGA" SESSION_SECRET=$secret
   ```

5. Despliega desde la carpeta del proyecto: `fly deploy`. Fly construye la imagen con el
   `Dockerfile` (no hace falta Docker en tu PC).
6. Entra a `https://TU-APP.fly.dev/admin` (usuario `admin`), añade tu servidor con su URL HTTPS de
   Jellyfin y un código, y prueba con **Probar**.
7. **Copias de seguridad.** Fly hace snapshots diarios del volumen (5 días por defecto), pero no
   son tu copia principal. Baja el estado de vez en cuando:

   ```bash
   fly ssh sftp get /data/aurora.json aurora-backup.json
   ```

   (comprueba la sintaxis con `fly ssh sftp --help`; los logos están en `/data/assets`).

## Actualizar

Cambia el código y `fly deploy` otra vez. Tus datos viven en el volumen.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `fly deploy` falla al arrancar con `EACCES` en `/data` | El volumen no es escribible: el `docker-entrypoint.sh` debía arreglarlo. Mira `fly logs` |
| **Probar** da error | La URL de Jellyfin no es alcanzable desde internet, o no es HTTPS válido |
| 429 "Demasiados intentos" | Límite de fallos del login (15 min). `fly apps restart TU-APP` lo reinicia |
| Todos los visitantes comparten el bloqueo | Hay más de un proxy delante: define `TRUST_PROXY` con el número de saltos (`fly secrets set TRUST_PROXY=2`) |

## Otras plataformas, en una línea (datos de sus documentos oficiales)

- **Render gratis:** no sirve tal cual. Se duerme a los 15 min y su disco se **borra** en cada
  reinicio o redespliegue; los discos persistentes son sólo de pago. Perderías códigos, logos y ajustes.
- **Railway:** el plan gratis da 1 USD de crédito al mes (insuficiente para tenerlo siempre
  encendido); Hobby cuesta 5 USD/mes e incluye 5 USD de uso, con volúmenes.
- **Vercel:** no sin cambiar el código (sin disco persistente). Ver la conversación previa.
