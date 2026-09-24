#!/bin/sh
set -e

pnpm migrate:prod
exec ./node_modules/.bin/next start --hostname 0.0.0.0 --port 3000
