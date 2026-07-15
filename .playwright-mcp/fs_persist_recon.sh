#!/bin/bash
# Runs ON FreeSWITCH (.140) as root. Find firewall persistence + interfaces.
echo "=== persistence packages ==="
dpkg -l 2>/dev/null | grep -E 'netfilter-persistent|iptables-persistent' || echo 'NO persistent pkg'
echo "=== /etc/iptables ==="
ls -la /etc/iptables/ 2>/dev/null || echo 'no /etc/iptables dir'
echo "=== candidate custom firewall scripts ==="
ls -la /etc/network/if-up.d/ 2>/dev/null | grep -iE 'iptab|fire|fw' || true
grep -rilE 'iptables|16384:32768' /etc/rc.local /usr/local/bin /usr/local/sbin /etc/cron* /root 2>/dev/null | head -10 || echo 'none found in common spots'
echo "=== systemd services mentioning iptables ==="
systemctl list-unit-files 2>/dev/null | grep -iE 'iptab|firewall|netfilter' || echo 'none'
echo "=== fail2ban present? ==="
systemctl is-active fail2ban 2>/dev/null || echo 'fail2ban inactive/absent'
echo "=== interfaces / IPs ==="
ip -4 addr show | grep -E 'inet ' | grep -v 127.0.0.1
echo "=== relay range 49152-65535 already used? ==="
ss -lunp | awk '{print $5}' | grep -oE ':[0-9]+$' | tr -d ':' | awk '$1>=49152 && $1<=65535' | sort -u | head || echo 'none in relay range'
