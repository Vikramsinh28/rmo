# Production image. Build context is the repository root:
# docker build -f infra/Dockerfile .

FROM node:24-alpine AS base

RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma.config.ts reads POSTGRES_URL when the client is generated.
# Generate does not connect. The real URL is injected when the container starts.
ENV POSTGRES_URL=postgresql://build:build@127.0.0.1:5432/rmo?schema=public
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_S3_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_FILE_STORAGE_DRIVER=s3

ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_S3_PUBLIC_BASE_URL=${NEXT_PUBLIC_S3_PUBLIC_BASE_URL}
ENV NEXT_PUBLIC_FILE_STORAGE_DRIVER=${NEXT_PUBLIC_FILE_STORAGE_DRIVER}

RUN pnpm generate && pnpm build && pnpm prune --prod --config.confirmModulesPurge=false

FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/lib/prisma ./src/lib/prisma
COPY infra/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

CMD ["/app/docker-entrypoint.sh"]
