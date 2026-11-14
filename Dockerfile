FROM node:22.23.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html signin.html trap-lab.html judges-expeditions.html vite.config.js LICENSE NOTICE ASSETS-LICENSE.md ./
COPY src ./src
COPY shared ./shared
COPY public ./public
COPY scripts/dependency-notices.mjs ./scripts/dependency-notices.mjs
RUN npm run build

FROM node:22.23.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 \
    BARREL_DATA_DIR=/app/data BARREL_DB=/app/data/economy.sqlite
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY server.mjs economy.mjs deployment-config.mjs near-arena.mjs near-expeditions.mjs \
    near-social.mjs near-social-actions.mjs near-embedded.mjs judges-expedition.mjs near-rpc-reads.mjs agent-journal.mjs LICENSE NOTICE ASSETS-LICENSE.md ./
COPY shared ./shared
COPY scripts/deploy-preflight.mjs ./scripts/deploy-preflight.mjs
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
