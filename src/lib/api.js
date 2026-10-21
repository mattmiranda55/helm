/**
 * Thin client for the Bun server. Same origin in every environment: Vite
 * proxies /api and /pty to the server in dev, and the server serves the built
 * app itself in production (including when it is added to an iPhone home
 * screen, which is still Safari loading this origin).
 */

const TOKEN_KEY = 'tools.token'

/**
 * Optional shared secret, taken from ?token= on first visit and remembered.
 *
 * localStorage rather than sessionStorage on purpose: installed to an iPhone
 * home screen the app relaunches with start_url ("/"), which carries no token —
 * a session-scoped copy would 401 on every cold start.
 */
const params = new URLSearchParams(location.search)
const TOKEN = params.get('token') ?? localStorage.getItem(TOKEN_KEY) ?? null
if (TOKEN) localStorage.setItem(TOKEN_KEY, TOKEN)

export const token = TOKEN

/**
 * Remember a new token (empty clears it), then reload so every module and
 * every open socket picks it up from scratch. The Settings page uses this so
 * a home-screen install, which can't be given a ?token= link, can sign in.
 */
export function saveToken(nextToken) {
  const secret = (nextToken ?? '').trim()
  if (secret) localStorage.setItem(TOKEN_KEY, secret)
  else localStorage.removeItem(TOKEN_KEY)
  location.reload()
}

/** ws(s)://host of this page. */
function socketOrigin() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}`
}

async function get(path, { signal } = {}) {
  const response = await fetch(path, {
    signal,
    headers: TOKEN ? { 'X-Helm-Token': TOKEN } : {},
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail.error ?? `HTTP ${response.status}`)
  }
  return response.json()
}

export const fetchAppConfig = (options) => get('/api/config', options)

export const fetchMetrics = (nodeId, options) =>
  get(`/api/nodes/${encodeURIComponent(nodeId)}/metrics`, options)

export const fetchStacks = (options) => get('/api/stacks', options)

/** Starts the job and returns immediately; output arrives over the stream. */
export async function stackAction(name, action) {
  const response = await fetch(`/api/stacks/${encodeURIComponent(name)}/${action}`, {
    method: 'POST',
    headers: TOKEN ? { 'X-Helm-Token': TOKEN } : {},
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

export const fetchStackFiles = (name, options) =>
  get(`/api/stacks/${encodeURIComponent(name)}/files`, options)

async function send(path, method, body) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(TOKEN ? { 'X-Helm-Token': TOKEN } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const parsed = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(parsed.error ?? `HTTP ${response.status}`)
  return parsed
}

export const saveStackFiles = (name, compose, env) =>
  send(`/api/stacks/${encodeURIComponent(name)}/files`, 'PUT', { compose, env })

export const createStack = (name, compose, env) =>
  send('/api/stacks', 'POST', { name, compose, env })

export const deleteStack = (name) => send(`/api/stacks/${encodeURIComponent(name)}`, 'DELETE')

/** Live output for a running stack job. */
export function stackStreamUrl(name) {
  const params = new URLSearchParams({ name })
  if (TOKEN) params.set('token', TOKEN)
  return `${socketOrigin()}/api/stacks/stream?${params}`
}

export const fetchCapabilities = (nodeId, options) =>
  get(`/api/nodes/${encodeURIComponent(nodeId)}/capabilities`, options)

export const fetchContainerLogs = (nodeId, name, tail = 200, options) =>
  get(
    `/api/nodes/${encodeURIComponent(nodeId)}/containers/${encodeURIComponent(name)}/logs?tail=${tail}`,
    options,
  )

/** Acting on a container is a POST so it can never happen by navigation. */
export async function containerAction(nodeId, name, action) {
  const response = await fetch(
    `/api/nodes/${encodeURIComponent(nodeId)}/containers/${encodeURIComponent(name)}/${action}`,
    { method: 'POST', headers: TOKEN ? { 'X-Helm-Token': TOKEN } : {} },
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

export const fetchHistory = (nodeId, points = 60, options) =>
  get(`/api/nodes/${encodeURIComponent(nodeId)}/history?points=${points}`, options)

export const fetchProcesses = (nodeId, limit = 20, options) =>
  get(`/api/nodes/${encodeURIComponent(nodeId)}/processes?limit=${limit}`, options)

/** App icon, cached by the server (server/icons.ts). An <img>
 *  cannot send headers, so the token rides along as a query param. */
export function iconUrl(slug) {
  const suffix = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ''
  return `/api/icons/${encodeURIComponent(slug)}${suffix}`
}

/** WebSocket URL for the PTY, carrying the token as a query param — the
 *  browser WebSocket API cannot set headers. */
export function ptyUrl() {
  const suffix = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ''
  return `${socketOrigin()}/pty${suffix}`
}

// ---------------------------------------------------------------- setup
//
// First-run setup and the Settings editors. The shapes are shared:
//
//   EditableConfig = {
//     nodes:    [{ id, label, url, api, local?, username?, password?, hasPassword? }],
//     services: [{ name, url, group?, description?, container?, node?, icon?, favorite? }],
//     commands: [{ name, description?, command }],
//     stacks:   Stacks,                        // optional when sent: absent = leave as is
//   }
//   Stacks = { dir: string | null,             // null = stacks off (New/Manage stack hidden)
//              command: string[],              // argv, e.g. ['podman', 'compose']; always the one in effect
//              template: string | null,        // compose.yaml for a new stack; null = built-in default
//              envTemplate: string | null }    // .env for a new stack; null = built-in default
//   StackDefaults = { template, envTemplate, command }   // the built-ins, for "Reset to default"
//   Probe = { ok: true, api, hostname, os, containers: [{ name, image, status }] }
//         | { ok: false, error }
//   Local = { hostname, engine, glances: Probe, containers: [{ name, image, status, ports }],
//             stackDefaults: StackDefaults,
//             stackDirs: [{ path, projects }] }   // existing candidate folders (/opt/stacks, Dockge's
//                                                 // default, first) and how many compose projects each holds
//
// fetchEditableConfig() returns EditableConfig plus `stackDefaults` (and
// `nodesFromEnv`). Sending Stacks back, the server stores null for anything
// equal to its default — so echoing the default text is fine — and answers
// 400 with a readable message for a bad dir (must be an absolute, existing
// folder that isn't a system directory). /api/config's public `stacks` is
// different: { template, envTemplate, templateIsDefault }, always the
// effective text, which is what the New stack sheet renders.
//
// Setup calls carry the one-time setup code (printed by install.sh and in the
// service log) and only work until setup is done. Afterwards the same probes
// live under /api/admin behind the normal token.

async function call(path, { method = 'GET', body, code, signal } = {}) {
  const response = await fetch(path, {
    method,
    signal,
    headers: {
      ...(TOKEN ? { 'X-Helm-Token': TOKEN } : {}),
      ...(code ? { 'X-Helm-Setup-Code': code } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const parsed = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(parsed.error ?? `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return parsed
}

