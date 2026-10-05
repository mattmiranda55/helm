/**
 * Compose stacks — the Dockge-shaped half of container management.
 *
 * A stack is a directory holding a compose file, which is exactly what Dockge
 * treats as one, so the two agree on what exists without sharing any state.
 * Containers are matched back to their stack through the
 * `com.docker.compose.project.working_dir` label rather than by name: Dockge's
 * own stack lives outside the stacks directory, and matching on name alone
 * would mislabel it.
 *
 * Local only, like every other action here — Glances is read-only and there is
 * no remote execution path.
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { StacksConfig } from './config'

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']

export type StackAction = 'up' | 'down' | 'restart'
const ACTIONS: StackAction[] = ['up', 'down', 'restart']
export const isStackAction = (v: string): v is StackAction => ACTIONS.includes(v as StackAction)

/** `up` can pull images, which is unbounded in a way `down` never is. */
const TIMEOUT_MS = 5 * 60 * 1000

export type Stack = {
  name: string
  path: string
  composeFile: string
  /** running = every service up; partial = some; stopped = none. */
  status: 'running' | 'partial' | 'stopped'
  services: { name: string; container: string | null; status: string }[]
}

type PodmanContainer = {
  Names?: string[]
  Labels?: Record<string, string> | null
  State?: string
}

/**
 * Resolve a stack name to its directory, refusing anything that escapes.
 *
 * Delete removes this path recursively, so a name like `../..` would be
 * catastrophic. Not a Dockge-parity question — just the one place where being
 * careless destroys the machine.
 */
export function stackDir(config: StacksConfig, name: string): string {
  if (!config.dir) throw new Error('stacks.dir is not configured')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`invalid stack name "${name}"`)

  const root = resolve(config.dir)
  const path = resolve(join(root, name))
  if (path === root || !path.startsWith(root + sep)) throw new Error(`invalid stack path "${name}"`)
  return path
}

async function composeFileIn(dir: string): Promise<string | null> {
  for (const candidate of COMPOSE_FILES) {
    try {
      if ((await stat(join(dir, candidate))).isFile()) return candidate
    } catch {}
  }
  return null
}

/**
 * podman's own view of what is running.
 *
 * Glances cannot help here: it does not expose container labels, and the labels
 * are the only reliable link from a container back to its stack.
 */
async function podmanContainers(config: StacksConfig): Promise<PodmanContainer[]> {
  const [bin] = config.command
  const proc = Bun.spawn([bin, 'ps', '-a', '--format', 'json'], { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) return []
  try {
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function listStacks(config: StacksConfig): Promise<Stack[]> {
  if (!config.dir) return []

  const entries = await readdir(config.dir, { withFileTypes: true }).catch(() => [])
  const containers = await podmanContainers(config)

  const stacks: Stack[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let path: string
    try {
      path = stackDir(config, entry.name)
    } catch {
      continue // a directory name we would never accept as a stack
    }
    const composeFile = await composeFileIn(path)
    if (!composeFile) continue // not a stack — e.g. a bare config directory

    const mine = containers.filter((container) => {
      const labels = container.Labels ?? {}
      return (
        labels['com.docker.compose.project.working_dir'] === path ||
        labels['io.podman.compose.project'] === entry.name ||
        labels['com.docker.compose.project'] === entry.name
      )
    })

    const services = mine.map((container) => {
      const labels = container.Labels ?? {}
      return {
        name:
          labels['com.docker.compose.service'] ??
          labels['io.podman.compose.service'] ??
          container.Names?.[0] ??
          '?',
        container: container.Names?.[0] ?? null,
        status: String(container.State ?? 'unknown'),
      }
    })

    const up = services.filter((s) => s.status === 'running').length
    stacks.push({
      name: entry.name,
      path,
      composeFile,
      status: services.length === 0 || up === 0 ? 'stopped' : up === services.length ? 'running' : 'partial',
      services: services.sort((a, b) => a.name.localeCompare(b.name)),
    })
  }

  return stacks.sort((a, b) => a.name.localeCompare(b.name))
}

/** `podman compose` announces which provider it delegated to, on every run. */
function stripProviderBanner(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/Executing external compose provider/.test(line))
    .join('\n')
    .trim()
}

// ---------------------------------------------------------------- jobs
//
// `up` can pull images for minutes. A blocking request would time out on a
// phone and show nothing until it finished, so commands run as a job whose
// output is buffered and streamed. The job outlives the socket: walking out of
// range mid-pull must not kill the pull.

export type Job = {
  name: string
  action: StackAction
  output: string[]
  done: boolean
  code: number | null
  startedAt: number
}

const jobs = new Map<string, Job>()
const listeners = new Map<string, Set<(job: Job, chunk: string | null) => void>>()

/** Enough to see what happened, bounded so a chatty pull cannot grow forever. */
const MAX_LINES = 2000

export const getJob = (name: string): Job | undefined => jobs.get(name)

export function subscribe(name: string, fn: (job: Job, chunk: string | null) => void) {
  const set = listeners.get(name) ?? new Set()
  set.add(fn)
  listeners.set(name, set)
  return () => set.delete(fn)
}

function emit(job: Job, chunk: string | null) {
  for (const fn of listeners.get(job.name) ?? []) {
    try {
      fn(job, chunk)
    } catch {}
  }
}

function append(job: Job, text: string) {
  const clean = stripProviderBanner(text)
  if (!clean) return
  for (const line of clean.split('\n')) {
    job.output.push(line)
  }
  if (job.output.length > MAX_LINES) job.output.splice(0, job.output.length - MAX_LINES)
  emit(job, clean)
}

/** Line-buffered so the provider banner is matched against whole lines. */
async function pump(stream: ReadableStream<Uint8Array> | null, job: Job) {
  if (!stream) return
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of stream as any) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    if (lines.length) append(job, lines.join('\n'))
  }
  if (buffer.trim()) append(job, buffer)
}

