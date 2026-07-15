#!/bin/bash
# Runs ON .140 as root. Switch Debian apt mirror http->https (port 80 to fastly
# is filtered here; 443 works), then apt update. Idempotent.
set -uo pipefail
echo "=== before ==="
grep -rhE '^(deb |URIs:)' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | grep -i debian | head
for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [ -f "$f" ] || continue
  cp -n "$f" "$f.bak-iceck" 2>/dev/null || true
  sed -i 's#http://deb.debian.org#https://deb.debian.org#g; s#http://security.debian.org#https://security.debian.org#g' "$f"
done
echo "=== after ==="
grep -rhE '^(deb |URIs:)' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | grep -i debian | head
echo "=== apt-get update ==="
DEBIAN_FRONTEND=noninteractive apt-get update -y 2>&1 | tail -10
echo "=== coturn candidate ==="
apt-cache policy coturn | head -4
