#!/usr/bin/env bash
# From your Mac: sync a lean runtime tree + .env to the EC2 instance.
# Ships only docker-compose.yml, backend/, web/, and scripts/ec2-bootstrap.sh
# (no docs, UI mockups, supabase CLI tree, markdown, .cursor, etc.)
#
# Usage:
#   Ubuntu (recommended):  ./scripts/ec2-sync.sh ubuntu@PUBLIC_IP ~/.ssh/your-key.pem
#   Amazon Linux:          ./scripts/ec2-sync.sh ec2-user@PUBLIC_IP ~/.ssh/your-key.pem
set -euo pipefail

HOST="${1:-}"
KEY="${2:-}"

if [[ -z "$HOST" || -z "$KEY" ]]; then
  echo "Usage: $0 ubuntu@PUBLIC_IP /path/to/key.pem"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILTER="$ROOT/scripts/ec2-rsync.filter"
REMOTE_DIR="~/20_SEOHUndreds"

if [[ ! -f "$KEY" ]]; then
  echo "Key not found: $KEY"
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing $ROOT/.env — copy it before syncing."
  exit 1
fi

if [[ ! -f "$FILTER" ]]; then
  echo "Missing filter: $FILTER"
  exit 1
fi

SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

echo "→ Syncing lean runtime tree to $HOST:$REMOTE_DIR"
rsync -avz --delete \
  --filter="merge $FILTER" \
  -e "$RSYNC_SSH" \
  "$ROOT/" "$HOST:$REMOTE_DIR/"

echo "→ Copying .env"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$ROOT/.env" "$HOST:$REMOTE_DIR/.env"

echo "→ Ensuring bootstrap is executable"
"${SSH[@]}" "$HOST" "chmod +x $REMOTE_DIR/scripts/ec2-bootstrap.sh"

echo "Done. On the instance: $REMOTE_DIR/scripts/ec2-bootstrap.sh"
echo "Synced: docker-compose.yml, backend/, web/, scripts/ec2-bootstrap.sh, .env"
