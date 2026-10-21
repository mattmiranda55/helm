/**
 * First-run setup, and the Settings editors that reuse it afterwards.
 *
 * A fresh install has no config file. Rather than make you hand-edit JSON on
 * the box, the server comes up unconfigured and the app walks you through it:
 * which servers to watch (each one's Glances URL, tested from here), which apps
 * to pin, which commands the terminal offers, and whether to require a token.
 * The answers are written to the same config file you could have edited by
 * hand, and loaded in-process — no restart.
 *
 * The setup endpoints write a config, and during setup there is no token yet,
 * so they are gated by a one-time code instead: generated on first start,
 * printed by install.sh and in the service log, and kept in a `setup-code`
 * file (mode 600) next to the config so it survives restarts. Anyone who can
 * read that file can already write the config directory, so it grants nothing
 * new. Wrong
 * codes are rate-limited; the file is deleted once setup completes, and every
 * setup endpoint answers 409 from then on.
 *
 * Afterwards the same probes and the config editor live under /api/admin,
 * behind the normal token. Edits replace only nodes, services and commands,
 * plus stacks.dir / command / template / envTemplate; every other key in the
 * file — alerts, the rest of stacks, terminal, anything unknown — is written
 * back exactly as it was.
 */

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  buildConfig,
  ConfigError,
  configWriteTarget,
  nodesFromEnv,
  normalizeCommand,
  normalizeNode,
  normalizeService,
  readRawConfig,
  type Config,
} from './config'
import { listLocalContainers } from './containers'
import { parseGlancesUrl, probeGlances } from './glances'
import {
  DEFAULT_ENV_TEMPLATE,
  DEFAULT_STACK_TEMPLATE,
  defaultComposeCommand,
  findStackDirs,
  normalizeTemplate,
} from './stacks'

type Handler = (req: Request) => Response | Promise<Response>
type Wrap = (handler: Handler) => Handler

export type SetupContext = {
  /** The live config object; reload() updates it in place. */
  config: Config
  /** False until a config file exists (or HELM_NODES is set). */
  state: { configured: boolean }
  /** Re-read the config from disk into `config`. */
  reload: () => Promise<void>
  cors: Wrap
  guard: Wrap
  originAllowed: (req: Request) => boolean
  authorized: (req: Request) => boolean
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

const fail = (message: string, status = 500, headers?: Record<string, string>) =>
  json({ error: message }, status, headers)

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

/** Config edits are a few KB; anything near this is not one. */
const MAX_BODY_BYTES = 256 * 1024

const LOCAL_GLANCES = 'http://127.0.0.1:61208'

// ---------------------------------------------------------------- setup code

/** No 0/O, 1/I/L: it gets read off a terminal and typed on a phone. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`)

const MAX_FAILURES = 10
const FAILURE_WINDOW_MS = 10 * 60_000

let setupCode: string | null = null
let setupCodePath: string | null = null
const failures: number[] = []

/** "abcd-efgh", "ABCD EFGH" and "ABCDEFGH" are all the same code. */
const canonicalCode = (value: string) => value.toUpperCase().replace(/[\s-]+/g, '')
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

function generateCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

/**
 * The code for this unconfigured instance: reused from the `setup-code` file
 * if one is there (so the code install.sh printed stays valid across
 * restarts), otherwise generated and saved. A file that cannot be written
 * still leaves a working code — it is printed in the log either way.
 */
export async function prepareSetupCode(
  configTarget: string,
): Promise<{ code: string; path: string; saved: boolean }> {
  const path = join(dirname(resolve(configTarget)), 'setup-code')
  setupCodePath = path

  try {
    const existing = canonicalCode((await readFile(path, 'utf8')).trim())
    if (CODE_PATTERN.test(existing)) {
      setupCode = existing
      return { code: formatCode(existing), path, saved: true }
    }
  } catch {}

  setupCode = generateCode()
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, `${formatCode(setupCode)}\n`, { mode: 0o600 })
    await chmod(path, 0o600)
    return { code: formatCode(setupCode), path, saved: true }
  } catch (error) {
    console.warn(`[setup] could not write ${path}: ${(error as Error).message}`)
    return { code: formatCode(setupCode), path, saved: false }
  }
}

