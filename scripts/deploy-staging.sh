#!/usr/bin/env bash
# Phase 1 staging deploy — runs on the assigned internal VM.
# Prerequisites:
#   - Docker + docker compose installed
#   - .env populated with MYSQL_*, REPOS_PATH=/var/repos, BASIC_AUTH_*
#   - /var/repos already contains lista-knowledge, lista-cron, lista-bot
#     (cloned and kept current via crontab)

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> pulling latest panorama"
git pull

echo "==> applying migrations"
docker compose --profile build run --rm ingestion sh -c "cd /repo/migrations && pnpm apply"

echo "==> rebuilding ingestion data"
docker compose --profile build run --rm ingestion

echo "==> deploying webapp"
docker compose up -d --build webapp

echo "==> health check"
sleep 5
curl -fsS http://localhost:3000/api/health | grep '"ok":true'
echo "OK — open https://panorama.staging.lista.internal/"
