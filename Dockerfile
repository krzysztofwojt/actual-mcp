# ---- Builder ----
FROM node:24-alpine AS builder

WORKDIR /app

# Reason: better-sqlite3 13.x ships no prebuilt binaries, so npm compiles it with node-gyp.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . ./
RUN npm run build

# Reason: prune here so the release stage gets compiled production modules without needing a toolchain.
RUN npm prune --omit=dev

# ---- Release ----
FROM node:24-alpine AS release

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build

ENV NODE_ENV=production
ENV TMPDIR=/tmp

RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "build/index.js"]