async function clearSetupCode() {
  setupCode = null
  if (setupCodePath) await unlink(setupCodePath).catch(() => {})
}

/** Constant-time, so response timing says nothing about how close a guess was. */
function codeMatches(presented: string): boolean {
  if (!setupCode) return false
  const expected = Buffer.from(setupCode)
  const actual = Buffer.from(canonicalCode(presented))
  if (actual.length !== expected.length) {
    timingSafeEqual(expected, expected)
    return false
  }
  return timingSafeEqual(actual, expected)
}

/** 429 once there have been too many wrong codes lately, 403 for a wrong one. */
function refuseCode(req: Request): Response | null {
  const now = Date.now()
  while (failures.length && now - failures[0] > FAILURE_WINDOW_MS) failures.shift()
  if (failures.length >= MAX_FAILURES) {
    const retry = Math.ceil((failures[0] + FAILURE_WINDOW_MS - now) / 1000)
    return fail('too many wrong setup codes — wait a few minutes and try again', 429, {
      'Retry-After': String(Math.max(retry, 1)),
    })
  }
  const presented = req.headers.get('x-helm-setup-code')
  if (!presented) return fail('setup code required', 403)
  if (codeMatches(presented)) return null
  failures.push(now)
  console.warn(`[setup] wrong setup code (${failures.length}/${MAX_FAILURES} in 10 minutes)`)
  return fail('wrong setup code', 403)
}

// ---------------------------------------------------------------- editable config

type PasswordChange = { keep: true } | { keep: false; value: string | null }
type NodeEdit = { file: Record<string, unknown>; password: PasswordChange }
type Edits = {
  nodes?: NodeEdit[]
  services?: Record<string, unknown>[]
  commands?: Record<string, unknown>[]
  /** Only the stacks keys that were sent; merged over the file's stacks. */
  stacks?: Record<string, unknown>
}

const text = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value).trim()

/** Drop undefined, so the file only holds what was actually set. */
const compact = (entry: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined))

function list(body: any, key: string, required: boolean): any[] | undefined {
  const value = body?.[key]
  if (value === undefined && !required) return undefined
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ConfigError(`"${key}" must be a list`)
  return value
}

function parseNode(input: any, index: number): NodeEdit {
  if (!input || typeof input !== 'object') throw new ConfigError(`Server ${index + 1} is not an object`)
  const label = text(input.label)
  const who = label ? `Server "${label}"` : `Server ${index + 1}`

  const url = parseGlancesUrl(input.url)
  if ('error' in url) throw new ConfigError(`${who}: ${url.error}`)

  const api = input.api === undefined || input.api === null || input.api === '' ? 4 : Number(input.api)
  if (api !== 3 && api !== 4) throw new ConfigError(`${who}: the Glances API version must be 3 or 4`)

  const id = text(input.id) || label
  let node
  try {
    node = normalizeNode({ id: id || undefined, label: label || undefined, url: url.base, api }, index)
  } catch {
    throw new ConfigError(`${who} needs an id made of letters or numbers`)
  }

  const username = text(input.username)
  const password: PasswordChange =
    input.password === undefined
      ? { keep: true }
      : { keep: false, value: input.password === null || input.password === '' ? null : String(input.password) }

  return {
    file: compact({
      id: node.id,
      label: node.label,
      url: node.url,
      api,
      local: typeof input.local === 'boolean' ? input.local : undefined,
      username: username || undefined,
    }),
    password,
  }
}

function parseService(input: any, index: number): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new ConfigError(`App ${index + 1} is not an object`)
  const name = text(input.name)
  const url = text(input.url)
  if (!url) throw new ConfigError(`${name ? `App "${name}"` : `App ${index + 1}`} needs a URL`)
  const service = normalizeService(
    {
      group: text(input.group) || undefined,
      name: name || undefined,
      url,
      description: text(input.description) || undefined,
      container: text(input.container) || undefined,
      node: text(input.node) || undefined,
      icon: text(input.icon) || undefined,
      favorite: input.favorite === true,
    },
    index,
  )
  return compact({
    group: text(input.group) ? service.group : undefined,
    name: service.name,
    url: service.url,
    description: service.description || undefined,
    container: service.container,
    node: service.node,
    icon: service.icon,
    favorite: service.favorite || undefined,
  })
}

