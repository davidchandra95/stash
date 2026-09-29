#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
cd "$script_dir"
umask 077
mkdir -p backups
backup="backups/stash-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$backup.partial"' EXIT
docker compose exec -T db pg_dump -U stash -d stash -Fc > "$backup.partial"
docker compose exec -T db pg_restore --list < "$backup.partial" > /dev/null
mv "$backup.partial" "$backup"
find backups -name 'stash-*.dump' -type f -mtime +6 -delete