/** { ok, nodes, setup } — open, so the app can tell it needs setting up before it has a token. */
export const fetchHealth = (options) => call('/api/health', options)

/** Resolves if the code is right; rejects with status 403 (wrong), 429 (too many tries) or 409 (already set up). */
export const verifySetupCode = (code) => call('/api/setup/verify', { method: 'POST', code })

/** What helm can see of the machine it runs on: its Glances (if any) and its containers. */
export const fetchSetupLocal = (code) => call('/api/setup/local', { code })

/** Try a Glances URL from the server's side (the browser may not be able to reach it). */
export const probeGlancesForSetup = (code, target) => call('/api/setup/probe', { method: 'POST', code, body: target })

/** Write the first config. `token: 'generate'` asks the server to mint an access token; it comes back once. */
export const completeSetup = (code, config, token) =>
  call('/api/setup', { method: 'POST', code, body: { config, token } })

/** The editable part of the live config (passwords are never returned, only hasPassword). */
export const fetchEditableConfig = (options) => call('/api/admin/config', options)

/** Replace the editable part; everything else in the file is kept. A node sent without a password keeps its saved one. */
export const saveEditableConfig = (config) => call('/api/admin/config', { method: 'PUT', body: config })

export const fetchLocal = (options) => call('/api/admin/local', options)

export const probeGlances = (target) => call('/api/admin/probe', { method: 'POST', body: target })