function parseCommand(input: any, index: number): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new ConfigError(`Command ${index + 1} is not an object`)
  const name = text(input.name)
  if (!text(input.command)) {
    throw new ConfigError(`${name ? `Command "${name}"` : `Command ${index + 1}`} needs something to run`)
  }
  // The command itself keeps its inner whitespace: it is typed into a shell.
  const command = normalizeCommand(
    { name: name || undefined, description: text(input.description), command: String(input.command) },
    index,
  )
  return compact({
    name: command.name,
    description: command.description || undefined,
    command: command.command,
  })
}

// ---------------------------------------------------------------- stacks

/** Per template; a compose file this size is already not a starting point. */
const MAX_TEMPLATE_BYTES = 64 * 1024
const MAX_COMMAND_PARTS = 8

/**
 * Directories that can never be the stacks dir. Stack delete removes a
 * subdirectory recursively, so pointing this at, say, / or $HOME would make
 * every folder in it one DELETE away from gone.
 */
function forbiddenStackDirs(): Set<string> {
  const system = ['/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/opt', '/proc',
    '/root', '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var', '/private', '/System',
    '/Users', '/Library', '/Applications', '/Volumes']
  const home = process.env.HOME ? [resolve(process.env.HOME)] : []
  return new Set([...system, ...home])
}

/** The built-in stack defaults for this machine. */
export function stackDefaults(containersCommand: string | null) {
  return {
    template: DEFAULT_STACK_TEMPLATE,
    envTemplate: DEFAULT_ENV_TEMPLATE,
    command: defaultComposeCommand(containersCommand),
  }
}

async function parseStackDir(value: unknown): Promise<string | null> {
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new ConfigError('The stacks directory must be a path, or empty for none')
  const raw = value.trim()
  if (!raw) return null
  if (raw.includes('\0') || raw.length > 4096) throw new ConfigError('The stacks directory is not a valid path')
  if (!isAbsolute(raw)) {
    throw new ConfigError(`The stacks directory must be an absolute path (starting with /), got "${raw}"`)
  }
  const dir = resolve(raw)
  if (forbiddenStackDirs().has(dir)) {
    throw new ConfigError(
      `${dir} can't be the stacks directory — use a folder made for stacks, like /opt/stacks`,
    )
  }
  const info = await stat(dir).catch(() => null)
  if (!info) throw new ConfigError(`The stacks directory ${dir} doesn't exist on this server — create it first`)
  if (!info.isDirectory()) throw new ConfigError(`${dir} is not a directory`)
  return dir
}

function parseStackCommand(value: unknown, fallback: string[]): string[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError('The compose command must be a non-empty list, e.g. ["docker", "compose"]')
  }
  if (value.length > MAX_COMMAND_PARTS) {
    throw new ConfigError(`The compose command can have at most ${MAX_COMMAND_PARTS} parts`)
  }
  const parts = value.map((part) => (typeof part === 'string' ? part.trim() : ''))
  if (parts.some((part) => !part || part.includes('\0') || part.length > 1024)) {
    throw new ConfigError('Every part of the compose command must be non-empty text')
  }
  // Equal to what this machine would pick anyway → store null, so it keeps
  // following the detected engine.
  const same = parts.length === fallback.length && parts.every((part, i) => part === fallback[i])
  return same ? null : parts
}

function parseTemplate(value: unknown, label: string, fallback: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new ConfigError(`The ${label} must be text`)
  if (Buffer.byteLength(value, 'utf8') > MAX_TEMPLATE_BYTES) {
    throw new ConfigError(`The ${label} is over ${MAX_TEMPLATE_BYTES / 1024} KB`)
  }
  // Unchanged from the built-in default → null, so a later, better default
  // still reaches it.
  return normalizeTemplate(value) === normalizeTemplate(fallback) ? null : value
}

