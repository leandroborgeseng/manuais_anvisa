# ── Build stage (Node dashboard) ─────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY dashboard/ /build/
WORKDIR /build

RUN pnpm install --frozen-lockfile
RUN pnpm vite build --config vite.config.production.ts && \
    pnpm esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# ── Production stage (Node + Python) ──────────────────────────────────────────
FROM node:22-alpine AS runner

# Python for ANVISA downloader script
RUN apk add --no-cache python3 py3-pip

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY dashboard/package.json dashboard/pnpm-lock.yaml /app/
COPY dashboard/patches/ /app/patches/

WORKDIR /app

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /build/dist ./dist
COPY dashboard/drizzle/ ./drizzle/
COPY dashboard/scripts/run-migrations.mjs ./scripts/run-migrations.mjs
COPY scripts/start-railway.sh ./start-railway.sh

# Python downloader scripts
COPY requirements.txt /app/scripts/requirements.txt
COPY anvisa_downloader_b2.py /app/scripts/anvisa_downloader_b2.py
COPY anvisa_downloader_google.py /app/scripts/anvisa_downloader_google.py
COPY anvisa_downloader_s3.py /app/scripts/anvisa_downloader_s3.py

RUN pip3 install --no-cache-dir --break-system-packages -r /app/scripts/requirements.txt

ENV NODE_ENV=production
ENV ANVISA_SCRIPT_PATH=/app/scripts/anvisa_downloader_b2.py
ENV PYTHONUNBUFFERED=1

EXPOSE 3000

RUN chmod +x /app/start-railway.sh

CMD ["/app/start-railway.sh"]
