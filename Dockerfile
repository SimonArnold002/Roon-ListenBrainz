# --- deps: install node_modules (git needed — Roon libs are GitHub, not npm) ---
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# --- runtime: slim image, no git/toolchain ---
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

# node-roon-api persists the pairing token to ./config.json (relative to cwd),
# so we run from /data and mount that as a volume — otherwise every container
# restart forces a re-pair in Roon.
RUN mkdir -p /data
WORKDIR /data
VOLUME /data

# Web UI port (once the Express layer lands). With network_mode: host this binds
# straight to the host; EXPOSE is documentation only.
ENV PORT=9330
EXPOSE 9330

CMD ["node", "/app/src/index.js"]
