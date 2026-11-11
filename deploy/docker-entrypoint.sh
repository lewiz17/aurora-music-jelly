#!/bin/sh
# Arranque del contenedor. Los volúmenes persistentes de varias plataformas (Fly.io, Railway,
# Render...) se montan con propietario root, y la app no debe correr como root: se arregla el
# propietario de la carpeta de datos y luego se baja de privilegios al usuario "node".
# En Docker con volumen con nombre (deploy/oracle) el chown no cambia nada.
set -e

DATA="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DATA"
    chown -R node:node "$DATA"
    exec su-exec node:node "$@"
fi

exec "$@"
