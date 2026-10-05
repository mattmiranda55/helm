# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

helm is a single-page homelab dashboard: a Bun server (`server/`, TypeScript) that proxies and normalizes [Glances](https://nicolargo.github.io/glances/) metrics for any number of nodes, controls local containers and compose stacks, sends ntfy alerts, and exposes a real PTY over WebSocket — plus a Vue 3 + Tailwind 4 frontend (`src/`, plain JS, no TypeScript) built with Vite. README.md is detailed and authoritative on behavior and the reasoning behind it.

## Commands

```sh
bun install
cp config.example.json config.json   # gitignored; nodes, services, commands, alerts, stacks
bun dev              # Bun server on :3001 (--hot) + Vite on :5173 together
bun run dev:server   # server only
bun run dev:web      # Vite only (HELM_SERVER overrides the proxy target, default http://127.0.0.1:3001)
bun run build        # vite build → dist/
bun start            # production: serves dist/, /api and /pty on :3001
```

There is no test suite, linter, or typechecker configured. Verify server changes by running it and hitting endpoints (e.g. `curl localhost:3001/api/health`, `curl -X POST localhost:3001/api/alerts/sweep`).

## Things that are easy to get wrong

- **`dist/` is committed and is the deployment.** Servers run `git pull && systemctl restart helm` straight from the checkout — nothing builds on the box. Any frontend change must be followed by `bun run build` and committing the regenerated `dist/`, or it never ships.
- **The server must have no runtime dependencies.** `server/` imports only Bun built-ins and `node:*` modules so an install is `dist/` + `server/` with no `node_modules`. The npm dependencies in `package.json` are frontend-only (bundled by Vite).
- **Glances requests must stay sequential and minimal** (`server/glances.ts`). Glances computes CPU/IO percentages from deltas against its own last sample, so concurrent plugin requests corrupt each other's readings. Never call `/all`; add new plugins to `PLUGIN_TTL_MS` with the slowest TTL that works. Fetches happen only when a browser asks, cached so multiple viewers coalesce into one fetch (`refreshMs * 0.8` freshness floor). The only timer-driven polling is alerts (`server/alerts.ts`).
- **The process list is expensive** — fetched only while that panel is open (`wantProcesses` in `useMetrics.js`).
- **PTY spawning**: pass `terminal: {...}` options inline to `Bun.spawn`, never a prebuilt `new Bun.Terminal(...)` — only the inline path calls `setsid()`, without which job control (Ctrl+C/Z, fg/bg) breaks. See `openPty` in `server/index.ts`.
- **Command execution is argv-only**, never shell strings. Container names are validated against the live list; stack names are validated and resolved inside the stacks dir before any delete. Mutating actions are POST/PUT/DELETE only.
- **Container and stack actions are local-node only.** Glances is read-only, so actions shell out to `podman`/`docker` on the server's own machine. `nodeIsLocal` (`server/containers.ts`) detects this by matching the Glances hostname, overridable with `"local": true/false` on a node; `/api/nodes/:id/capabilities` tells the UI which buttons to show.
- **Alerts**: `containerCrashed` fires only for `restarting`/`dead`, never `exited` (a manual stop). Utilisation rules default to `null` (off) deliberately — don't flip them on in defaults.

## Architecture

**Server (`server/index.ts`)** — one `Bun.serve` with a `routes` table. Every route is wrapped in `guard()` (optional token via `X-Helm-Token`, `Authorization: Bearer`, or `?token=`). Two WebSocket kinds share one `websocket` handler, discriminated by `ws.data.kind`: `'pty'` (keystrokes binary, control frames JSON like `{type:'resize'}`) and `'stack'` (streams a compose job's output). Unmatched non-`/api` paths fall back to serving `dist/` as an SPA.

- `config.ts` — loads the first existing of `$HELM_CONFIG`, `./config.json`, `~/.config/helm/config.json`, `/etc/helm/config.json`, merges onto `DEFAULTS`, normalizes, then applies `HELM_*` env overrides (used by the systemd unit). Types for every config section live here.
- `glances.ts` — TTL-tiered client plus normalization into a compact snapshot, so the frontend never deals with raw Glances shapes or per-node plugin availability. Also history backfill for sparklines.
- `containers.ts` — engine resolution, start/stop/restart, logs.
- `stacks.ts` — compose stacks in `stacks.dir` (same dir Dockge uses). `up`/`down`/`restart` run as in-memory jobs that outlive the request; WebSocket subscribers get a snapshot replay then live output. One job per stack. Saves validate via `compose config` on a temp copy and keep `.bak` files. Containers map to stacks via the `com.docker.compose.project.working_dir` label.
- `alerts.ts` — the periodic sweep (sustain/repeat/recovery state machine) publishing to ntfy.
- `icons.ts` — `/api/icons/:slug`: fetches a dashboard-icons PNG once, caches it under `~/.cache/helm/icons` (or `$XDG_CACHE_HOME`), serves it immutable. Slugs are validated; misses are remembered for an hour.

**Frontend (`src/`)** — multi-page, mobile first. `App.vue` is a thin shell (header, current page, phone tab bar); `lib/router.js` is a dependency-free router over real paths (`/`, `/machines/:id`, `/apps`, `/containers`, `/terminal`), with page state in the query string. Pages live in `src/pages/`, feature components in `src/components/<feature>/`, primitives in `src/components/ui/`. `composables/useMetrics.js` polls one node with self-scheduling (finish-then-wait, aborts on node switch, pauses when tab hidden); `useFleet.js` runs one `useMetrics` per node for the pages that summarize all machines. `lib/attention.js` mirrors the alert rules for the home page's "Needs attention". `lib/api.js` is the only fetch layer; same-origin in dev (Vite proxies `/api` and `/pty`) and prod. `lib/history.js` holds per-node sparkline ring buffers (60 samples). The terminal stays mounted (hidden) after first visit so the shell survives page switches; xterm is lazy-loaded only then. The `@` alias maps to `src/`.

Styling: Tailwind 4 tokens in `src/assets/main.css` under `@theme static` (static matters — without it Tailwind drops tokens no utility references, e.g. the status colors used only via `var()`), redefined for dark mode under `prefers-color-scheme`. Color means data or state only; no brand accent. Fonts are Quicksand (text) and Space Mono (numbers, identifiers, terminal), bundled via `@fontsource` — never loaded from Google. Shared control classes (`.btn`, `.chip`, `.note`, `.page`…) are in the same file. Design rationale is in `docs/redesign/plan.md`.

**Deployment** — `install.sh` writes a systemd unit running `bun run server/index.ts` from the checkout as the installing user (not root), config at `/etc/helm/config.json`. `bin/tailnet-env.sh` runs as `ExecStartPre` to resolve the Tailscale IP on every start; the bind fails closed rather than widening. The terminal is a full shell, so never change defaults in a way that exposes the server beyond the tailnet/localhost.
