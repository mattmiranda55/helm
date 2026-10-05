#!/usr/bin/env bash
#
# Install helm as a systemd service.
#
# Nothing is built and nothing is copied. The repo is the install: dist/ is
# committed, so a git pull is the whole update. The unit runs the server
# straight out of this checkout.
#
#   git pull && sudo systemctl restart helm    # updating
#
# The service runs as the user who installs it (you, via sudo) — not root. The
# terminal is therefore your own login shell, which is also what rootless podman
# wants: it talks to /run/user/<uid>/podman/podman.sock, which is yours, not
# root's. Use sudo inside the terminal for the things that need it.
#
# It still binds to this machine's
# Tailscale address and nothing else — not the LAN, not 0.0.0.0. The address
# is resolved at every start rather than frozen in at install time, so a
# reboot that races tailscaled, or a changed tailnet IP, both sort themselves
# out. If Tailscale is down the bind fails closed; it never falls back to
# something wider.
#
#   sudo ./install.sh
#   sudo ./install.sh --user alice        # override the detected account
#   sudo ./install.sh --port 3001
#   sudo ./install.sh --host 100.x.y.z   # pin an address instead of resolving
#   sudo ./install.sh --no-tailscale     # no Tailscale: bind 127.0.0.1 (or --host)
#   sudo ./install.sh --uninstall
#
set -euo pipefail

APP_NAME="helm"
CONFIG_DIR="/etc/${APP_NAME}"
CONFIG_FILE="${CONFIG_DIR}/config.json"
UNIT_FILE="/etc/systemd/system/${APP_NAME}.service"
RUNTIME_ENV="/run/${APP_NAME}/env"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PORT="3001"
HOST=""
RUN_USER=""
DO_UNINSTALL=0
NO_TAILSCALE=0

c_ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
c_info() { printf '\033[36m%s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()    { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)      HOST="${2:?--host needs a value}"; shift 2 ;;
    --user)      RUN_USER="${2:?--user needs a value}"; shift 2 ;;
    --port)      PORT="${2:?--port needs a value}"; shift 2 ;;
    --no-tailscale) NO_TAILSCALE=1; shift ;;
    --uninstall) DO_UNINSTALL=1; shift ;;
    -h|--help)   sed -n '3,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           die "unknown option: $1" ;;
  esac
done

# Root is needed to write the unit and /etc config — not to run the service.
[[ $EUID -eq 0 ]] || die "run with sudo — writing the systemd unit needs root"

# ---------------------------------------------------------------- uninstall

if [[ $DO_UNINSTALL -eq 1 ]]; then
  systemctl disable --now "${APP_NAME}.service" 2>/dev/null || true
  rm -f "$UNIT_FILE"
  systemctl daemon-reload
  c_ok "removed ${APP_NAME} (kept ${CONFIG_DIR} and this checkout)"
  exit 0
fi

# ---------------------------------------------------------------- run-as user
#
# SUDO_USER is who invoked sudo, which is the account whose shell and podman
# socket the terminal should get. Logging in as real root leaves it unset, and
# we would rather be told than silently hand out a root shell.

if [[ -z "$RUN_USER" ]]; then
  RUN_USER="${SUDO_USER:-}"
  [[ -n "$RUN_USER" ]] || die "cannot tell who you are (no SUDO_USER)

Run this with sudo from your own account, or name the account explicitly:
    sudo ./install.sh --user <name>"
fi

USER_ENT="$(getent passwd "$RUN_USER" || true)"
[[ -n "$USER_ENT" ]] || die "no such user: ${RUN_USER}"

USER_UID="$(cut -d: -f3 <<<"$USER_ENT")"
USER_GID="$(cut -d: -f4 <<<"$USER_ENT")"
USER_HOME="$(cut -d: -f6 <<<"$USER_ENT")"
USER_SHELL="$(cut -d: -f7 <<<"$USER_ENT")"
[[ -n "$USER_SHELL" && "$USER_SHELL" != "/usr/sbin/nologin" && "$USER_SHELL" != "/bin/false" ]] \
  || die "${RUN_USER} has no usable login shell (${USER_SHELL:-none})"

if [[ "$RUN_USER" == "root" ]]; then
  c_warn "the service will run as root — the terminal will be a root shell"
else
  c_info "running as ${RUN_USER} (uid ${USER_UID}, shell ${USER_SHELL})"
fi

# ---------------------------------------------------------------- checkout

