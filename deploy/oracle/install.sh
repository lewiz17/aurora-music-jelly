#!/usr/bin/env bash
# Instala/actualiza Aurora (app + panel) con HTTPS automático en esta máquina.
#   ./deploy/oracle/install.sh              # pregunta el dominio, genera claves, construye y arranca
#   ./deploy/oracle/install.sh --no-start   # sólo prepara deploy/oracle/.env
# Es seguro repetirlo: no pisa un .env existente y los datos viven en volúmenes de Docker.
set -euo pipefail

cd "$(dirname "$0")/../.."
ENV_FILE="deploy/oracle/.env"
START=1
[ "${1:-}" = "--no-start" ] && START=0

rand_hex() {
    if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32; else
        head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64 || true
    fi
}
rand_pass() {
    if command -v openssl >/dev/null 2>&1; then openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20 || true; else
        head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20 || true
    fi
}

if [ "$START" = 1 ]; then
    command -v docker >/dev/null 2>&1 || {
        echo "Falta Docker. Instálalo: https://docs.docker.com/engine/install/ubuntu/" >&2
        exit 1
    }
    docker compose version >/dev/null 2>&1 || {
        echo "Falta el plugin 'docker compose'. Instala docker-compose-plugin." >&2
        exit 1
    }
    docker info >/dev/null 2>&1 || {
        echo "Docker no responde para tu usuario. Prueba con:  sudo $0   (o añade tu usuario al grupo docker)" >&2
        exit 1
    }
fi

if [ ! -f "$ENV_FILE" ]; then
    DOMAIN="${DOMAIN:-}"
    if [ -z "$DOMAIN" ]; then
        read -r -p "Dominio con el que entrarás (sin https://, ej. musica.duckdns.org): " DOMAIN
    fi
    DOMAIN="${DOMAIN#http://}"
    DOMAIN="${DOMAIN#https://}"
    DOMAIN="${DOMAIN%%/*}"
    [ -n "$DOMAIN" ] || { echo "El dominio no puede estar vacío." >&2; exit 1; }

    ADMIN_PASSWORD="$(rand_pass)"
    SESSION_SECRET="$(rand_hex)"
    umask 077
    cat >"$ENV_FILE" <<EOF
DOMAIN=$DOMAIN
ADMIN_USER=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
SESSION_SECRET=$SESSION_SECRET
EOF
    echo "──────────────────────────────────────────────"
    echo " Creado $ENV_FILE"
    echo "   Panel:      https://$DOMAIN/admin"
    echo "   Usuario:    admin"
    echo "   Contraseña: $ADMIN_PASSWORD"
    echo " Guárdala: está también en $ENV_FILE (permisos 600)."
    echo "──────────────────────────────────────────────"
else
    echo "Usando el $ENV_FILE existente (no se modifica)."
fi

if [ "$START" = 0 ]; then
    echo "Listo (--no-start). Arranca con:"
    echo "  docker compose -f deploy/oracle/docker-compose.yaml --env-file $ENV_FILE up -d --build"
    exit 0
fi

COMPOSE=(docker compose -f deploy/oracle/docker-compose.yaml --env-file "$ENV_FILE")
"${COMPOSE[@]}" up -d --build
"${COMPOSE[@]}" ps

# shellcheck disable=SC1090
DOMAIN="$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
echo
echo "Listo. Comprueba:  https://$DOMAIN   y   https://$DOMAIN/admin"
echo "Si no carga: puertos 80/443 abiertos (./deploy/oracle/open-firewall.sh + lista de seguridad de OCI)"
echo "y que el DNS de $DOMAIN apunte a la IP pública de esta máquina."
echo "Logs:  docker compose -f deploy/oracle/docker-compose.yaml --env-file $ENV_FILE logs -f"
