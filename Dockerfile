# Multi-stage build for the Next.js app. Node 24 per docs/00-ARCHITECTURE-FREEZE.md.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate only reads the schema, it never opens a DB connection —
# this placeholder value is never used to actually connect to anything.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm exec prisma generate
RUN pnpm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["pnpm", "start"]
