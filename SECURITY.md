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
- **Stack management** can write compose files under the configured `stacks.dir`
  and delete a stack's folder recursively, data included. The folder is set
  from setup or Settings, so the server refuses anything but an absolute path
  to an existing directory, and never `/`, the service user's home or a system
  root such as `/etc`, `/home`, `/opt` or `/var`. Delete only removes a folder
  inside it that holds a compose file, so a stacks folder shared with other
  things doesn't make every subfolder deletable.
- **Settings writes helm's own config.** Anyone with access can change which
  machines are watched, the apps, the terminal commands and the stacks folder,
  compose command and templates. A Glances **Test** makes the server fetch an
  address the user types.

## First-run setup

A fresh install has no config and no token, so until it is set up helm is
locked down:

- **Every API route and WebSocket answers 409** except `/api/health` (no
  secrets), `/api/config` (only the defaults at that point) and the setup
  endpoints under `/api/setup/`. That includes the terminal: a shell could read
  the setup code off disk and make it pointless.
- **The setup endpoints need a one-time setup code**, sent as
  `X-Helm-Setup-Code`. It is 8 random characters (nearly 40 bits), generated with
  `node:crypto` on first start, printed by `install.sh` and in the service log,
  and kept in `setup-code` (mode 600) in the config directory — `/etc/helm`,
  owned by the service user, mode 700 — so it survives restarts. Anyone who can
  read that file could write the config directly anyway. It is compared in
  constant time and deleted once setup completes.
- **Wrong codes are rate-limited**: after 10 in 10 minutes, every attempt gets
  a 429 until the window passes. The count is global and in memory, so a
  restart clears it. A guesser can hold setup up ten minutes at a time but gets
  nowhere near the code.
- The setup endpoints also go through the same origin check as every other
  mutation, and require `HELM_TOKEN` if the environment sets one.
- **Once setup is done, every `/api/setup/` endpoint answers 409** for good.

Setup offers to **generate an access token** (32 random bytes, base64url). It
is returned once in the response that finishes setup, saved in that browser's
`localStorage`, and written to `auth.token`; it is never shown again. Choosing
no token leaves the tailnet (or loopback) as the only boundary.

## Settings (admin endpoints)

After setup, Settings edits the config through `GET`/`PUT /api/admin/config`,
`GET /api/admin/local` and `POST /api/admin/probe`. They sit behind the normal
token and origin check, and answer 409 until setup is done — otherwise, with no
token yet, they would be a way to write the first config without the code.

- Saves are validated exactly as a startup would, written atomically (temp
  file and rename) with mode 600, and one at a time.
- Only `nodes`, `services` and `commands` are replaced; every other key is
  written back as it was. Glances passwords are never sent to the browser
  (only whether one is saved), and are kept unless a new one is given.
- Machines set by `HELM_NODES` cannot be changed from Settings.

The Glances probe (setup's and Settings' **Test**) is a server-side request to
a user-supplied URL. It is limited to `http`/`https`, rejects credentials in the
URL, does not follow redirects, times out after 5 seconds, caps response sizes,
and only requests Glances' `system` and `containers` endpoints. It is reachable
only with the setup code or the token — and whoever has those already has the
terminal.

## Cross-site requests

Being on a private network does not stop a web page you visit from talking to
helm: browsers apply no CORS to WebSocket upgrades or to simple POSTs, so a
malicious page could otherwise open the terminal or act on containers through
your browser whenever no token is set. helm therefore checks the `Origin` of
every WebSocket upgrade (`/pty`, `/api/stacks/stream`) and every mutating
request (`POST`, `PUT`, `DELETE`, `PATCH`), and refuses it with a 403 unless:

- there is no `Origin` header (not a browser; the token still applies),
- the browser marks it `Sec-Fetch-Site: same-origin`,
- the `Origin` host equals the request's `Host` (or the `X-Forwarded-Host`
  set by the Vite dev proxy), or
- the origin is listed exactly in `server.allowedOrigins`.

`server.allowedOrigins` is empty by default, since the app is served by helm
itself. Wildcards (`*`), the `null` origin and anything that is not a bare
origin are rejected when the config loads. CORS headers are sent only to those
listed origins, never `*` and never a reflected origin. The origin check keeps
other web pages out; it does not authenticate anyone — use `auth.token` for
that.

## Recommended deployment

- **Keep it off the public internet.** Bind to loopback or a private network
  such as a Tailscale tailnet. The installer binds to the tailnet address by
  default, or to `127.0.0.1` with `--no-tailscale`.
- **Set `auth.token`** — let setup generate one — if anyone other than you can
  reach the port, and put TLS in front of it (a reverse proxy) when it is not on a
  trusted network. The token is sent as `?token=`, an `X-Helm-Token` header or
  `Authorization: Bearer`. The app keeps it in the browser's `localStorage`
  and removes `?token=` from the address bar after the first load.
- **Keep `server.allowedOrigins` empty** unless you deliberately serve another
  frontend from a different origin, and then list only that exact origin.
- **Run it as an unprivileged user**, which the installer does. Do not run it
  as root.
- **Disable what you do not need.** Set `terminal.enabled` to `false` if you
  only want metrics, and `stacks.enabled` to `false` if you do not manage
  compose stacks from the UI.
- **Protect the config.** `config.json` can hold access tokens and Glances
  credentials. helm writes it with mode `600` in a directory only the service
  user can open (`/etc/helm`, mode `700`), and the installer resets an existing
  one to `600`. Prefer `tokenFile` over inline tokens, and never commit a real
  config.
- **Finish setup promptly** after installing. Until then, anyone who can reach
  the port and has the setup code can configure helm; the code is only on the
  server and in the install output.

## Supported versions

Only the latest release (or `main`) receives fixes.

## Out of scope

Exposing helm to the internet with no `auth.token` and the terminal enabled is
a misconfiguration, not a vulnerability in helm.
