# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY dashboard/ /build/

WORKDIR /build

RUN pnpm install --frozen-lockfile

# Use production vite config (no vite-plugin-manus-runtime)
RUN pnpm vite build --config vite.config.production.ts && \
    pnpm esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY dashboard/package.json /app/package.json
COPY dashboard/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY dashboard/patches/ /app/patches/

WORKDIR /app

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /build/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
