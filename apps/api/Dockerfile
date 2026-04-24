FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @deadswitch/shared build
RUN pnpm --filter @deadswitch/api prisma:generate
RUN pnpm --filter @deadswitch/api build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
