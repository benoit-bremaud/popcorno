#!/usr/bin/env bash
# QA fixture for #5: coloured artwork, short FFmpeg clips, fake TMDB, built server on :3105.
# Usage: run-qa.sh <scratch dir>   (the web dev server is started separately on :5173)
set -euo pipefail
S=$1; HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../../.." && pwd)
mkdir -p "$S/art" "$S/media/films" "$S/media/series/Dark/Season 1" "$S/data"
i=0
for id in 603 949 348 680 13 329 70523; do
  hue=$(( i * 50 )); i=$((i + 1))
  ffmpeg -loglevel error -y -f lavfi -i "gradients=s=300x450:c0=0x$(printf '%02x' $((hue % 200 + 40)))1020:c1=0x101018:x0=0:y0=0:x1=300:y1=450" -frames:v 1 "$S/art/p$id.png"
  ffmpeg -loglevel error -y -f lavfi -i "gradients=s=1280x720:c0=0x302030:c1=0x$(printf '%02x' $((hue % 200 + 40)))2030" -frames:v 1 "$S/art/b$id.png"
done
clip() { ffmpeg -loglevel error -y -f lavfi -i testsrc=d=1:s=160x90 -c:v libx264 "$1"; }
for f in 'The Matrix (1999)' 'Heat (1995)' 'Alien (1979)' 'Pulp Fiction (1994)' 'Forrest Gump (1994)' 'Planet Earth Live (2012)' 'Home Video'; do
  clip "$S/media/films/$f.mkv"
done
for n in 1 2 3; do clip "$S/media/series/Dark/Season 1/Dark S01E0$n.mkv"; done
ART_DIR="$S/art" node "$HERE/fake-tmdb.mjs" > "$S/tmdb.log" 2>&1 &
(cd "$ROOT/apps/server" && PORT=3000 DATABASE_PATH="$S/data/db.sqlite" MEDIA_ROOT="$S/media" \
  ARTWORK_DIR="$S/data/artwork" TMDB_API_KEY=qa-fake-key \
  node --import "$HERE/redirect-fetch.mjs" dist/index.js > "$S/server.log" 2>&1 &)
sleep 2
for kind in films series; do
  id=$(curl -s -X POST localhost:3000/libraries -H 'content-type: application/json' \
    -d "{\"name\":\"$kind\",\"rootPath\":\"$S/media/$kind\",\"kind\":\"$kind\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
  curl -s -X POST "localhost:3000/libraries/$id/scan" -H 'content-type: application/json' -d '{}'; echo
done
