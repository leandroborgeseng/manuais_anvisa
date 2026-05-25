# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files from dashboard/
COPY dashboard/package.json dashboard/pnpm-lock.yaml ./
COPY dashboard/patches/ ./patches/

# Install all dependencies (including dev, needed for build)
RUN pnpm install --frozen-lockfile

# Copy full dashboard source
COPY dashboard/ .

# Build: Vite outputs to dist/public, esbuild outputs server to dist/index.js
RUN pnpm build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files and install production deps only
COPY dashboard/package.json dashboard/pnpm-lock.yaml ./
COPY dashboard/patches/ ./patches/
RUN pnpm install --frozen-lockfile --prod

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# Railway injects PORT at runtime — the server reads process.env.PORT
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
