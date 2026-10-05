/**
 * Thin client for the Bun server. Same origin in every environment: Vite
 * proxies /api and /pty to the server in dev, and the server serves the built
 * app itself in production.
 */

/**
 * Optional shared secret, taken from ?token= on first visit and remembered.
 *
 * localStorage rather than sessionStorage on purpose: installed to an iPhone
 * home screen the app relaunches with start_url ("/"), which carries no token —
 * a session-scoped copy would 401 on every cold start.
 */
const params = new URLSearchParams(location.search)
const TOKEN = params.get('token') ?? localStorage.getItem('tools.token') ?? null
if (TOKEN) localStorage.setItem('tools.token', TOKEN)

export const token = TOKEN

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
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const params = new URLSearchParams({ name })
  if (TOKEN) params.set('token', TOKEN)
  return `${scheme}//${location.host}/api/stacks/stream?${params}`
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

/** WebSocket URL for the PTY, carrying the token as a query param — the
 *  browser WebSocket API cannot set headers. */
export function ptyUrl() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const suffix = TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ''
  return `${scheme}//${location.host}/pty${suffix}`
}
