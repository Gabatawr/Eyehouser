#!/bin/bash
# Real-time NDJSON viewer
# Usage: ./tail-log.sh [n]    — последние N записей с форматированием (по умолч. 10)
#        ./tail-log.sh -f      — follow (tail -f)

FILE=data/capture-log.ndjson

if [ "$1" = "-f" ]; then
  tail -f "$FILE" | while read -r line; do
    echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"
  done
else
  n="${1:-10}"
  tail -"$n" "$FILE" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || tail -"$n" "$FILE"
fi
