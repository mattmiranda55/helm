/**
 * Configuration loading + validation.
 *
 * Resolution order (first hit wins):
 *   1. $HELM_CONFIG                     — explicit path, and then the only one
 *   2. ./config.json                     — local dev, gitignored
 *   3. ~/.config/helm/config.json         — per-user
 *   4. /etc/helm/config.json              — installed service
 * Individual fields can be overridden by env vars (see below), which is what
 * the systemd unit uses so an install can be re-pointed without editing JSON.
 *
 * When none of these exist (and HELM_NODES is unset) helm is unconfigured and
 * serves the first-run setup, which writes the file — see server/setup.ts.
 */

import { defaultComposeCommand } from './stacks'

export type NodeConfig = {
  /** URL-safe identifier, unique across nodes. */
  id: string
  /** Human label shown in the picker. */
  label: string
  /** Base URL of the Glances web server, e.g. http://your-server:61208 */
  url: string
  /** Glances REST API version. 4.x servers use 4; older ones use 3. */
  api: number
  /** Optional HTTP basic auth, if Glances was started with --password. */
  username?: string
  password?: string
  /** Per-request timeout when talking to this node. */
  timeoutMs: number
  /**
   * Whether this node is the machine the server runs on, which is what makes
   * container actions possible. Detected from the hostname when omitted.
   */
  local?: boolean
}

export type ServiceConfig = {
  /** Heading the card is filed under, e.g. "Media". */
  group: string
  name: string
  url: string
  description: string
  /**
   * Container name to read status from. When it matches a container on the
   * node currently being viewed, the card shows live state — no extra request,
   * since the container list is already on screen.
   */
  container?: string
  /**
   * Node this service runs on. Container status is resolved only while that
   * node is the one being viewed — otherwise a service on another machine
   * would read as "not running" simply because you are looking elsewhere.
   */
  node?: string
  /**
   * A dashboard-icons slug ("jellyfin", "pi-hole"), served and cached by
   * /api/icons. Defaults to the name as a slug, so most apps need nothing here.
   * One or two characters are used as the tile's initials instead.
   */
  icon?: string
  /** Pinned to the top of the Machines page. */
  favorite?: boolean
}

export type AlertConfig = {
  enabled: boolean
  /** ntfy server base URL, e.g. https://ntfy.example.com */
  url: string | null
  topic: string
  /** ntfy access token, if the topic is protected. */
  token: string | null
  /**
   * Read the token from this file instead of inlining it.
   *
   * Lets the dashboard and scripts/git-check share one copy of the secret, and
   * keeps it out of a config file that is easy to cat or paste. `token` wins if
   * both are set.
   */
  tokenFile: string | null
  /** Where tapping the notification should take you. */
  clickUrl: string | null
  /** How often to evaluate. Deliberately far slower than the dashboard. */
  intervalMs: number
  /** Consecutive checks a condition must hold before it fires. */
  sustain: number
  /** Re-notify about a still-firing condition after this long. */
  repeatMs: number
  notifyRecovery: boolean
  /**
   * null disables a rule; numbers are thresholds.
   *
   * The utilisation rules default to OFF on purpose. A homelab spikes CPU,
   * memory and disk all day long — backups, transcodes, library scans — and an
   * alert you learn to swipe away is worse than no alert. What ships enabled is
   * the set you would actually get up and fix.
   */
  rules: {
    cpu: number | null
    mem: number | null
    swap: number | null
    loadPerCore: number | null
    fs: number | null
    /** Fire at the hardware's own critical point, not its warning point. */
    temperature: boolean
    /** Crash-looping or dead — NOT a container you stopped yourself. */
    containerCrashed: boolean
    nodeDown: boolean
  }
}

export type StacksConfig = {
  enabled: boolean
  /** Directory of compose stacks — the same one Dockge is pointed at. */
  dir: string | null
  /**
   * Split command, always resolved. null/absent in the file means the default:
   * `podman compose` or `docker compose`, whichever engine this machine has
   * (see defaultComposeCommand in server/stacks.ts).
   */
  command: string[]
  /**
   * Starting point for a new stack. `{{name}}` is replaced with the stack name
   * as it is typed. null = the built-in DEFAULT_STACK_TEMPLATE
   * (server/stacks.ts) — kept null here so callers can tell "never customised".
   */
  template: string | null
  /** Starting point for the new stack's .env. `{{name}}` works here too. null = built-in default. */
  envTemplate: string | null
}

