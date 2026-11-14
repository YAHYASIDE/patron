# ─────────────── Stage 1: dependencies ───────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package*.json ./
RUN npm ci

# ─────────────── Stage 2: build ───────────────
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# The admin talks to the API through this URL. NEXT_PUBLIC_* is inlined at
# build time, so it must be set here (pass --build-arg NEXT_PUBLIC_API_URL=...).
# Example: --build-arg NEXT_PUBLIC_API_URL=https://shop.etssadagha.com/api/v1
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# "true" only in the staging copy (render.staging.yaml): test banner + noindex
ARG NEXT_PUBLIC_STAGING
ENV NEXT_PUBLIC_STAGING=${NEXT_PUBLIC_STAGING}
# where customers see their orders (links in WhatsApp messages)
ARG NEXT_PUBLIC_STORE_URL
ENV NEXT_PUBLIC_STORE_URL=${NEXT_PUBLIC_STORE_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The committed tsconfig.json extends ../../packages/tsconfig, which is outside
# this app-scoped build context. Swap in the self-contained config so `next
# build` resolves the TypeScript base inside the image (see tsconfig.docker.json).
RUN cp tsconfig.docker.json tsconfig.json
RUN npm run build

# ─────────────── Stage 3: runtime ───────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

RUN apk add --no-cache dumb-init \
 && addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nextjs -G nodejs

# `output: 'standalone'` emits a self-contained server with a minimal
# node_modules, so the runtime image stays small.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
