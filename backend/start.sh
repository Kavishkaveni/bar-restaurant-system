#!/bin/sh
set -e

# Apply database migrations, add default roles/settings/owner, then start.
alembic upgrade head
python -m app.seed

if [ "$APP_ENV" = "production" ]; then
  # Behind Caddy: trust its X-Forwarded-* headers so client IPs in the audit log are right.
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips '*'
else
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
fi
