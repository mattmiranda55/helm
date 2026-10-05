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

async function run(engine: string, args: string[]) {
  const proc = Bun.spawn([engine, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => {
    try {
      proc.kill()
    } catch {}
  }, TIMEOUT_MS)

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