/**
 * `stacks` from the browser → only the keys that were sent, file-ready.
 * An absent key is left as it is in the file.
 */
async function parseStacks(input: unknown, containersCommand: string | null) {
  if (input === undefined) return undefined
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigError('"stacks" must be an object: { dir, command, template, envTemplate }')
  }
  const body = input as Record<string, unknown>
  const defaults = stackDefaults(containersCommand)
  const patch: Record<string, unknown> = {}
  if ('dir' in body) patch.dir = await parseStackDir(body.dir)
  if ('command' in body) patch.command = parseStackCommand(body.command, defaults.command)
  if ('template' in body) {
    let template = parseTemplate(body.template, 'stack template', defaults.template)
    // An empty compose template is no template: fall back to the default.
    if (template !== null && !template.trim()) template = null
    patch.template = template
  }
  if ('envTemplate' in body) patch.envTemplate = parseTemplate(body.envTemplate, '.env template', defaults.envTemplate)
  return patch
}

/**
 * EditableConfig from the browser → file-ready entries. With `partial`, a
 * missing list means "leave it alone" (Settings); otherwise it means empty.
 * A missing `stacks` always means "leave it alone" — at setup, the defaults.
 */
async function parseEdits(body: any, partial: boolean, containersCommand: string | null): Promise<Edits> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConfigError('expected { nodes, services, commands, stacks }')
  }
  const nodes = list(body, 'nodes', !partial)?.map(parseNode)
  const services = list(body, 'services', !partial)?.map(parseService)
  const commands = list(body, 'commands', !partial)?.map(parseCommand)
  const stacks = await parseStacks(body.stacks, containersCommand)

  const seen = new Set<string>()
  for (const node of nodes ?? []) {
    const id = String(node.file.id)
    if (seen.has(id)) throw new ConfigError(`Two servers have the id "${id}" — each needs its own`)
    seen.add(id)
  }
  return { nodes, services, commands, stacks }
}

/** The id a raw file entry resolves to, or null if it does not parse. */
function rawNodeId(raw: any, index: number): string | null {
  try {
    return normalizeNode(raw, index).id
  } catch {
    return null
  }
}

/**
 * Apply edits to the raw file contents. Keys are replaced in place so the
 * file's order survives; unknown per-node keys (timeoutMs, say) are kept for
 * a node whose id is unchanged, and so is its password unless one was sent.
 */
function applyEdits(raw: any, edits: Edits, { keepNodes }: { keepNodes: boolean }) {
  const next: Record<string, unknown> = { ...raw }

  if (edits.nodes && !keepNodes) {
    const previous = new Map<string, any>()
    ;(Array.isArray(raw.nodes) ? raw.nodes : []).forEach((entry: any, index: number) => {
      const id = rawNodeId(entry, index)
      if (id && entry && typeof entry === 'object') previous.set(id, entry)
    })
    next.nodes = edits.nodes.map(({ file, password }) => {
      const old = previous.get(String(file.id))
      const { id, label, url, api, local, username, password: oldPassword, name, ...extra } = old ?? {}
      const entry: Record<string, unknown> = { ...file, ...extra }
      const value = password.keep ? (old ? oldPassword : undefined) : password.value
      if (value) entry.password = String(value)
      return compact(entry)
    })
  }
  if (edits.services) next.services = edits.services
  if (edits.commands) next.commands = edits.commands
  if (edits.stacks) {
    // enabled, and anything else in there, survive untouched.
    const old = raw.stacks && typeof raw.stacks === 'object' && !Array.isArray(raw.stacks) ? raw.stacks : {}
    next.stacks = { ...old, ...edits.stacks }
  }
  return next
}

