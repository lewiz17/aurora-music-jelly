# Desplegar Aurora en tu instancia de Oracle (junto a Jellyfin)

```
Internet ──HTTPS──▶ Caddy (80/443) ──▶ Aurora (red interna de Docker) ──▶ Jellyfin (esta misma máquina)
                    certificados solos   app + panel /admin
```

Todo en una máquina. Sólo Caddy publica puertos; Aurora no es alcanzable sin HTTPS, y tu Jellyfin
puede dejar de estar expuesto a internet (ver el paso 8).

> Los archivos están en `deploy/oracle/`. Los scripts y el compose se validaron en sintaxis, pero
> **no se han ejecutado sobre una instancia de Oracle real**: ve paso a paso y revisa la sección
> "Si algo falla".

## 0. Qué necesitas

- La instancia de Oracle (Ubuntu u Oracle Linux) con acceso SSH.
- **Un nombre de dominio** apuntando a la IP pública. Gratis: [duckdns.org](https://www.duckdns.org)
  (te da `algo.duckdns.org`). HTTPS lo necesita: sin él el navegador no instala la PWA ni deja
  usar el service worker.
- Docker con el plugin compose: <https://docs.docker.com/engine/install/ubuntu/>

## 1. DNS

En DuckDNS crea el subdominio (p. ej. `musica`) y pon la **IP pública** de la instancia
(consola de OCI → Compute → tu instancia). Comprueba: `nslookup musica.duckdns.org`.

## 2. Abrir los puertos (dos sitios: los dos son necesarios)

**a) Consola de OCI** → Networking → Virtual Cloud Networks → tu VCN → Security Lists (o el NSG de la
instancia) → *Add Ingress Rules*: origen `0.0.0.0/0`, TCP, puertos `80` y `443`
(y UDP `443` si quieres HTTP/3).

**b) El firewall de la propia máquina** (Oracle lo trae cerrado aunque abras OCI):

```bash
bash deploy/oracle/open-firewall.sh
```

Funciona con `iptables` (Ubuntu) o `firewalld` (Oracle Linux), es repetible y además deja que los
contenedores lleguen a Jellyfin en el puerto 8096 (sin esto, Aurora daría 502).

## 3. Memoria (sólo si tu instancia tiene 1 GB, la "Micro" x86)

Construir la imagen necesita más de 1 GB. Añade swap una vez:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Las instancias Ampere (ARM) con más RAM no lo necesitan.

## 4. Llevar el código a la instancia

Sin repositorio remoto, desde **PowerShell** en la carpeta del proyecto:

```powershell
tar --exclude=node_modules --exclude=server/node_modules --exclude=dist --exclude=.git `
    --exclude=server/data --exclude=.env -czf aurora.tgz .
scp -i C:\ruta\a\tu-clave.key aurora.tgz ubuntu@IP_PUBLICA:~/
```

(`server/data` no se sube a propósito: es tu estado local de desarrollo.) En la instancia:

```bash
mkdir -p aurora && tar -xzf aurora.tgz -C aurora && cd aurora
sed -i 's/\r$//' deploy/oracle/*.sh      # por si el archivo se editó en Windows
```

La imagen se construye allí, así que sirve igual en x86 que en ARM.

## 5. Instalar

```bash
bash deploy/oracle/install.sh
```

Te pregunta el dominio, **genera** la contraseña del panel y el secreto de sesión (los imprime una
sola vez y quedan en `deploy/oracle/.env`, permisos 600), construye y arranca. Al terminar:

- App: `https://tu-dominio`
- Panel: `https://tu-dominio/admin` (usuario `admin`)

La primera vez Caddy tarda unos segundos en obtener el certificado.

## 6. Conectar con tu Jellyfin

En el panel → **Servidores y códigos** → añadir:

| Dónde corre Jellyfin | URL que debes poner |
|---|---|
| Instalado directo en la máquina | `http://host.docker.internal:8096` |
| En Docker (otro compose) | descomenta `jellyfin_net` en `docker-compose.yaml` con el nombre de **su** red (`docker network ls`) y usa `http://nombre-del-contenedor:8096` |
| En otra máquina | su URL normal (`https://…`) |

Pulsa **Probar**: debe mostrar el nombre y la versión. Después, en **Listas de YouTube Music**,
conecta tu cuenta de Jellyfin para poder crear listas.

## 7. Actualizar

Sube un `aurora.tgz` nuevo (paso 4), extráelo encima y repite `bash deploy/oracle/install.sh`.
No toca tu `.env` ni tus datos (viven en volúmenes de Docker).

## 8. Jellyfin: ¿cerrarlo a internet o dejarlo accesible?

- **Sólo Aurora** (servidor oculto): quita de OCI cualquier regla que abra el 8096 al público.
  Aurora sigue llegando a él por dentro. Las apps nativas (Finamp, Symfonium, Jellyfin para
  Android TV) **no** podrán conectar desde fuera.
- **Aurora + apps nativas**: copia `deploy/oracle/extra/jellyfin.caddy.example` a
  `jellyfin.caddy`, cambia el dominio (un segundo nombre DNS a la misma IP) y reinicia Caddy:
  `docker compose -f deploy/oracle/docker-compose.yaml --env-file deploy/oracle/.env restart caddy`.
  Así Jellyfin también sale por HTTPS, sin abrir el 8096. Pierdes el "servidor oculto".

## 9. Copia de seguridad (códigos, logos, ajustes, importaciones)

```bash
docker run --rm -v aurora_aurora-data:/d -v "$PWD":/b alpine tar czf /b/aurora-backup.tgz -C /d .
```

Restaurar: el mismo comando con `tar xzf /b/aurora-backup.tgz -C /d`. Guarda también
`deploy/oracle/.env` (tiene la contraseña y el secreto de sesión).

## Seguridad que ya viene puesta

- Contenedor sin privilegios (usuario `node`), Aurora sin puertos publicados.
- El panel y la app no se pueden incrustar en otros sitios (`FRAME_ANCESTORS='self'`).
- Máximo 10 intentos fallidos por IP cada 15 min en el panel y en el login por código
  (`LOGIN_MAX_FAILURES`, `LOGIN_WINDOW_MS`); sólo cuentan los fallos.
- HTTPS con HSTS y certificados renovados solos.

## Si algo falla

```bash
docker compose -f deploy/oracle/docker-compose.yaml --env-file deploy/oracle/.env logs -f
```

| Síntoma | Causa probable |
|---|---|
| El navegador no conecta / timeout | Puertos 80/443 cerrados en OCI **o** en la máquina (paso 2) |
| Caddy repite "obtaining certificate" con errores | El DNS aún no apunta a la IP, o el 80 está cerrado (Let's Encrypt entra por ahí) |
| El panel entra pero **Probar** da error o 502 | La URL de Jellyfin del paso 6, o falta la regla del 8096 desde Docker (`open-firewall.sh`) |
| `Docker no responde para tu usuario` | Ejecuta con `sudo`, o `sudo usermod -aG docker $USER` y vuelve a entrar |
| `bad interpreter` / `\r` | El script quedó con saltos de línea de Windows: `sed -i 's/\r$//' deploy/oracle/*.sh` |
| 429 "Demasiados intentos" | Límite de fallos: espera 15 min o reinicia el contenedor `aurora` |
| La construcción se corta sola ("Killed") | Poca RAM: paso 3 (swap) |
