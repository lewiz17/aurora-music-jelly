#!/usr/bin/env bash
# Abre los puertos 80 y 443 en el firewall DE LA MÁQUINA (Oracle los trae cerrados).
# Esto NO sustituye a la lista de seguridad / NSG de la consola de OCI: ahí también hay que
# permitir TCP 80 y 443 (y UDP 443 si quieres HTTP/3) desde 0.0.0.0/0.
# Es idempotente: repetirlo no duplica reglas.
set -euo pipefail

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

if command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    # Oracle Linux / RHEL: firewalld
    $SUDO firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp --add-port=443/udp
    $SUDO firewall-cmd --reload
    echo "firewalld: 80/tcp, 443/tcp y 443/udp abiertos."
    exit 0
fi

if command -v iptables >/dev/null 2>&1; then
    # Ubuntu en Oracle: reglas iptables con un REJECT final. Hay que insertar ANTES de él.
    reject_line="$($SUDO iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
    for rule in "tcp --dport 80" "tcp --dport 443" "udp --dport 443"; do
        proto="${rule%% *}"
        port="${rule##* }"
        if $SUDO iptables -C INPUT -p "$proto" --dport "$port" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
            echo "ya existe: $proto/$port"
            continue
        fi
        if [ -n "$reject_line" ]; then
            $SUDO iptables -I INPUT "$reject_line" -p "$proto" --dport "$port" -m conntrack --ctstate NEW -j ACCEPT
            reject_line=$((reject_line + 1))
        else
            $SUDO iptables -A INPUT -p "$proto" --dport "$port" -m conntrack --ctstate NEW -j ACCEPT
        fi
        echo "abierto: $proto/$port"
    done
    # Los contenedores llegan a Jellyfin (que corre en la máquina) por la red de Docker, y esa
    # conexión entra por INPUT: sin esta regla Aurora responde 502 aunque Jellyfin esté vivo.
    # Sólo acepta desde las redes privadas de Docker (172.16.0.0/12), no desde internet.
    jf_port="${JELLYFIN_PORT:-8096}"
    if $SUDO iptables -C INPUT -s 172.16.0.0/12 -p tcp --dport "$jf_port" -j ACCEPT 2>/dev/null; then
        echo "ya existe: docker -> tcp/$jf_port"
    else
        reject_line="$($SUDO iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
        if [ -n "$reject_line" ]; then
            $SUDO iptables -I INPUT "$reject_line" -s 172.16.0.0/12 -p tcp --dport "$jf_port" -j ACCEPT
        else
            $SUDO iptables -A INPUT -s 172.16.0.0/12 -p tcp --dport "$jf_port" -j ACCEPT
        fi
        echo "abierto: redes Docker -> tcp/$jf_port (Jellyfin)"
    fi
    if command -v netfilter-persistent >/dev/null 2>&1; then
        $SUDO netfilter-persistent save
    else
        echo "AVISO: instala 'iptables-persistent' (sudo apt install iptables-persistent) y ejecuta" >&2
        echo "       'sudo netfilter-persistent save' o las reglas se perderán al reiniciar." >&2
    fi
    exit 0
fi

echo "No encontré firewalld ni iptables: no hay nada que abrir en la máquina." >&2
