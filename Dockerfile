FROM oven/bun:1.3.13 AS base
WORKDIR /app

# Copy every workspace manifest before the frozen install.
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/editor/package.json ./apps/editor/
COPY apps/figma-plugin/package.json ./apps/figma-plugin/
COPY packages/canvaskit/package.json ./packages/canvaskit/
COPY packages/coatfile/package.json ./packages/coatfile/
COPY packages/engine/package.json ./packages/engine/
COPY packages/for-print/package.json ./packages/for-print/
COPY packages/test-utils/package.json ./packages/test-utils/
COPY packages/ui/package.json ./packages/ui/
COPY packages/workspace/package.json ./packages/workspace/
RUN bun install --frozen-lockfile

# Build the SPA
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/editor ./apps/editor
RUN bun run --cwd apps/editor build

# The editor is fully static, so the runner ships the build output and the Bun
# static server only.
FROM oven/bun:1.3.13-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY apps/editor/server.ts ./apps/editor/
COPY --from=builder /app/apps/editor/dist ./apps/editor/dist

WORKDIR /app/apps/editor
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER bun

CMD ["bun", "run", "server.ts"]