export async function startStackAction(
  config: StacksConfig,
  name: string,
  action: StackAction,
): Promise<Job> {
  const existing = jobs.get(name)
  if (existing && !existing.done) throw new Error(`${name} is already running ${existing.action}`)

  const stacks = await listStacks(config)
  if (!stacks.some((entry) => entry.name === name)) throw new Error(`no stack named "${name}"`)
  const path = stackDir(config, name)

  // `podman compose`, not podman-compose directly — the same command you would
  // run by hand, so the behaviour is the same too.
  const args = action === 'up' ? ['up', '-d'] : [action]
  const proc = Bun.spawn([...config.command, ...args], {
    cwd: path,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  const job: Job = { name, action, output: [], done: false, code: null, startedAt: Date.now() }
  jobs.set(name, job)

  const timer = setTimeout(() => {
    try {
      proc.kill()
    } catch {}
  }, TIMEOUT_MS)

  ;(async () => {
    await Promise.all([pump(proc.stdout as any, job), pump(proc.stderr as any, job)])
    job.code = await proc.exited
    job.done = true
    clearTimeout(timer)
    if (job.output.length === 0) job.output.push(`${action} complete`)
    emit(job, null)
  })()

  return job
}

// ---------------------------------------------------------------- files

export async function readStackFiles(config: StacksConfig, name: string) {
  const path = stackDir(config, name)
  const composeFile = (await composeFileIn(path)) ?? 'compose.yaml'
  const compose = await readFile(join(path, composeFile), 'utf8').catch(() => '')
  const env = await readFile(join(path, '.env'), 'utf8').catch(() => '')
  return { name, composeFile, compose, env }
}

/**
 * Check a compose file before committing it, by asking compose itself.
 *
 * Better than a YAML parse: this catches malformed YAML *and* invalid compose,
 * and it needs no dependency — the server still imports nothing but Bun
 * built-ins. Validation runs against a throwaway copy so a bad edit never
 * reaches the real directory.
 */
async function validate(config: StacksConfig, composeFile: string, compose: string, env: string) {
  const scratch = join(tmpdir(), `tools-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(scratch, { recursive: true })
  try {
    await writeFile(join(scratch, composeFile), compose, 'utf8')
    if (env) await writeFile(join(scratch, '.env'), env, 'utf8')

    const proc = Bun.spawn([...config.command, 'config'], {
      cwd: scratch,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    if ((await proc.exited) !== 0) {
      throw new Error(stripProviderBanner(`${err}${out}`) || 'compose rejected this file')
    }
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

export async function writeStackFiles(
  config: StacksConfig,
  name: string,
  compose: string,
  env: string,
) {
  const path = stackDir(config, name)
  const composeFile = (await composeFileIn(path)) ?? 'compose.yaml'

  await validate(config, composeFile, compose, env)

  // Keep the previous version alongside; compose ignores a .bak.
  await cp(join(path, composeFile), join(path, `${composeFile}.bak`), { force: true }).catch(() => {})
  await writeFile(join(path, composeFile), compose, 'utf8')

  if (env) {
    await cp(join(path, '.env'), join(path, '.env.bak'), { force: true }).catch(() => {})
    await writeFile(join(path, '.env'), env, 'utf8')
  }

  return { name, composeFile }
}

export async function createStack(
  config: StacksConfig,
  name: string,
  compose: string,
  env: string,
) {
  const path = stackDir(config, name)
  if (await stat(path).catch(() => null)) throw new Error(`"${name}" already exists`)

  await validate(config, 'compose.yaml', compose, env)

  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'compose.yaml'), compose, 'utf8')
  // Dockge always leaves a .env beside the compose file, so match that.
  await writeFile(join(path, '.env'), env, 'utf8')
  return { name, path }
}

/**
 * Remove a stack completely — containers, named volumes and the directory.
 *
 * Deliberately total: inactive stacks are kept by stopping them, so anything
 * being deleted is meant to be gone.
 */
export async function deleteStack(config: StacksConfig, name: string) {
  const path = stackDir(config, name)
  if (!(await stat(path).catch(() => null))) throw new Error(`no stack named "${name}"`)

  const proc = Bun.spawn([...config.command, 'down', '-v'], {
    cwd: path,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited // a stack that was never up exits non-zero; removal proceeds

  await rm(path, { recursive: true, force: true })
  jobs.delete(name)
  return { name, output: stripProviderBanner(`${out}${err}`) || 'removed' }
}
