# ---- build the web app ----
FROM node:20-alpine AS web
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* ./
RUN npm install --legacy-peer-deps --ignore-scripts
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --silent && npm cache clean --force

COPY server/src ./server/src
COPY server/admin ./server/admin
COPY --from=web /app/dist ./dist

ENV PORT=8787 \
    DATA_DIR=/data \
    WEB_DIR=/app/dist

# The app never runs as root: the entrypoint starts as root only to fix the owner of the data dir
# (persistent volumes on Fly/Railway/Render are mounted root-owned) and then drops to "node".
RUN apk add --no-cache su-exec
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/app-config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/src/index.js"]
