FROM node:22-alpine AS deps
WORKDIR /app
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
RUN corepack enable
RUN corepack prepare pnpm@11.10.0 --activate
RUN pnpm config set registry https://registry.npmmirror.com
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
RUN pnpm install --filter @lingxi/api... --frozen-lockfile --fetch-retries=5 --fetch-retry-factor=2 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=60000

FROM node:22-alpine AS builder
WORKDIR /app
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
RUN corepack enable
RUN corepack prepare pnpm@11.10.0 --activate
RUN pnpm config set registry https://registry.npmmirror.com
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @lingxi/api prisma:generate
RUN pnpm --filter @lingxi/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN sed -i 's#https://dl-cdn.alpinelinux.org/alpine#https://mirrors.aliyun.com/alpine#g' /etc/apk/repositories \
  && apk add --no-cache mariadb-client mariadb-connector-c
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder /app/apps/api/src/generated ./apps/api/src/generated
EXPOSE 3001
CMD ["node", "apps/api/dist/src/main.js"]