export type CommandConfig = {
  name: string
  description: string
  /** Text typed into the PTY. A trailing \n (added on run) executes it. */
  command: string
}

export type Config = {
  server: {
    host: string
    port: number
    /**
     * Browser origins, besides this server's own, allowed to call the API
     * cross-origin and open its WebSockets. Exact origins only — never "*".
     * Empty by default: the app is served by this server, so it is same-origin.
     */
    allowedOrigins: string[]
  }
  /** When set, every API + WebSocket request must present this token. */
  auth: { token: string | null }
  terminal: {
    enabled: boolean
    /** Defaults to $SHELL, then bash, then sh. */
    shell: string | null
    args: string[]
    cwd: string | null
  }
  alerts: AlertConfig
  stacks: StacksConfig
  /** Container control. Disable to make the dashboard strictly read-only. */
  containers: { enabled: boolean; command: string | null }
  /** Dashboard poll interval, milliseconds. Also the freshness floor the
   *  Glances client uses to collapse multiple viewers into one fetch. */
  refreshMs: number
  nodes: NodeConfig[]
  commands: CommandConfig[]
  services: ServiceConfig[]
}

/**
 * Where config is looked for, first hit wins. Read once at startup.
 *
 * $HELM_CONFIG, when set, is the ONLY place looked: it is also where setup and
 * Settings write (configWriteTarget), so falling through to another file while
 * it doesn't exist yet would read one config and write a different one — and
 * hide first-run setup behind, say, a stray ~/.config/helm/config.json.
 */
export const CONFIG_PATHS = process.env.HELM_CONFIG
  ? [process.env.HELM_CONFIG]
  : ['./config.json', `${process.env.HOME ?? ''}/.config/helm/config.json`, '/etc/helm/config.json']

const DEFAULTS: Config = {
  server: { host: '127.0.0.1', port: 3001, allowedOrigins: [] },
  auth: { token: null },
  terminal: { enabled: true, shell: null, args: [], cwd: null },
  alerts: {
    enabled: false,
    url: null,
    topic: 'helm-alerts',
    token: null,
    tokenFile: null,
    clickUrl: null,
    intervalMs: 60_000,
    // Three consecutive checks ≈ three minutes: long enough that a reboot or a
    // container restart finishes without paging anyone.
    sustain: 3,
    repeatMs: 6 * 60 * 60 * 1000,
    notifyRecovery: true,
    rules: {
      cpu: null,
      mem: null,
      swap: null,
      loadPerCore: null,
      // Slow-moving and genuinely actionable — a disk does not spike to 90%.
      fs: 90,
      temperature: true,
      containerCrashed: true,
      nodeDown: true,
    },
  },
  stacks: {
    enabled: true,
    dir: null,
    // Resolved per machine in buildConfig; null/absent in the file = detected.
    command: ['podman', 'compose'],
    template: null,
    envTemplate: null,
  },
  containers: { enabled: true, command: null },
  refreshMs: 5000,
  nodes: [],
  commands: [],
  services: [],
}

export class ConfigError extends Error {}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function normalizeNode(raw: any, index: number): NodeConfig {
  if (!raw || typeof raw !== 'object') {
    throw new ConfigError(`nodes[${index}] must be an object`)
  }
  const url = String(raw.url ?? '').trim().replace(/\/+$/, '')
  if (!url) throw new ConfigError(`nodes[${index}] is missing "url"`)
  try {
    new URL(url)
  } catch {
    throw new ConfigError(`nodes[${index}].url is not a valid URL: ${url}`)
  }

  const label = String(raw.label ?? raw.name ?? new URL(url).hostname)
  const id = slug(String(raw.id ?? label))
  if (!id) throw new ConfigError(`nodes[${index}] resolved to an empty id`)

  return {
    id,
    label,
    url,
    api: Number(raw.api ?? 4),
    username: raw.username ? String(raw.username) : undefined,
    password: raw.password ? String(raw.password) : undefined,
    timeoutMs: Number(raw.timeoutMs ?? 5000),
    local: typeof raw.local === 'boolean' ? raw.local : undefined,
  }
}

/**
 * "scheme://host[:port]", lowercased, exactly as a browser sends it in the
 * Origin header. Wildcards and the opaque "null" origin are refused outright:
 * the terminal is a full shell, so this list must name real origins.
 */
