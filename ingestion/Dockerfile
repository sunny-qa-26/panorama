# syntax=docker/dockerfile:1.6
FROM node:20-alpine
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY ingestion/package.json ingestion/
RUN pnpm install --frozen-lockfile --filter @panorama/ingestion...
COPY ingestion/ ingestion/
WORKDIR /repo/ingestion
ENV TRIGGER_TYPE=cron
CMD ["pnpm", "rebuild"]
