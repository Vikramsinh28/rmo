#!/bin/sh
set -e

pnpm migrate:prod
exec pnpm start -- --hostname 0.0.0.0 --port 3000