function normalizeOrigin(raw: unknown, index: number): string {
  const value = String(raw ?? '').trim().replace(/\/+$/, '').toLowerCase()
  const fail = () =>
    new ConfigError(`server.allowedOrigins[${index}] must be an exact origin like https://dash.example.ts.net, got "${raw}"`)
  if (!value || value === 'null' || value.includes('*')) throw fail()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw fail()
  }
  // URL.origin is "null" for custom schemes, so rebuild it by hand.
  const origin = `${url.protocol}//${url.host}`
  if (!url.host || origin !== value) throw fail()
  return origin
}

export function normalizeCommand(raw: any, index: number): CommandConfig {
  if (!raw || typeof raw !== 'object') {
    throw new ConfigError(`commands[${index}] must be an object`)
  }
  const command = String(raw.command ?? '').trim()
  if (!command) throw new ConfigError(`commands[${index}] is missing "command"`)
  return {
    name: String(raw.name ?? command),
    description: String(raw.description ?? ''),
    command,
  }
}

export function normalizeService(raw: any, index: number): ServiceConfig {
  if (!raw || typeof raw !== 'object') {
    throw new ConfigError(`services[${index}] must be an object`)
  }
  const url = String(raw.url ?? raw.href ?? '').trim()
  if (!url) throw new ConfigError(`services[${index}] is missing "url"`)
  return {
    group: String(raw.group ?? 'Services'),
    name: String(raw.name ?? url),
    url,
    description: String(raw.description ?? ''),
    container: raw.container ? String(raw.container) : undefined,
    node: raw.node ? slug(String(raw.node)) : undefined,
    icon: raw.icon ? String(raw.icon) : undefined,
    favorite: raw.favorite === true,
  }
}

/**
 * Null means "the built-in default" for command and both templates. The
 * command is resolved here (it is what gets spawned); the templates stay null
 * so the API can say whether they were ever customised.
 */
function normalizeStacks(config: Config, raw: any) {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new ConfigError('stacks must be an object')
  }
  const stacks = config.stacks
  const command = raw?.command
  if (command === undefined || command === null) {
    stacks.command = defaultComposeCommand(config.containers.command)
  } else if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((part) => typeof part !== 'string' || !part.trim())
  ) {
    throw new ConfigError('stacks.command must be a non-empty list of strings, e.g. ["docker", "compose"]')
  } else {
    stacks.command = command.map((part: string) => part.trim())
  }
  for (const key of ['template', 'envTemplate'] as const) {
    const value = stacks[key]
    if (value === undefined) stacks[key] = null
    else if (value !== null && typeof value !== 'string') {
      throw new ConfigError(`stacks.${key} must be a string, or null for the built-in default`)
    }
  }
  if (stacks.dir !== null && stacks.dir !== undefined && typeof stacks.dir !== 'string') {
    throw new ConfigError('stacks.dir must be a path string or null')
  }
  stacks.dir = stacks.dir ? stacks.dir : null
}

function applyEnvOverrides(config: Config): Config {
  const {
    HELM_HOST,
    HELM_PORT,
    HELM_TOKEN,
    HELM_SHELL,
    HELM_REFRESH_MS,
    HELM_NODES,
    HELM_NTFY_URL,
    HELM_NTFY_TOPIC,
    HELM_NTFY_TOKEN,
    HELM_NTFY_TOKEN_FILE,
  } = process.env

  if (HELM_HOST) config.server.host = HELM_HOST
  if (HELM_PORT) config.server.port = Number(HELM_PORT)
  if (HELM_TOKEN) config.auth.token = HELM_TOKEN
  if (HELM_SHELL) config.terminal.shell = HELM_SHELL
  if (HELM_REFRESH_MS) config.refreshMs = Number(HELM_REFRESH_MS)
  if (HELM_NTFY_URL) {
    config.alerts.url = HELM_NTFY_URL
    config.alerts.enabled = true
  }
  if (HELM_NTFY_TOPIC) config.alerts.topic = HELM_NTFY_TOPIC
  if (HELM_NTFY_TOKEN) config.alerts.token = HELM_NTFY_TOKEN
  if (HELM_NTFY_TOKEN_FILE) config.alerts.tokenFile = HELM_NTFY_TOKEN_FILE

  // HELM_NODES=your-server=http://your-server:61208,laptop=http://mm:61208
  if (HELM_NODES) {
    config.nodes = HELM_NODES.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry, index) => {
        const split = entry.indexOf('=')
        const [label, url] =
          split === -1 ? [null, entry] : [entry.slice(0, split), entry.slice(split + 1)]
        return normalizeNode({ label, url }, index)
      })
  }

  return config
}

/** True when the nodes come from HELM_NODES, so editing them in a file is moot. */
export const nodesFromEnv = (): boolean => !!process.env.HELM_NODES

