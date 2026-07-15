#!/bin/bash
# Runs ON prod (.156); hops to FreeSWITCH (.140) for read-only recon.
# Usage: coturn_recon.sh <FS_SSH_PASSWORD>
FS_HOST=192.168.20.140
FS_USER=iteckadmin
FS_PASS="$1"
fs()    { sshpass -p "$FS_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$FS_USER@$FS_HOST" "$@"; }
fssudo(){ fs "echo '$FS_PASS' | sudo -S bash -c '$1'"; }

echo "=== OS ==="
fs "cat /etc/os-release 2>/dev/null | grep -E '^(NAME|VERSION)=' "
echo "=== coturn installed? / available? ==="
fs "which turnserver 2>/dev/null || echo 'turnserver: not installed'; apt-cache policy coturn 2>/dev/null | head -4"
echo "=== firewall (ufw / nft / iptables) ==="
fssudo "ufw status 2>/dev/null | head -20 || true; echo '---nft---'; nft list ruleset 2>/dev/null | head -5 || true; echo '---iptables---'; iptables -S 2>/dev/null | head -20 || true"
echo "=== FreeSWITCH RTP port range ==="
fs "grep -iE 'rtp-start-port|rtp-end-port' /usr/local/freeswitch/conf/autoload_configs/switch.conf.xml 2>/dev/null || echo 'switch.conf.xml not found at default path'"
echo "=== anything already on 3478/5349? ==="
fssudo "ss -lunp 2>/dev/null | grep -E ':3478|:5349' || echo 'none'; ss -ltnp 2>/dev/null | grep -E ':3478|:5349' || true"
echo "=== sudo works? ==="
fssudo "echo SUDO_OK"