# The service runs from here, so it has to be somewhere root can still read
# after this script exits — which a normal clone under /home or /srv is.
[[ -f "${SOURCE_DIR}/server/index.ts" ]] || die "no server/index.ts next to this script"
[[ -f "${SOURCE_DIR}/bin/tailnet-env.sh" ]] || die "no bin/tailnet-env.sh next to this script"
chmod +x "${SOURCE_DIR}/bin/tailnet-env.sh"

if [[ ! -f "${SOURCE_DIR}/dist/index.html" ]]; then
  die "no dist/ in ${SOURCE_DIR}

dist/ is committed, so this usually means an incomplete checkout. Pull again:
    git -C ${SOURCE_DIR} pull"
fi

c_info "serving from ${SOURCE_DIR}"

# ---------------------------------------------------------------- bun

BUN="$(command -v bun || true)"
if [[ -z "$BUN" ]]; then
  [[ -x /usr/local/bin/bun ]] && BUN=/usr/local/bin/bun
fi
if [[ -z "$BUN" ]]; then
  c_info "bun not found — installing to /usr/local/bin"
  command -v curl >/dev/null || die "curl is required to install bun"
  export BUN_INSTALL=/usr/local
  curl -fsSL https://bun.sh/install | bash >/dev/null
  BUN=/usr/local/bin/bun
  [[ -x "$BUN" ]] || die "bun install failed"
fi
c_info "bun: $BUN ($("$BUN" --version))"

# The server imports only Bun built-ins, so there is nothing to install here.
# node_modules in this checkout, if any, is left over from `bun dev` and unused.

# ---------------------------------------------------------------- host

TS_BIN=""
DETECTED=""

if [[ $NO_TAILSCALE -eq 1 ]]; then
  # Without Tailscale there is no tailnet to hide behind, so the default is
  # loopback only: reach it through a reverse proxy or an SSH tunnel. Anything
  # wider has to be asked for with --host.
  [[ -n "$HOST" ]] || HOST="127.0.0.1"
  case "$HOST" in
    127.*|::1|localhost) c_info "host: ${HOST} (loopback only; put a reverse proxy or SSH tunnel in front)" ;;
    *) c_warn "host: ${HOST} - NOT limited to loopback or a tailnet.
    The terminal is a shell as ${RUN_USER}. Set auth.token in the config
    and put TLS in front of it before exposing this to anything you do not control." ;;
  esac
elif [[ -n "$HOST" ]]; then
  c_info "host: ${HOST} (pinned with --host)"
else
  TS_BIN="$(command -v tailscale || true)"
  [[ -n "$TS_BIN" ]] || die "tailscale not found

The service binds to the tailnet address and refuses to bind anywhere wider.
Install Tailscale, pin an address with --host <addr>, or skip Tailscale
entirely with --no-tailscale (binds 127.0.0.1)."

  DETECTED="$("$TS_BIN" ip -4 2>/dev/null | head -1 || true)"
  if [[ -n "$DETECTED" ]]; then
    c_info "host: ${DETECTED} (tailnet, re-resolved on every start)"
  else
    c_warn "tailscaled is not up yet — the service will wait for it on start"
  fi
fi

# ---------------------------------------------------------------- config
#
# config.json is gitignored, so it cannot ride along in the repo. It lives in
# /etc, seeded once, and is never touched again by a re-install.

install -d -m 755 "$CONFIG_DIR"

if [[ ! -f "$CONFIG_FILE" ]]; then
  cp "${SOURCE_DIR}/config.example.json" "$CONFIG_FILE"
  c_ok "seeded ${CONFIG_FILE} from config.example.json — edit your nodes and services"
else
  c_info "kept existing ${CONFIG_FILE}"
fi
# Owned by the run-as user, since that is who reads it now. Still 600: it can
# hold an access token and Glances credentials.
chown "${RUN_USER}:${USER_GID}" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

# ---------------------------------------------------------------- linger
#
# Rootless podman lives at /run/user/<uid>, which systemd-logind only creates
# once that user has a session. Lingering makes it exist from boot, so the
# terminal can run podman after a reboot without anyone logging in first.

if [[ "$RUN_USER" != "root" ]] && command -v loginctl >/dev/null; then
  if loginctl enable-linger "$RUN_USER" 2>/dev/null; then
    c_info "lingering enabled for ${RUN_USER} (keeps /run/user/${USER_UID} alive)"
  else
    c_warn "could not enable lingering — podman in the terminal may need a login first"
  fi
fi

# ---------------------------------------------------------------- unit

TS_AFTER=""
[[ -n "$HOST" ]] || TS_AFTER=" tailscaled.service"