/** The first config file that exists, parsed, or `{}` and null when there is none. */
export async function readRawConfig(): Promise<{ raw: any; path: string | null }> {
  for (const path of CONFIG_PATHS) {
    const file = Bun.file(path)
    if (!(await file.exists())) continue
    let raw: any
    try {
      raw = await file.json()
    } catch (error) {
      throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`)
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ConfigError(`${path} must hold a JSON object`)
    }
    return { raw, path }
  }
  return { raw: {}, path: null }
}

/**
 * Where setup and Settings write: $HELM_CONFIG when set (the installed
 * service), else the file that was loaded, else ./config.json (dev). None of
 * these can be shadowed by an earlier entry in CONFIG_PATHS, so what is
 * written is what the next load reads.
 */
export function configWriteTarget(loadedPath: string | null): string {
  return process.env.HELM_CONFIG || loadedPath || './config.json'
}

/**
 * Raw JSON → validated Config with env overrides applied. Throws ConfigError
 * on anything invalid, which is also how setup and Settings check a config
 * before writing it. `quiet` skips the warnings meant for the startup log.
 */
export async function buildConfig(raw: any, { quiet = false } = {}): Promise<Config> {
  const config: Config = {
    server: {
      ...DEFAULTS.server,
      ...(raw.server ?? {}),
      allowedOrigins: (() => {
        const list = raw.server?.allowedOrigins ?? []
        if (!Array.isArray(list)) throw new ConfigError('server.allowedOrigins must be an array')
        return list.map(normalizeOrigin)
      })(),
    },
    auth: { ...DEFAULTS.auth, ...(raw.auth ?? {}) },
    terminal: { ...DEFAULTS.terminal, ...(raw.terminal ?? {}) },
    alerts: {
      ...DEFAULTS.alerts,
      ...(raw.alerts ?? {}),
      rules: (() => {
        const raw_rules = raw.alerts?.rules ?? {}
        // The rule used to be called containerStopped and meant something
        // broader; honour an existing config rather than silently disabling it.
        if (raw_rules.containerStopped !== undefined && raw_rules.containerCrashed === undefined) {
          raw_rules.containerCrashed = raw_rules.containerStopped
        }
        return { ...DEFAULTS.alerts.rules, ...raw_rules }
      })(),
    },
    stacks: { ...DEFAULTS.stacks, ...(raw.stacks ?? {}) },
    containers: { ...DEFAULTS.containers, ...(raw.containers ?? {}) },
    refreshMs: Number(raw.refreshMs ?? DEFAULTS.refreshMs),
    nodes: (raw.nodes ?? []).map(normalizeNode),
    commands: (raw.commands ?? []).map(normalizeCommand),
    services: (raw.services ?? []).map(normalizeService),
  }

  normalizeStacks(config, raw.stacks)
  applyEnvOverrides(config)

  const seen = new Set<string>()
  for (const node of config.nodes) {
    if (seen.has(node.id)) throw new ConfigError(`duplicate node id "${node.id}"`)
    seen.add(node.id)
  }
  // Resolve the token file once, at startup: a missing one should be loud here
  // rather than a silent 403 on every alert for the next six months.
  if (!config.alerts.token && config.alerts.tokenFile) {
    const file = Bun.file(config.alerts.tokenFile)
    if (await file.exists()) {
      config.alerts.token = (await file.text()).trim() || null
      if (!config.alerts.token && !quiet) {
        console.warn(`[config] ${config.alerts.tokenFile} is empty — ntfy will reject publishes`)
      }
    } else if (!quiet) {
      console.warn(`[config] alerts.tokenFile not found: ${config.alerts.tokenFile}`)
    }
  }

  if (config.alerts.enabled && !config.alerts.url) {
    throw new ConfigError('alerts.enabled is true but alerts.url is not set')
  }
  return config
}

/**
 * `configured` is false only when no config file exists anywhere in
 * CONFIG_PATHS and HELM_NODES is unset — a fresh install, which serves the
 * first-run setup instead of a dashboard.
 */
export async function loadConfig(): Promise<{
  config: Config
  source: string
  path: string | null
  configured: boolean
}> {
  const { raw, path } = await readRawConfig()
  const config = await buildConfig(raw)
  const configured = path !== null || nodesFromEnv()
  if (configured && config.nodes.length === 0) {
    console.warn('[config] no nodes configured — add some in Settings, or set HELM_NODES')
  }
  return { config, source: path ?? 'defaults + env', path, configured }
}
