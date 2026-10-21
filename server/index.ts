/**
 * helm server.
 *
 * Three jobs:
 *   1. /api/*  — normalized Glances metrics for every configured node
 *   2. /pty    — a WebSocket-attached PTY: a real shell as the service's user
 *   3. /       — the built dashboard, in production
 *
 * In development Vite serves the frontend on :5173 and proxies /api and /pty
 * here, so `bun run dev` and the installed service behave identically.
 */

import { resolve } from 'node:path'
import { configWriteTarget, loadConfig, type NodeConfig } from './config'
import { fetchHistory, fetchMetrics, fetchPlugin, fetchProcesses, forgetNode } from './glances'
import { act, isAction, logs, nodeIsLocal, resolveEngine } from './containers'
import { prepareSetupCode, setupRoutes } from './setup'
import { publish, startAlerts, sweep } from './alerts'
import { iconFile, isIconSlug } from './icons'
import {
  createStack,
  deleteStack,
  effectiveEnvTemplate,
  effectiveTemplate,
  getJob,
  isStackAction,
  listStacks,
  readStackFiles,
  startStackAction,
  subscribe,
  writeStackFiles,
} from './stacks'

const loaded = await loadConfig()
/**
 * The live config. Setup and Settings change it while running: reload()
 * re-reads the file and replaces each key of this same object, so every
 * handler that reads `config.x` sees the new value. server.* (host, port,
 * allowedOrigins) is the exception — it is fixed at startup.
 */
const config = loaded.config
const state = { configured: loaded.configured, source: loaded.source }
const nodesById = new Map<string, NodeConfig>(config.nodes.map((node) => [node.id, node]))

/** Set while unconfigured; see server/setup.ts. */
const setup = state.configured ? null : await prepareSetupCode(configWriteTarget(loaded.path))

const DIST = new URL('../dist/', import.meta.url).pathname
const hasDist = await Bun.file(`${DIST}index.html`).exists()

// ---------------------------------------------------------------- helpers

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const fail = (message: string, status = 500) => json({ error: message }, status)

/** Token may arrive as a header (API) or a query param (WebSocket, which
 *  cannot set headers from the browser). */
function authorized(req: Request): boolean {
  if (!config.auth.token) return true
  const url = new URL(req.url)
  const presented =
    req.headers.get('x-helm-token') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    url.searchParams.get('token')
  return presented === config.auth.token
}

function resolveNode(req: Request): NodeConfig | Response {
  const id = (req as any).params?.id as string
  const node = nodesById.get(id)
  return node ?? fail(`unknown node "${id}"`, 404)
}

// ---------------------------------------------------------------- origins

/**
 * Browser origins other than this server's own that may call it: only what
 * `server.allowedOrigins` names, empty by default. The app is same-origin
 * (served by this server, including as a home-screen web app), so nothing
 * needs to be here unless you put another frontend in front of it.
 */
const allowedOrigins = new Set(config.server.allowedOrigins)

/** Only these may read API responses cross-origin. Never "*", never reflected. */
const corsOrigin = (req: Request): string | null => {
  const origin = req.headers.get('origin')
  return origin && allowedOrigins.has(origin) ? origin : null
}

/**
 * May this request act on the server? Browsers do not apply CORS to
 * WebSockets, and send "simple" POSTs without a preflight, so without this any
 * web page could open /pty — a real shell — or stop containers, whenever no
 * token is set (the default). Allowed:
 *
 *   - no Origin at all: not a browser (curl, scripts) — the token still applies
 *   - Sec-Fetch-Site: same-origin, which pages cannot forge; this is what lets
 *     the Vite dev proxy through, since it rewrites Host but not Origin
 *   - an Origin naming this server's own host (the built app it serves)
 *   - an origin listed in server.allowedOrigins
 */
function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  if (req.headers.get('sec-fetch-site') === 'same-origin') return true
  if (allowedOrigins.has(origin)) return true
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  // A page can't set either header on a WebSocket, and a fetch carrying a
  // custom one is preflighted — which only allowlisted origins pass.
  return host === req.headers.get('host') || host === req.headers.get('x-forwarded-host')
}

const PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
  'Access-Control-Allow-Headers': 'X-Helm-Token, X-Helm-Setup-Code, Authorization, Content-Type',
  // WebKit caps this at 10 minutes anyway.
  'Access-Control-Max-Age': '600',
}

/** Answers preflights itself (before auth: a preflight never carries the
 *  token) and stamps CORS headers on responses for allowlisted origins. */
