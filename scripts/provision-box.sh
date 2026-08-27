#!/usr/bin/env sh
# Turn a fresh Box into the team computer.
#
#   box ssh <id> < scripts/provision-box.sh
#
# Idempotent: safe to re-run after a resume, an upgrade, or a fork.
#
# The important part is systemd. Stop/resume on a Box behaves like a reboot:
# anything you started by hand is gone, and only enabled services come back on
# their own. So every piece of this that has to survive being asleep is a unit,
# not a command someone remembered to run.
set -eu

HYDO_DIR=/home/box/hydo
mkdir -p "$HYDO_DIR"

# Per-teammate scratch. A CONVENTION, not a boundary: every teammate can read
# every other teammate's folder. Written down here so nobody has to guess.
cat > "$HYDO_DIR/README.md" <<'TXT'
# The team computer

One machine, shared by every Hydo teammate. Files, installed software and
browser logins persist here, which is the point: a login done once stays done.

Each teammate has a folder under /home/box/hydo/<botId>. That is a convention
they follow so their scratch work does not collide. It is NOT isolation —
every teammate can read every other one's folder. Treat anything on this disk
as visible to the whole team, and keep secrets out of it.

Chat, memory and routines are not here. Those live on the Mac, in each
teammate's own Hermes profile.
TXT

# Hermes, so routines can fire here rather than on a laptop that gets shut.
if ! command -v hermes >/dev/null 2>&1; then
  echo "installing hermes..."
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | sh || {
    echo "hermes install failed; the box still works for shell and desktop work" >&2
  }
fi

# A unit, not a nohup. This is the difference between routines that survive a
# resume and routines that quietly stopped three days ago.
if command -v hermes >/dev/null 2>&1; then
  sudo tee /etc/systemd/system/hermes-gateway.service >/dev/null <<'UNIT'
[Unit]
Description=Hermes gateway for Hydo teammates
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=box
Environment=HERMES_HOME=/home/box/.hermes
ExecStart=/home/box/.local/bin/hermes gateway
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now hermes-gateway.service || true
fi

echo "provisioned. teammate folders live under $HYDO_DIR"
