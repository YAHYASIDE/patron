# ─────────────── Stage 1: dependencies ───────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package*.json ./
COPY prisma ./prisma
# npm ci, not install: the lockfile is the source of truth in CI and prod.
RUN npm ci --ignore-scripts && npx prisma generate

# ─────────────── Stage 2: build ───────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ─────────────── Stage 3: production dependencies only ───────────────
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts && npx prisma generate && npm cache clean --force

# ─────────────── Stage 4: runtime ───────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# dumb-init reaps zombies and forwards signals, so SIGTERM actually reaches
# Node and in-flight requests drain instead of being severed.
RUN apk add --no-cache openssl dumb-init curl \
 && addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S patron -G nodejs

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=768" \
    PORT=3000

COPY --from=prod-deps --chown=patron:nodejs /app/node_modules ./node_modules
COPY --from=build     --chown=patron:nodejs /app/dist ./dist
COPY --from=build     --chown=patron:nodejs /app/prisma ./prisma
COPY --chown=patron:nodejs package.json ./

# Never root. A container escape should not start with UID 0.
USER patron

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/v1/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