const cors =
  (handler: (req: Request) => Response | Promise<Response>) => async (req: Request) => {
    const origin = corsOrigin(req)
    if (req.method === 'OPTIONS') {
      if (!origin) return fail('origin not allowed', 403)
      return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', ...PREFLIGHT_HEADERS },
      })
    }
    const response = await handler(req)
    // Whether the header is present depends on Origin, so caches must key on it.
    response.headers.append('Vary', 'Origin')
    if (origin) response.headers.set('Access-Control-Allow-Origin', origin)
    return response
  }

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

/**
 * Until first-run setup is done there is no token, so nothing but the setup
 * flow may run: above all not the terminal, which could simply read the
 * setup code off disk and make it pointless. /api/config stays readable (it
 * is only the defaults then) so the app can load far enough to show setup.
 */
const OPEN_DURING_SETUP = new Set(['/api/config'])
const setupPending = (req: Request) =>
  !state.configured && !OPEN_DURING_SETUP.has(new URL(req.url).pathname)

const guard = (handler: (req: Request) => Response | Promise<Response>) =>
  cors((req: Request) => {
    if (setupPending(req)) return fail('helm is not set up yet — finish setup first', 409)
    if (MUTATING.has(req.method) && !originAllowed(req)) return fail('origin not allowed', 403)
    return authorized(req) ? handler(req) : fail('unauthorized', 401)
  })

/** WebSocket upgrades: same origin rules as mutations, then the token. */
function refuseUpgrade(req: Request): Response | null {
  if (setupPending(req)) return fail('helm is not set up yet — finish setup first', 409)
  if (!originAllowed(req)) {
    console.warn(`[ws] refused ${new URL(req.url).pathname} from origin ${req.headers.get('origin')}`)
    return fail('origin not allowed', 403)
  }
  return authorized(req) ? null : fail('unauthorized', 401)
}

// ---------------------------------------------------------------- PTY

type PtySession = {
  kind: 'pty'
  terminal?: Bun.Terminal
  proc?: Bun.Subprocess
  label: string
}
/** Streams a stack job's output; see the note in server/stacks.ts. */
type StackSession = { kind: 'stack'; name: string; unsubscribe?: () => void }
type Session = PtySession | StackSession

function resolveShell(): { cmd: string[]; label: string } {
  const shell = config.terminal.shell || process.env.SHELL || '/bin/bash'
  return { cmd: [shell, ...config.terminal.args], label: shell }
}

function openPty(ws: Bun.ServerWebSocket<Session>) {
  const { cmd, label } = resolveShell()

  // The terminal MUST be described inline rather than built with
  // `new Bun.Terminal(...)` and passed in. Only on this path does Bun call
  // setsid() for the pty, making the shell a session leader that owns the
  // terminal. Hand it a prebuilt Terminal and bash comes up with
  // "cannot set terminal process group / no job control" — no Ctrl+C, no
  // Ctrl+Z, no fg/bg.
  const proc = Bun.spawn(cmd, {
    terminal: {
      cols: 80,
      rows: 24,
      name: 'xterm-256color',
      data: (_terminal, data) => ws.send(data),
    },
    cwd: config.terminal.cwd ?? undefined,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    onExit: () => ws.close(),
  })

  if (ws.data.kind !== 'pty') return
  ws.data.terminal = proc.terminal
  ws.data.proc = proc
  ws.data.label = label
}

function closePty(ws: Bun.ServerWebSocket<Session>) {
  if (ws.data.kind !== 'pty') return
  try {
    ws.data.proc?.kill()
  } catch {}
  try {
    ws.data.terminal?.close()
  } catch {}
  ws.data.proc = undefined
  ws.data.terminal = undefined
}

// ---------------------------------------------------------------- static

