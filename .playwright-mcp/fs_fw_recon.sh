#!/bin/bash
# Runs ON FreeSWITCH (.140) as root (via sudo). Read-only firewall recon.
echo "=== full iptables ruleset (-S) ==="
iptables -S
echo
echo "=== INPUT chain verbose, line numbers ==="
iptables -L INPUT -n -v --line-numbers
echo
echo "=== UDP listeners ==="
ss -lunp | head -40
echo
echo "=== how is RTP/UDP currently allowed? (udp accept rules) ==="
iptables -S | grep -i udp || echo 'no explicit udp rules in filter table'
echo
echo "=== persistence mechanism ==="
ls -la /etc/iptables/ 2>/dev/null || echo 'no /etc/iptables dir'
dpkg -l 2>/dev/null | grep -E 'netfilter-persistent|iptables-persistent' || echo 'no persistent pkg installed'
echo
echo "=== primary interface / IPs ==="
ip -4 addr show | grep -E 'inet ' | grep -v 127.0.0.1
