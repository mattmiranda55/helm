/**
 * helm server.
 *
 * Three jobs:
 *   1. /api/*  — normalized Glances metrics for every configured node
 *   2. /pty    — a WebSocket-attached PTY (this is why the service runs as root)
 *   3. /       — the built dashboard, in production
 *
 * In development Vite serves the frontend on :5173 and proxies /api and /pty
 * here, so `bun run dev` and the installed service behave identically.
 */

import { loadConfig, type NodeConfig } from './config'
import { fetchHistory, fetchMetrics, fetchPlugin, fetchProcesses } from './glances'
import { act, isAction, logs, nodeIsLocal, resolveEngine } from './containers'
import { publish, startAlerts, sweep } from './alerts'
import { iconFile, isIconSlug } from './icons'
import {
  createStack,
  deleteStack,
  getJob,
  isStackAction,
  listStacks,
  readStackFiles,
  startStackAction,
  subscribe,
  writeStackFiles,
} from './stacks'

const { config, source } = await loadConfig()
const nodesById = new Map<string, NodeConfig>(config.nodes.map((node) => [node.id, node]))

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

const guard = (handler: (req: Request) => Response | Promise<Response>) => (req: Request) =>
  authorized(req) ? handler(req) : fail('unauthorized', 401)

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
    '/api/health': () => json({ ok: true, nodes: config.nodes.length }),

    '/api/config': guard(() =>
      json({
        refreshMs: config.refreshMs,
        terminal: { enabled: config.terminal.enabled },
        commands: config.commands,
        services: config.services,
        stacks: {
          template: config.stacks.template,
          envTemplate: config.stacks.envTemplate,
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
      if (!authorized(req)) return fail('unauthorized', 401)
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
      if (!authorized(req)) return fail('unauthorized', 401)
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

const alertsTask = startAlerts(config)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    alertsTask?.stop()
    process.exit(0)
  })
}

const warn = process.getuid?.() === 0 ? '  (running as root — keep this bound to your tailnet)' : ''
console.log(`helm listening on http://${config.server.host}:${server.port}${warn}`)
console.log(`  config: ${source}`)
console.log(`  nodes:  ${config.nodes.map((n) => `${n.id} → ${n.url}`).join(', ') || 'none'}`)
console.log(`  auth:   ${config.auth.token ? 'token required' : 'open (no token set)'}`)
console.log(`  static: ${hasDist ? DIST : 'not built — use the Vite dev server'}`)
console.log(
  `  alerts: ${
    alertsTask
      ? `ntfy ${config.alerts.url}/${config.alerts.topic} every ${Math.round(config.alerts.intervalMs / 1000)}s`
      : 'off'
  }`,
)