/** The editable part of the live config. Passwords never leave the server. */
function toEditable(config: Config) {
  return {
    nodes: config.nodes.map((node) =>
      compact({
        id: node.id,
        label: node.label,
        url: node.url,
        api: node.api,
        local: node.local,
        username: node.username,
        hasPassword: !!node.password,
      }),
    ),
    services: config.services.map((service) =>
      compact({ ...service, favorite: service.favorite === true }),
    ),
    commands: config.commands.map((command) => ({ ...command })),
    /** Servers come from HELM_NODES; node edits are refused. */
    nodesFromEnv: nodesFromEnv(),
    /**
     * Templates are null when never customised (the built-in default applies),
     * so the UI can tell untouched from edited. command is always the one in
     * effect.
     */
    stacks: {
      dir: config.stacks.dir,
      command: [...config.stacks.command],
      template: config.stacks.template,
      envTemplate: config.stacks.envTemplate,
    },
    stackDefaults: stackDefaults(config.containers.command),
  }
}

/** Did a Settings save change the env-managed nodes? */
function nodesDiffer(edits: NodeEdit[], live: Config['nodes']): boolean {
  if (edits.length !== live.length) return true
  return edits.some(({ file, password }, index) => {
    const node = live[index]
    return (
      file.id !== node.id ||
      file.label !== node.label ||
      file.url !== node.url ||
      file.api !== node.api ||
      file.local !== node.local ||
      (file.username ?? undefined) !== node.username ||
      (!password.keep && !!password.value)
    )
  })
}

// ---------------------------------------------------------------- writing

/**
 * Atomic: a temp file in the same directory, then rename, so a crash or a full
 * disk never leaves half a config. Mode 600 — it can hold a token and Glances
 * passwords.
 *
 * An install from before setup existed has a root-owned /etc/helm that the
 * service cannot create files in, only rewrite its own config.json. Rather
 * than fail every save until install.sh is re-run, that case falls back to
 * rewriting the file in place.
 */
async function writeConfigFile(target: string, data: unknown): Promise<string> {
  const path = resolve(target)
  const dir = dirname(path)
  const body = `${JSON.stringify(data, null, 2)}\n`
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
  let handle
  try {
    handle = await open(tmp, 'wx', 0o600)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EACCES' && code !== 'EPERM') throw error
    try {
      // Rewriting an existing file needs only write access to it, not the dir.
      if (!(await Bun.file(path).exists())) throw error
      await writeFile(path, body, { flag: 'w' })
      await chmod(path, 0o600)
      console.warn(`[setup] ${dir} is not writable — rewrote ${path} in place (re-run install.sh to fix)`)
      return path
    } catch {
      throw new Error(
        `can't write ${path} — permission denied. Re-run "sudo ./install.sh" so helm owns ${dir}.`,
      )
    }
  }
  try {
    await handle.writeFile(body)
    await handle.sync()
    await handle.close()
    handle = undefined
    await chmod(tmp, 0o600)
    await rename(tmp, path)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(tmp, { force: true })
    throw error
  }
  return path
}

/** One write at a time: two saves racing would each drop the other's edits. */
let writing: Promise<unknown> = Promise.resolve()
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = writing.then(task, task)
  writing = run.catch(() => {})
  return run
}

async function readBody(req: Request): Promise<any | Response> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return fail('request too large', 413)
  const body = await req.text()
  if (body.length > MAX_BODY_BYTES) return fail('request too large', 413)
  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch {
    return fail('request body must be JSON', 400)
  }
}

/** Validate the would-be file exactly as a startup would, then write and load it. */
async function save(ctx: SetupContext, next: Record<string, unknown>, loadedPath: string | null) {
  await buildConfig(next, { quiet: true })
  const path = await writeConfigFile(configWriteTarget(loadedPath), next)
  await ctx.reload()
  return path
}

// ---------------------------------------------------------------- probes

async function local(ctx: SetupContext) {
  const [glances, found, stackDirs] = await Promise.all([
    probeGlances({ url: LOCAL_GLANCES }),
    listLocalContainers(ctx.config.containers.command),
    findStackDirs(),
  ])
  return {
    hostname: hostname(),
    engine: found.engine,
    glances,
    containers: found.containers,
    stackDefaults: stackDefaults(ctx.config.containers.command),
    stackDirs,
  }
}

async function probe(req: Request) {
  const body = await readBody(req)
  if (body instanceof Response) return body
  return json(await probeGlances(body ?? {}))
}

// ---------------------------------------------------------------- routes

