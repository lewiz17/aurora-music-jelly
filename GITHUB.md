# Publicar este proyecto en tu GitHub

El proyecto ya está en un repositorio git local (rama `main`) con un primer commit.
Falta únicamente crear el repo en tu cuenta y hacer `push`. Tienes tres caminos.

## Opción A — desde la web (lo más fácil, sin instalar nada)

1. Entra en <https://github.com/new>.
2. Nombre: `aurora-music`. Visibilidad: **Private**.
3. **No** marques "Add a README", `.gitignore` ni licencia (ya vienen incluidos).
4. Crea el repo y copia la URL que aparece (`https://github.com/TU-USUARIO/aurora-music.git`).
5. En la carpeta del proyecto:

```bash
git remote add origin https://github.com/TU-USUARIO/aurora-music.git
git push -u origin main
```

La primera vez te pedirá usuario y **contraseña de aplicación** (*Settings → Developer settings →
Personal access tokens → Tokens (classic)*, scope `repo`). Ojo: GitHub ya no acepta la contraseña
normal por HTTPS.

## Opción B — con GitHub CLI

```bash
gh auth login
cd aurora-music
gh repo create aurora-music --private --source=. --remote=origin --push
```

## Opción C — si descargaste el bundle `aurora-music.bundle`

```bash
git clone aurora-music.bundle aurora-music
cd aurora-music
git remote set-url origin https://github.com/TU-USUARIO/aurora-music.git
git push -u origin main
```

El bundle trae el historial completo, así que no hace falta `git init` ni volver a commitear.

## Después de subirlo

En **Settings → Actions → General** deja los permisos por defecto: el workflow de CI
(`.github/workflows/ci.yml`) solo compila y valida en cada push, no publica nada.

Para conectar un hosting (Render, Railway, Fly) a ese repo, mira la sección
**"Desplegarlo en un hosting gratuito"** del README. Para tu propio servidor con Node,
mira **"En tu propio servidor con Node (systemd + Caddy/Nginx)"** y los archivos de `deploy/`.

## Qué es público y qué no

- **Sí se sube:** todo el código, `dist/` NO, `node_modules/` NO, `server/data/` NO,
  `.env` NO. El `.gitignore` ya lo excluye.
- **No se sube:** datos de tu servidor (códigos, logos subidos, ajustes) ni contraseñas.
  Todo eso vive en `DATA_DIR` y en las variables de entorno del servidor.
- Antes de hacer público el repo revisa que no hayas dejado URLs internas en capturas
  o notas: `CÓMO-PROBAR.md` menciona el demo público de Jellyfin, no tu servidor.
