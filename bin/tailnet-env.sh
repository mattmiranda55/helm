#!/usr/bin/env sh
#
# Resolve this machine's Tailscale IPv4 address and write it out as
# HELM_HOST=<addr> for systemd to read back as an EnvironmentFile.
#
# Run as ExecStartPre, so the address is resolved fresh on every start: a boot
# that gets ahead of tailscaled just waits here, and a tailnet IP that changed
# is picked up without reinstalling anything.
#
# Exits non-zero if no address ever appears, which fails the unit rather than
# letting the server come up bound to something wider than the tailnet.
#
#   tailnet-env.sh /run/helm/env
#
# $TAILSCALE_BIN overrides how tailscale is found; the unit sets it to the
# absolute path so this does not depend on systemd's default PATH.
#
set -eu

OUT="${1:?usage: tailnet-env.sh <output-file>}"
TS="${TAILSCALE_BIN:-tailscale}"
TRIES="${TAILNET_WAIT_TRIES:-60}"   # 60 x 2s = two minutes

i=0
while [ "$i" -lt "$TRIES" ]; do
  addr="$("$TS" ip -4 2>/dev/null | head -1 || true)"
  if [ -n "$addr" ]; then
    echo "HELM_HOST=$addr" > "$OUT"
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done

echo "tailnet-env: tailscale reported no IPv4 address after $((TRIES * 2))s" >&2
exit 1
