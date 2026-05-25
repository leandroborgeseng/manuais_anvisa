# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy the entire dashboard directory into /build
COPY dashboard/ /build/

WORKDIR /build

# Install all dependencies (dev included — needed for build)
RUN pnpm install --frozen-lockfile

# Build: Vite → dist/public  |  esbuild → dist/index.js
RUN pnpm build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY dashboard/package.json /app/package.json
COPY dashboard/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY dashboard/patches/ /app/patches/

WORKDIR /app

RUN pnpm install --frozen-lockfile --prod

# Copy built output from builder stage
COPY --from=builder /build/dist ./dist

# Railway injects PORT at runtime
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