async function serveStatic(req: Request): Promise<Response> {
  if (!hasDist) {
    return new Response(
      'No build found. Run `bun run dev` for the Vite dev server, or `bun run build` first.',
      { status: 503, headers: { 'Content-Type': 'text/plain' } },
    )
  }
  const { pathname } = new URL(req.url)
  // An unmatched /api path is a mistake, not a deep link — answer as the API,
  // not with the SPA shell.
  if (pathname.startsWith('/api/')) return fail(`no such endpoint: ${pathname}`, 404)
  const candidate = Bun.file(`${DIST}${pathname.replace(/^\/+/, '') || 'index.html'}`)
  if (await candidate.exists()) {
    // Bun infers types from the extension, but not this one — and iOS ignores
    // a manifest served as octet-stream.
    const headers: Record<string, string> = pathname.endsWith('.webmanifest')
      ? { 'Content-Type': 'application/manifest+json' }
      : {}
    // Hashed asset names make these safe to cache hard; index.html is not.
    if (pathname.startsWith('/assets/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    }
    return new Response(candidate, { headers })
  }
  // SPA fallback.
  return new Response(Bun.file(`${DIST}index.html`))
}

// ---------------------------------------------------------------- server

const server = Bun.serve<Session, {}>({
  hostname: config.server.host,
  port: config.server.port,
  idleTimeout: 120,

  routes: {
    // Open on purpose (a liveness probe, no secrets); CORS so the native
    // app's Settings page can test an address before it has a token.
    // `setup` tells the app to show the first-run wizard instead of asking for
    // a token it cannot have yet.
    '/api/health': cors(() =>
      json({ ok: true, nodes: config.nodes.length, setup: !state.configured }),
    ),

    ...setupRoutes({ config, state, reload, cors, guard, originAllowed, authorized }),

    '/api/config': guard(() =>
      json({
        setupNeeded: !state.configured,
        refreshMs: config.refreshMs,
        terminal: { enabled: config.terminal.enabled },
        commands: config.commands,
        services: config.services,
        // Always the effective text — the built-in default when the config
        // leaves it null — so a new stack never needs a client-side fallback.
        stacks: {
          template: effectiveTemplate(config.stacks),
          envTemplate: effectiveEnvTemplate(config.stacks),
          templateIsDefault: config.stacks.template === null,
          // Shown on the Settings page's Stacks row; null = stacks are off.
          dir: config.stacks.dir,
        },
        // The home page flags the same disk level the alerts use, so the two
        // never disagree about what "almost full" means.
        thresholds: { fs: config.alerts.rules.fs ?? 90 },
        nodes: config.nodes.map(({ id, label, url }) => ({ id, label, url })),
      }),
    ),

    // Same-origin icons, so the browser never talks to a CDN. Fetched once,
    // then served from disk; see server/icons.ts.
    '/api/icons/:slug': guard(async (req) => {
      const slug = String((req as any).params.slug ?? '').replace(/\.png$/, '')
      if (!isIconSlug(slug)) return fail('bad icon name', 400)
      const file = await iconFile(slug)
      if (!file) return fail('no such icon', 404)
      return new Response(file, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }),

    '/api/nodes/:id/metrics': guard(async (req) => {
      const node = resolveNode(req)
      if (node instanceof Response) return node
      try {
        // Tier-0 plugins are allowed to be ~one poll old, so several open tabs
        // collapse into roughly one fetch per interval against the node.
        return json(await fetchMetrics(node, config.refreshMs * 0.8))
      } catch (error) {
        return fail(`${node.label}: ${(error as Error).message}`, 502)
      }
    }),

    '/api/nodes/:id/processes': guard(async (req) => {
      const node = resolveNode(req)
      if (node instanceof Response) return node
      const limit = Number(new URL(req.url).searchParams.get('limit') ?? 20)
      try {
        return json(await fetchProcesses(node, Math.min(Math.max(limit, 1), 100)))
      } catch (error) {
        return fail(`${node.label}: ${(error as Error).message}`, 502)
      }
    }),

    // Seeds the sparklines on first load. Returns nothing rather than
    // something misleading when the node has no recent unbroken history.
    '/api/nodes/:id/history': guard(async (req) => {
      const node = resolveNode(req)
      if (node instanceof Response) return node
      const points = Number(new URL(req.url).searchParams.get('points') ?? 60)
      try {
        return json(await fetchHistory(node, Math.min(Math.max(points, 2), 200)))
      } catch (error) {
        return fail(`${node.label}: ${(error as Error).message}`, 502)
      }
    }),

    // Fires one notification so you can confirm ntfy delivery end to end
    // without waiting for something to actually break.
    '/api/alerts/test': guard(async (req) => {
      if (req.method !== 'POST') return fail('use POST', 405)
      if (!config.alerts.enabled || !config.alerts.url) {
        return fail('alerts are not configured — set alerts.url and alerts.enabled', 400)
      }
      try {
        await publish(config.alerts, {
          title: 'helm: test',
          message: `Alerts are wired up. Watching ${config.nodes.length} node(s) every ${Math.round(config.alerts.intervalMs / 1000)}s.`,
          priority: 3,
          tags: ['white_check_mark'],
        })
        return json({ ok: true, topic: config.alerts.topic })
      } catch (error) {
        return fail((error as Error).message, 502)
      }
    }),

    // Runs the real evaluation immediately instead of waiting for the timer.
    '/api/alerts/sweep': guard(async (req) => {
      if (req.method !== 'POST') return fail('use POST', 405)
      try {
        await sweep(config)
        return json({ ok: true })
      } catch (error) {
        return fail((error as Error).message, 500)
      }
    }),

    // Which nodes this server can actually act on, so the UI only offers
    // buttons that will work.
    '/api/nodes/:id/capabilities': guard(async (req) => {
      const node = resolveNode(req)
      if (node instanceof Response) return node
      const local = await nodeIsLocal(node)
      return json({
        containers:
          config.containers.enabled && local && !!resolveEngine(config.containers.command),
        stacks: config.stacks.enabled && local && !!config.stacks.dir,
        local,
      })
    }),

    '/api/stacks': guard(async (req) => {
      if (!config.stacks.enabled) return fail('stacks are disabled', 403)
      try {
        if (req.method === 'POST') {
          const body = await req.json()
          const result = await createStack(
            config.stacks,
            String(body.name ?? ''),
            String(body.compose ?? ''),
            String(body.env ?? ''),
          )
          console.log(`[stacks] created ${result.name}`)
          return json(result)
        }
        return json(await listStacks(config.stacks))
      } catch (error) {
        return fail((error as Error).message, 400)
      }
    }),

    '/api/stacks/:name/files': guard(async (req) => {
      if (!config.stacks.enabled) return fail('stacks are disabled', 403)
      const { name } = (req as any).params
      try {
        if (req.method === 'GET') return json(await readStackFiles(config.stacks, name))
        if (req.method === 'PUT') {
          const body = await req.json()
          return json(
            await writeStackFiles(config.stacks, name, String(body.compose ?? ''), String(body.env ?? '')),
          )
        }
        return fail('use GET or PUT', 405)
      } catch (error) {
        return fail((error as Error).message, 400)
      }
    }),

    '/api/stacks/:name/job': guard(async (req) => {
      const { name } = (req as any).params
      const job = getJob(name)
      return json(job ?? null)
    }),

    '/api/stacks/:name': guard(async (req) => {
      if (!config.stacks.enabled) return fail('stacks are disabled', 403)
      if (req.method !== 'DELETE') return fail('use DELETE', 405)
      const { name } = (req as any).params
      try {
        const result = await deleteStack(config.stacks, name)
        console.log(`[stacks] deleted ${name}`)
        return json(result)
      } catch (error) {
        return fail((error as Error).message, 400)
      }
    }),

    '/api/stacks/:name/:action': guard(async (req) => {
      if (req.method !== 'POST') return fail('use POST', 405)
      if (!config.stacks.enabled) return fail('stacks are disabled', 403)
      const { name, action } = (req as any).params
      if (!isStackAction(action)) return fail(`unknown action "${action}"`, 400)
      try {
        // Returns as soon as the job starts; output arrives over /api/stacks/stream.
        const job = await startStackAction(config.stacks, name, action)
        console.log(`[stacks] ${action} ${name}`)
        return json({ started: true, name, action, startedAt: job.startedAt })
      } catch (error) {
        return fail((error as Error).message, 400)
      }
    }),

    '/api/stacks/stream': (req, server) => {
      if (!config.stacks.enabled) return fail('stacks are disabled', 403)
      const refused = refuseUpgrade(req)
      if (refused) return refused
      const name = new URL(req.url).searchParams.get('name') ?? ''
      if (server.upgrade(req, { data: { kind: 'stack', name } })) return undefined as never
      return new Response('Expected a WebSocket upgrade', { status: 426 })
    },

    '/api/nodes/:id/containers/:name/logs': guard(async (req) => {
      const node = resolveNode(req)
      if (node instanceof Response) return node
      if (!config.containers.enabled) return fail('container control is disabled', 403)
      const { name } = (req as any).params
      const tail = Number(new URL(req.url).searchParams.get('tail') ?? 200)
      try {
        return json(
          await logs(node, name, Math.min(Math.max(tail, 1), 2000), config.containers.command),
        )
      } catch (error) {
        return fail((error as Error).message, 400)
      }
    }),

    '/api/nodes/:id/containers/:name/:action': guard(async (req) => {
      // Acting on something is a POST, so it can never happen by navigation.
      if (req.method !== 'POST') return fail('use POST', 405)
      const node = resolveNode(req)
      if (node instanceof Response) return node
      if (!config.containers.enabled) return fail('container control is disabled', 403)

      const { name, action } = (req as any).params
      if (!isAction(action)) return fail(`unknown action "${action}"`, 400)
      try {
        const result = await act(node, name, action, config.containers.command)
        console.log(`[containers] ${action} ${name} on ${node.id}`)
        return json(result)
      } catch (error) {
        return fail((error as Error).message, 400)
      }
    }),

    // Escape hatch for any Glances plugin the dashboard does not normalize.
    '/api/nodes/:id/plugin/:plugin': guard(async (req) => {
      const node = resolveNode(req)
      if (node instanceof Response) return node
      const plugin = (req as any).params.plugin as string
      try {
        return json(await fetchPlugin(node, plugin))
      } catch (error) {
        return fail(`${node.label}: ${(error as Error).message}`, 502)
      }
    }),

    '/pty': (req, server) => {
      if (!config.terminal.enabled) return fail('terminal is disabled', 403)
      const refused = refuseUpgrade(req)
      if (refused) return refused
      if (server.upgrade(req, { data: { kind: 'pty', label: '' } })) return undefined as never
      return new Response('Expected a WebSocket upgrade', { status: 426 })
    },
  },

  fetch: serveStatic,

  websocket: {
    open(ws) {
      if (ws.data.kind === 'stack') {
        // Replay whatever the job has produced so far, then follow it live, so
        // reconnecting mid-pull shows the whole run rather than the tail.
        const existing = getJob(ws.data.name)
        if (existing) {
          ws.send(JSON.stringify({ type: 'snapshot', job: existing }))
          if (existing.done) return
        }
        ws.data.unsubscribe = subscribe(ws.data.name, (job, chunk) => {
          try {
            ws.send(
              chunk === null
                ? JSON.stringify({ type: 'done', code: job.code })
                : JSON.stringify({ type: 'output', text: chunk }),
            )
          } catch {}
        })
        return
      }
      openPty(ws)
    },
    message(ws, message) {
      if (ws.data.kind === 'stack') return
      // Control frames are JSON text; keystrokes are binary.
      if (typeof message === 'string') {
        try {
          const msg = JSON.parse(message)
          if (msg.type === 'resize') ws.data.terminal?.resize(msg.cols, msg.rows)
        } catch {}
        return
      }
      ws.data.terminal?.write(message)
    },
    close(ws) {
      if (ws.data.kind === 'stack') {
        // The job keeps running — only the stream stops.
        ws.data.unsubscribe?.()
        return
      }
      closePty(ws)
    },
  },

  error(error) {
    console.error('[server]', error)
    return fail(error.message)
  },
})

let alertsTask = startAlerts(config)

/**
 * Load the config file again and apply it in place — what setup and Settings
 * call after writing. Glances caches are dropped for nodes that went away or
 * are now reached differently, and the alert timer restarts on the new
 * settings (its per-condition state is kept). server.* still needs a restart.
 */
async function reload() {
  const next = await loadConfig()
  const before = new Map(nodesById)
  const { server: _startupOnly, ...rest } = next.config
  Object.assign(config, rest)

  nodesById.clear()
  for (const node of config.nodes) nodesById.set(node.id, node)
  for (const [id, old] of before) {
    const now = nodesById.get(id)
    const same =
      now &&
      now.url === old.url &&
      now.api === old.api &&
      now.username === old.username &&
      now.password === old.password
    if (!same) forgetNode(id)
  }

  state.configured = next.configured
  state.source = next.source
  alertsTask?.stop()
  alertsTask = startAlerts(config)
  console.log(
    `[config] reloaded ${next.source}: ${config.nodes.map((n) => n.id).join(', ') || 'no nodes'}`,
  )
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    alertsTask?.stop()
    process.exit(0)
  })
}

const warn = process.getuid?.() === 0 ? '  (running as root — keep this bound to your tailnet)' : ''
console.log(`helm listening on http://${config.server.host}:${server.port}${warn}`)
console.log(`  config: ${state.source}`)
console.log(`  nodes:  ${config.nodes.map((n) => `${n.id} → ${n.url}`).join(', ') || 'none'}`)
console.log(`  auth:   ${config.auth.token ? 'token required' : 'open (no token set)'}`)
console.log(`  origins: same host${allowedOrigins.size ? ` + ${[...allowedOrigins].join(', ')}` : ' only'}`)
console.log(`  static: ${hasDist ? DIST : 'not built — use the Vite dev server'}`)
console.log(
  `  alerts: ${
    alertsTask
      ? `ntfy ${config.alerts.url}/${config.alerts.topic} every ${Math.round(config.alerts.intervalMs / 1000)}s`
      : 'off'
  }`,
)
if (setup) {
  console.log(`  setup:  not configured yet — open the app and enter setup code ${setup.code}`)
  console.log(
    `          (${setup.saved ? `also in ${setup.path}` : `could not save it to ${setup.path}`}; the config will be written to ${resolve(configWriteTarget(loaded.path))})`,
  )
}
