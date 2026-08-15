#!/bin/bash
# W2 (walkable-rig sprint) — cloud SRTLA relay: one-paste setup for a fresh Ubuntu VM.
# The media front door with a stable public IP: Moblin bonds cell legs to THIS box;
# home OBS dials OUT to pull the reassembled SRT — zero inbound ports at home, no VPN
# in the media path (SRTLA ∦ Tailscale — per-interface sockets bypass tunnels), and the
# home ISP's rotating WAN IP stops mattering.
#
#   scp tools/relay/setup-relay.sh <vm>:  &&  ssh <vm> 'sudo bash setup-relay.sh'
#
# Topology:  Moblin --srtla/udp:5000--> srtla_rec --srt--> srt-live-transmit (listener
#            :4001, passphrase) <--srt caller-- home OBS media source
# Security: ufw allows ONLY ssh + udp/5000 + udp/4001. The SRT passphrase (REQUIRED —
# set below before running) authenticates + encrypts the stream end-to-end at both hops,
# closing the wildcard-listener caveat at the new perimeter: a stranger who finds the
# ports cannot push video into the operator's compositor or read the stream.
set -euo pipefail

SRT_PASSPHRASE="${SRT_PASSPHRASE:?set SRT_PASSPHRASE env var before running (same value goes in Moblin + OBS)}"
SRTLA_PORT=5000
SRT_OUT_PORT=4001

apt-get update -y
apt-get install -y build-essential git srt-tools ufw unattended-upgrades

# --- srtla_rec (pinned to the audited build the street rig uses) ---
if [ ! -x /usr/local/bin/srtla_rec ]; then
  git clone https://github.com/BELABOX/srtla.git /opt/srtla
  ( cd /opt/srtla && make )
  install -m 755 /opt/srtla/srtla_rec /usr/local/bin/srtla_rec
fi

# --- systemd: srtla_rec reassembles the bond and hands SRT to the local listener ---
cat > /etc/systemd/system/srtla-rec.service <<UNIT
[Unit]
Description=Footnote SRTLA bond receiver
After=network-online.target srt-out.service
Wants=srt-out.service
[Service]
ExecStart=/usr/local/bin/srtla_rec ${SRTLA_PORT} 127.0.0.1 4000
Restart=always
RestartSec=2
User=nobody
[Install]
WantedBy=multi-user.target
UNIT

# --- systemd: srt-live-transmit re-listens with the passphrase for the home OBS caller ---
cat > /etc/systemd/system/srt-out.service <<UNIT
[Unit]
Description=Footnote SRT hand-off (home OBS dials in as caller)
After=network-online.target
[Service]
ExecStart=/usr/bin/srt-live-transmit "srt://127.0.0.1:4000?mode=listener" "srt://0.0.0.0:${SRT_OUT_PORT}?mode=listener&passphrase=${SRT_PASSPHRASE}&pbkeylen=16"
Restart=always
RestartSec=2
User=nobody
[Install]
WantedBy=multi-user.target
UNIT

# --- P-D front-door tripwire: hear the (still-unauthenticated) ingest -----------------
# While the SRTLA ingest stays open, tail srtla_rec's journal for registration source IPs
# and record any that are NOT on the operator's allowlist. Surfaced on :8080
# (recent_unknown_sources) and polled from the Mac via tools/relay/check-tripwire.sh.
# ADDITIVE + observability-only — never touches the media path.
mkdir -p /etc/footnote
# Operator-editable allowlist (seeded from run2 forensics — do NOT clobber on re-run).
if [ ! -f /etc/footnote/relay-allowlist.conf ]; then
  cat > /etc/footnote/relay-allowlist.conf <<'ALLOW'
# Footnote relay tripwire — KNOWN-EXPECTED ingest sources. One IPv4 (/32) or CIDR per line;
# inline "# ..." comments allowed. EDIT as your carriers/home IP rotate. Seeded from run2.
76.32.135.77          # home ISP (observed run2; rotates — update when your WAN IP changes)
166.199.0.0/16        # Verizon cellular (166.199.x seen bonded in run2)
ALLOW
fi
install -m 755 "$(dirname "$0")/relay-tripwire.sh" /usr/local/bin/relay-tripwire.sh
install -m 755 "$(dirname "$0")/relay-health.sh"   /usr/local/bin/relay-health.sh
touch /var/log/footnote-tripwire.jsonl

cat > /etc/systemd/system/relay-tripwire.service <<'UNIT'
[Unit]
Description=Footnote front-door tripwire (unknown-source SRTLA registrations)
After=network-online.target
[Service]
ExecStart=/usr/local/bin/relay-tripwire.sh
Restart=always
RestartSec=3
User=root
Environment=FOOTNOTE_TRIPWIRE_ALLOWLIST=/etc/footnote/relay-allowlist.conf
Environment=FOOTNOTE_TRIPWIRE_LOG=/var/log/footnote-tripwire.jsonl
[Install]
WantedBy=multi-user.target
UNIT

# --- tiny health endpoint the Mac/harness can poll (arm.sh checks it pre-session) ---
# Runs the SCRIPT form (relay-health.sh) so the JSON body — incl. recent_unknown_sources —
# is versioned/testable. Root so it can read the tripwire log; opens no media sockets.
cat > /etc/systemd/system/relay-health.service <<'UNIT'
[Unit]
Description=Footnote relay health endpoint
After=network-online.target
[Service]
ExecStart=/usr/local/bin/relay-health.sh
Restart=always
User=root
[Install]
WantedBy=multi-user.target
UNIT

# --- firewall: ssh + the two SRT ports + health, nothing else ---
ufw allow OpenSSH
ufw allow ${SRTLA_PORT}/udp
ufw allow ${SRT_OUT_PORT}/udp
ufw allow 8080/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable --now srt-out srtla-rec relay-health relay-tripwire
echo "relay up:"
echo "  Moblin:  srtla://$(curl -s https://api.ipify.org):${SRTLA_PORT}  (implementation=Moblin, passphrase set)"
echo "  OBS:     Media Source input srt://$(curl -s https://api.ipify.org):${SRT_OUT_PORT}?passphrase=<same>  (caller — no home ports)"
echo "  health:  http://$(curl -s https://api.ipify.org):8080/"
