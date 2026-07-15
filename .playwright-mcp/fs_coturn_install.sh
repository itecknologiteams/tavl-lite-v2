#!/bin/bash
# Runs ON FreeSWITCH (.140) as root. Installs + configures coturn (STUN+TURN),
# opens firewall (scoped to internal 192.168.0.0/16), starts the service.
# Idempotent: safe to re-run. Only INSERTS accept rules; never flushes/changes policy.
set -uo pipefail

INT_IP=192.168.20.140
REALM=iteck.local
TURN_USER=iceuser
TURN_PASS=Tavl1ceRelay2026
MINP=49152
MAXP=65535

echo "########## 1. install coturn ##########"
if ! command -v turnserver >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/tmp/coturn_apt.log 2>&1 || { echo "APT UPDATE FAILED"; tail -5 /tmp/coturn_apt.log; }
  apt-get install -y coturn >>/tmp/coturn_apt.log 2>&1 || { echo "APT INSTALL FAILED"; tail -15 /tmp/coturn_apt.log; exit 1; }
fi
echo "turnserver: $(command -v turnserver) -> $(turnserver -h 2>&1 | head -1 || true)"
dpkg -l coturn 2>/dev/null | grep '^ii' | awk '{print "installed version:", $3}'

echo "########## 2. write /etc/turnserver.conf ##########"
[ -f /etc/turnserver.conf ] && cp -n /etc/turnserver.conf /etc/turnserver.conf.bak-pre-iceck 2>/dev/null || true
cat > /etc/turnserver.conf <<EOF
# ICC/TAVL internal STUN+TURN — managed, do not hand-edit without updating the app iceServers
listening-port=3478
listening-ip=${INT_IP}
relay-ip=${INT_IP}
min-port=${MINP}
max-port=${MAXP}
fingerprint
lt-cred-mech
realm=${REALM}
user=${TURN_USER}:${TURN_PASS}
# internal-only hardening
no-tls
no-dtls
no-cli
no-multicast-peers
# never relay toward the carrier-facing / WAN ranges
denied-peer-ip=172.25.0.0-172.25.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
syslog
EOF
echo "wrote /etc/turnserver.conf:"; sed 's/^user=.*/user=iceuser:***MASKED***/' /etc/turnserver.conf

echo "########## 3. enable service in /etc/default/coturn ##########"
if grep -q '^#\?TURNSERVER_ENABLED' /etc/default/coturn 2>/dev/null; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
else
  echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
fi
grep TURNSERVER_ENABLED /etc/default/coturn

echo "########## 4. firewall: insert ACCEPT rules (internal scope), persist ##########"
add_rule() {
  # $@ = iptables rule spec after the chain
  if iptables -C INPUT "$@" 2>/dev/null; then
    echo "rule exists: $*"
  else
    iptables -I INPUT 1 "$@" && echo "inserted: $*"
  fi
}
add_rule -s 192.168.0.0/16 -p udp --dport 3478 -j ACCEPT
add_rule -s 192.168.0.0/16 -p tcp --dport 3478 -j ACCEPT
add_rule -s 192.168.0.0/16 -p udp --dport ${MINP}:${MAXP} -j ACCEPT
netfilter-persistent save >/tmp/coturn_fw_save.log 2>&1 && echo "firewall rules persisted" || { echo "PERSIST FAILED"; cat /tmp/coturn_fw_save.log; }

echo "########## 5. (re)start coturn ##########"
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 2
systemctl is-active coturn && echo "coturn active" || { echo "coturn NOT active"; journalctl -u coturn --no-pager -n 20; exit 1; }

echo "########## 6. verify listening + self STUN test ##########"
echo "--- listeners on 3478 ---"
ss -lunp 2>/dev/null | grep 3478 || echo "WARN: nothing on udp/3478"
ss -ltnp 2>/dev/null | grep 3478 || true
echo "--- local STUN binding test (expect a mapped address) ---"
if command -v turnutils_stunclient >/dev/null 2>&1; then
  timeout 8 turnutils_stunclient -p 3478 ${INT_IP} 2>&1 | grep -iE 'mapped|reflexive|error' | head || echo "(no mapped line / check manually)"
else
  echo "turnutils_stunclient not found"
fi
echo "########## DONE ##########"
