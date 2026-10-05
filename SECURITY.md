# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub: on this repository, go to
**Security → Report a vulnerability**. Include what you found, how to reproduce
it, and the version or commit you tested.

This is a hobby project maintained by one person, so there is no SLA, but I
will acknowledge a report as soon as I can and credit you in the fix unless you
would rather I didn't.

## What helm exposes

helm is not a read-only dashboard. Know what you are running:

- **The terminal is a shell.** Anyone who can reach the web UI with the
  terminal enabled can run commands as the user the service runs as. Treat
  access to helm as equivalent to SSH access to that account.
- **Container control** (start, stop, restart, logs) acts on the host's
  container engine through that same user.
- **Stack management** can write compose files under the configured `stacks.dir`.

## Recommended deployment

- **Keep it off the public internet.** Bind to loopback or a private network
  such as a Tailscale tailnet. The installer binds to the tailnet address by
  default, or to `127.0.0.1` with `--no-tailscale`.
- **Set `auth.token`** in the config if anyone other than you can reach the
  port, and put TLS in front of it (a reverse proxy) when it is not on a
  trusted network. The token is sent as `?token=` or an `X-Helm-Token` header.
- **Run it as an unprivileged user**, which the installer does. Do not run it
  as root.
- **Disable what you do not need.** Set `terminal.enabled` to `false` if you
  only want metrics, and `stacks.enabled` to `false` if you do not manage
  compose stacks from the UI.
- **Protect the config.** `config.json` can hold access tokens and Glances
  credentials. The installer creates it with mode `600`. Prefer `tokenFile`
  over inline tokens, and never commit a real config.

## Supported versions

Only the latest release (or `main`) receives fixes.

## Out of scope

Exposing helm to the internet with no `auth.token` and the terminal enabled is
a misconfiguration, not a vulnerability in helm.
