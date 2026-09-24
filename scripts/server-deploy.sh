#!/usr/bin/env bash
# Updates the app already running on the EC2 host.
# Expects the repo checkout at ~/rmo, a .env file there, and RMO_IMAGE set.
set -euo pipefail

cd "${HOME}/rmo"

export NVM_DIR="${HOME}/.nvm"
if [ -s "${NVM_DIR}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR}/nvm.sh"
fi

if [ -z "${RMO_IMAGE:-}" ]; then
  echo "RMO_IMAGE is required"
  exit 1
fi

docker pull "${RMO_IMAGE}"

if command -v pm2 >/dev/null 2>&1 && pm2 describe rmo >/dev/null 2>&1; then
  pm2 delete rmo
  pm2 save
fi

docker rm -f rmo-app >/dev/null 2>&1 || true
docker compose -f docker-compose.prod.yml up -d --force-recreate
docker image prune -f
