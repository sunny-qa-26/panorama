# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY webapp/package.json webapp/
RUN pnpm install --frozen-lockfile --filter @panorama/webapp...

FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY --from=deps /repo /repo
COPY webapp/ webapp/
RUN pnpm --filter @panorama/webapp build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/webapp/.next ./.next
COPY --from=build /repo/webapp/public ./public
COPY --from=build /repo/webapp/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
