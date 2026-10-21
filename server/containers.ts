/**
 * Container control.
 *
 * Glances is read-only, so acting on a container means running the engine CLI
 * locally. That is only possible on the machine this server runs on — there is
 * no remote path — so actions are offered for the local node and nothing else.
 * A node is "local" when its Glances hostname matches ours, which needs no
 * configuration and stays right if the config is copied between machines.
 *
 * This crosses no privilege boundary that the app did not already have: the
 * terminal is a full shell as the same user. It does mean the server executes
 * commands, so every call is argv-only (never a shell string) and the container
 * name is checked against the live list before it is used.
 */

import { hostname } from 'node:os'
import type { NodeConfig } from './config'
import { fetchMetrics } from './glances'

export type Action = 'start' | 'stop' | 'restart'
const ACTIONS: Action[] = ['start', 'stop', 'restart']

export const isAction = (value: string): value is Action => ACTIONS.includes(value as Action)

/** Stop and restart wait on the container's own shutdown grace period. */
const TIMEOUT_MS = 45_000

let engineCache: string | null | undefined

export function resolveEngine(configured?: string | null): string | null {
  if (configured) return configured
  if (engineCache !== undefined) return engineCache
  engineCache = Bun.which('podman') ?? Bun.which('docker') ?? null
  return engineCache
}

const shortHost = (value: string) => String(value ?? '').split('.')[0].trim().toLowerCase()

export async function nodeIsLocal(node: NodeConfig): Promise<boolean> {
  if (typeof node.local === 'boolean') return node.local
  try {
    const metrics = await fetchMetrics(node)
    const there = shortHost(metrics.system.hostname)
    return there.length > 0 && there === shortHost(hostname())
  } catch {
    return false
  }
}

async function run(engine: string, args: string[], timeoutMs = TIMEOUT_MS) {
  const proc = Bun.spawn([engine, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => {
    try {
      proc.kill()
    } catch {}
  }, timeoutMs)

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited
  clearTimeout(timer)
  return { code, stdout, stderr }
}

/** Guards every command: the name must be a container this node reports. */
async function assertKnown(node: NodeConfig, name: string) {
  const metrics = await fetchMetrics(node, 0)
  const container = metrics.containers.find((entry) => entry.name === name)
  if (!container) throw new Error(`no container named "${name}" on ${node.label}`)
  return container
}

export async function act(node: NodeConfig, name: string, action: Action, engineBin?: string | null) {
  if (!(await nodeIsLocal(node))) {
    throw new Error(`${node.label} is not this machine — containers can only be controlled locally`)
  }
  const engine = resolveEngine(engineBin)
  if (!engine) throw new Error('no podman or docker binary found on this machine')

  await assertKnown(node, name)
  const { code, stdout, stderr } = await run(engine, [action, name])
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `${engine} ${action} exited ${code}`)
  }
  return { ok: true, action, name, engine, output: (stdout + stderr).trim() }
}

export async function logs(
  node: NodeConfig,
  name: string,
  tail: number,
  engineBin?: string | null,
) {
  if (!(await nodeIsLocal(node))) {
    throw new Error(`${node.label} is not this machine — logs can only be read locally`)
  }
  const engine = resolveEngine(engineBin)
  if (!engine) throw new Error('no podman or docker binary found on this machine')

  await assertKnown(node, name)
  // Container stdout and stderr both matter, and the engine keeps them split.
  const { stdout, stderr } = await run(engine, ['logs', '--tail', String(tail), name])
  return { name, engine, tail, text: (stdout + stderr).trimEnd() || '(no output)' }
}

export type LocalContainer = { name: string; image: string | null; status: string; ports: number[] }

/** Distinct published host ports, from either engine's way of saying it. */
function hostPorts(ports: unknown): number[] {
  const found = new Set<number>()
  if (Array.isArray(ports)) {
    // podman: [{ host_ip, container_port, host_port, range, protocol }]
    for (const entry of ports as any[]) {
      const port = Number(entry?.host_port ?? entry?.hostPort ?? entry?.PublicPort)
      if (Number.isInteger(port) && port > 0) found.add(port)
    }
  } else if (typeof ports === 'string') {
    // docker: "0.0.0.0:8096->8096/tcp, :::8096->8096/tcp, 0.0.0.0:7000-7002->7000-7002/tcp"
    for (const match of ports.matchAll(/:(\d+)(?:-\d+)?->/g)) found.add(Number(match[1]))
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * Every container on this machine, running or not, with the host ports it
 * publishes — what first-run setup uses to suggest apps and their URLs.
 * Argv-only like everything else here. Empty when there is no engine or it
 * cannot be asked (a rootless podman with no user session, say).
 */
export async function listLocalContainers(
  engineBin?: string | null,
): Promise<{ engine: string | null; containers: LocalContainer[] }> {
  const engine = resolveEngine(engineBin)
  if (!engine) return { engine: null, containers: [] }
  const name = engine.split('/').pop() ?? engine
  const podman = name.includes('podman')
  let stdout = ''
  try {
    const result = await run(
      engine,
      ['ps', '-a', '--format', podman ? 'json' : '{{json .}}'],
      10_000,
    )
    if (result.code !== 0) {
      console.warn(`[containers] ${name} ps exited ${result.code}: ${result.stderr.trim()}`)
      return { engine: name, containers: [] }
    }
    stdout = result.stdout
  } catch (error) {
    console.warn(`[containers] ${name} ps failed: ${(error as Error).message}`)
    return { engine: name, containers: [] }
  }

  // podman prints one JSON array; docker (and podman with a Go template)
  // prints one object per line.
  let entries: any[] = []
  const text = stdout.trim()
  try {
    const parsed = JSON.parse(text || '[]')
    entries = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    entries = text
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }

  const containers = entries
    .map((entry: any): LocalContainer | null => {
      const names = Array.isArray(entry?.Names) ? entry.Names : String(entry?.Names ?? '').split(',')
      const containerName = String(names[0] ?? '').replace(/^\//, '').trim()
      if (!containerName) return null
      return {
        name: containerName,
        image: entry.Image ? String(entry.Image) : null,
        status: String(entry.State ?? entry.Status ?? 'unknown').toLowerCase(),
        ports: hostPorts(entry.Ports),
      }
    })
    .filter((entry): entry is LocalContainer => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { engine: name, containers }
}