c_info "writing ${UNIT_FILE}"
cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=helm — metrics dashboard and terminal
After=network-online.target${TS_AFTER}
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${SOURCE_DIR}
ExecStart=${BUN} run ${SOURCE_DIR}/server/index.ts
Restart=always
RestartSec=3

# Runs as a normal account, not root. Nothing here needs root: the port is
# above 1024, the config is owned by this user, and rootless podman is reached
# through this user's own socket. sudo inside the terminal covers the rest.
User=${RUN_USER}
Group=${USER_GID}

# A login shell spawned by the PTY inherits these, so the terminal behaves like
# an ssh session rather than a bare environment. XDG_RUNTIME_DIR is the one that
# matters most — without it rootless podman cannot find its socket.
Environment=HOME=${USER_HOME}
Environment=USER=${RUN_USER}
Environment=LOGNAME=${RUN_USER}
Environment=SHELL=${USER_SHELL}
Environment=HELM_SHELL=${USER_SHELL}
Environment=XDG_RUNTIME_DIR=/run/user/${USER_UID}
Environment=PATH=${USER_HOME}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

Environment=NODE_ENV=production
Environment=HELM_CONFIG=${CONFIG_FILE}
Environment=HELM_PORT=${PORT}
UNIT

if [[ -n "$HOST" ]]; then
  # Pinned with --host or --no-tailscale: no resolution, no waiting.
  cat >> "$UNIT_FILE" <<UNIT
Environment=HELM_HOST=${HOST}
UNIT
else
  # Wait for tailscaled to hand out an address, then bind to exactly that.
  # Written fresh on every start, so a changed tailnet IP needs no re-install.
  # RuntimeDirectory gives us /run/helm, cleaned up when we stop.
  # The "+" on ExecStartPre runs just that step as root: querying tailscaled
  # may need privileges the service user does not have, while the server itself
  # stays unprivileged.
  # bin/tailnet-env.sh waits for tailscaled and writes HELM_HOST=<addr> into
  # the runtime directory; EnvironmentFile picks it up for ExecStart. Because
  # it runs on every start, a changed tailnet IP needs no re-install.
  #
  # The Environment= line below is a floor, not the answer: if the env file is
  # ever missing the service still binds to the address found at install time,
  # which is a tailnet address too. It never widens to the LAN.
  cat >> "$UNIT_FILE" <<UNIT
${DETECTED:+Environment=HELM_HOST=${DETECTED}}
Environment=TAILSCALE_BIN=${TS_BIN}
RuntimeDirectory=${APP_NAME}
ExecStartPre=+${SOURCE_DIR}/bin/tailnet-env.sh ${RUNTIME_ENV}
EnvironmentFile=-${RUNTIME_ENV}
UNIT
fi

cat >> "$UNIT_FILE" <<'UNIT'

# Stay out of the way of everything else on the box.
Nice=5
IOSchedulingClass=best-effort
IOSchedulingPriority=6
# A dashboard has no business growing without bound; the server holds only a
# small per-node cache, so this is a bug tripwire rather than a real budget.
MemoryMax=512M

# Logs go to the journal, rate-limited — never to a file that grows on disk.
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

chmod 644 "$UNIT_FILE"
systemctl daemon-reload
systemctl enable "${APP_NAME}.service" >/dev/null 2>&1 || true
systemctl restart "${APP_NAME}.service"

sleep 2
if ! systemctl is-active --quiet "${APP_NAME}.service"; then
  systemctl --no-pager --lines=25 status "${APP_NAME}.service" || true
  die "service failed to start"
fi

BOUND="$(systemctl show "${APP_NAME}.service" -p Environment --value | tr ' ' '\n' | sed -n 's/^HELM_HOST=//p' | tail -1)"
[[ -n "$BOUND" ]] || BOUND="${HOST:-the tailnet address}"

echo
c_ok "${APP_NAME} is running"
if [[ $NO_TAILSCALE -eq 1 ]]; then
  echo "  url:      http://${HOST}:${PORT}/"
else
  echo "  url:      http://$(hostname -s):${PORT}/   (over your tailnet)"
fi
echo "  bound to: ${BOUND}"
echo "  user:     ${RUN_USER} (terminal opens ${USER_SHELL})"
echo "  config:   ${CONFIG_FILE}"
echo "  source:   ${SOURCE_DIR}"
echo "  logs:     journalctl -u ${APP_NAME} -f"
echo "  update:   git -C ${SOURCE_DIR} pull && systemctl restart ${APP_NAME}"
