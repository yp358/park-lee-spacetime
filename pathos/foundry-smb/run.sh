#!/usr/bin/env sh
# One command to get the workspace up on a machine that has Python 3.
#
#   ./run.sh            rebuild the sample DB if missing, then serve on :8787
#   ./run.sh --full     re-ingest all 1.1M passages from the cloned corpora first
set -e
cd "$(dirname "$0")"

if [ "$1" = "--full" ]; then
  python3 ingest/load.py
  python3 ingest/sample.py
elif [ ! -f data/sample.db ]; then
  echo "[run] no data/sample.db — rebuilding it from the versioned exports"
  python3 ingest/restore.py
fi

exec python3 api/server.py --port "${PORT:-8787}"