export function setupRoutes(ctx: SetupContext): Record<string, Handler> {
  /**
   * Setup endpoints: only while unconfigured, same origin rules as every other
   * mutation, the token too if HELM_TOKEN happens to set one — and the code.
   */
  const setup = (methods: string[], handler: Handler): Handler =>
    ctx.cors(async (req) => {
      if (ctx.state.configured) return fail('helm is already set up', 409)
      if (!methods.includes(req.method)) return fail(`use ${methods.join(' or ')}`, 405)
      if (MUTATING.has(req.method) && !ctx.originAllowed(req)) return fail('origin not allowed', 403)
      if (!ctx.authorized(req)) return fail('unauthorized', 401)
      return refuseCode(req) ?? handler(req)
    })

  /**
   * Settings: the normal token. Refused until setup is done — with no token
   * yet, this would otherwise be a way to write the first config without the
   * setup code.
   */
  const admin = (methods: string[], handler: Handler): Handler =>
    ctx.guard(async (req) => {
      if (!ctx.state.configured) return fail('helm is not set up yet — finish setup first', 409)
      if (!methods.includes(req.method)) return fail(`use ${methods.join(' or ')}`, 405)
      return handler(req)
    })

  const handleConfigError = (error: unknown) =>
    error instanceof ConfigError
      ? fail(error.message, 400)
      : fail((error as Error).message ?? 'could not save the config', 500)

  return {
    '/api/setup/verify': setup(['POST'], () => json({ ok: true })),

    '/api/setup/local': setup(['GET'], async () => json(await local(ctx))),

    '/api/setup/probe': setup(['POST'], probe),

    '/api/setup': setup(['POST'], async (req) => {
      const body = await readBody(req)
      if (body instanceof Response) return body
      const choice = body?.token ?? null
      if (choice !== null && choice !== 'generate') {
        return fail('"token" must be "generate" or null', 400)
      }
      if (choice === 'generate' && process.env.HELM_TOKEN) {
        return fail('the access token is already set by HELM_TOKEN on this server — choose no token here', 400)
      }
      try {
        const edits = await parseEdits(body?.config, false, ctx.config.containers.command)
        return await exclusive(async () => {
          if (ctx.state.configured) return fail('helm is already set up', 409)
          const { raw, path } = await readRawConfig()
          const next = applyEdits(raw, edits, { keepNodes: false })
          const token = choice === 'generate' ? randomBytes(32).toString('base64url') : null
          if (token) next.auth = { ...((raw.auth as object) ?? {}), token }
          const written = await save(ctx, next, path)
          await clearSetupCode()
          console.log(`[setup] done — wrote ${written}${token ? ' (access token set)' : ''}`)
          return json({ ok: true, token })
        })
      } catch (error) {
        return handleConfigError(error)
      }
    }),

    // Anything else under /api/setup: gone once set up, unknown before.
    '/api/setup/*': ctx.cors((req) =>
      ctx.state.configured
        ? fail('helm is already set up', 409)
        : fail(`no such endpoint: ${new URL(req.url).pathname}`, 404),
    ),

    '/api/admin/config': admin(['GET', 'PUT'], async (req) => {
      if (req.method === 'GET') return json(toEditable(ctx.config))
      const body = await readBody(req)
      if (body instanceof Response) return body
      try {
        const edits = await parseEdits(body, true, ctx.config.containers.command)
        const envNodes = nodesFromEnv()
        if (envNodes && edits.nodes && nodesDiffer(edits.nodes, ctx.config.nodes)) {
          return fail(
            'servers are set by HELM_NODES on this server — change them there, not in Settings',
            409,
          )
        }
        return await exclusive(async () => {
          const { raw, path } = await readRawConfig()
          const next = applyEdits(raw, edits, { keepNodes: envNodes })
          const written = await save(ctx, next, path)
          console.log(`[settings] saved ${written}`)
          return json({ ok: true })
        })
      } catch (error) {
        return handleConfigError(error)
      }
    }),

    '/api/admin/local': admin(['GET'], async () => json(await local(ctx))),

    '/api/admin/probe': admin(['POST'], probe),
  }
}
