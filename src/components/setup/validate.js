/**
 * Rules and helpers shared by the setup forms (and the Settings editors that
 * reuse them). They mirror what server/config.ts accepts, so a form that
 * passes here produces a config the server will load.
 */

/** The server's own slug rule (server/config.ts `slug`). */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** "base-station" → "Base Station", for a default machine name from a hostname. */
export function titleCase(value) {
  return String(value ?? '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

export function isHttpUrl(value) {
  const text = String(value ?? '').trim()
  if (!/^https?:\/\//i.test(text)) return false
  try {
    return !!new URL(text).host
  } catch {
    return false
  }
}

const URL_HINT = 'Enter a full URL starting with http:// or https://'

/**
 * Field → message for one node; empty when it's valid.
 * `takenIds` are the ids the *other* nodes use.
 */
export function nodeErrors(node, takenIds = []) {
  const errors = {}
  if (!String(node?.label ?? '').trim()) errors.label = 'Give this machine a name'
  const id = String(node?.id ?? '')
  if (!id) errors.id = 'Needs an ID'
  else if (!ID_PATTERN.test(id)) errors.id = 'Lowercase letters, numbers and dashes only'
  else if (takenIds.includes(id)) errors.id = 'Another machine already uses this ID'
  if (!String(node?.url ?? '').trim()) errors.url = 'Enter the Glances address'
  else if (!isHttpUrl(node.url)) errors.url = URL_HINT
  return errors
}

export function serviceErrors(service) {
  const errors = {}
  if (!String(service?.name ?? '').trim()) errors.name = 'Give it a name'
  if (!String(service?.url ?? '').trim()) errors.url = 'Enter its address'
  else if (!isHttpUrl(service.url)) errors.url = URL_HINT
  return errors
}

export function commandErrors(command) {
  const errors = {}
  if (!String(command?.name ?? '').trim()) errors.name = 'Give it a name'
  if (!String(command?.command ?? '').trim()) errors.command = 'Enter the command'
  return errors
}

export const hasErrors = (errors) => Object.keys(errors).length > 0

// ---------------------------------------------------------------- stacks
//
// Stacks = { dir: string | null, command: string[], template: string | null,
// envTemplate: string | null }. `dir` null = helm doesn't manage stacks; a
// template null = the built-in default (stackDefaults from the server). The
// server stores null for anything equal to its default, so an untouched form
// leaves the config file clean and later, better defaults still reach it.

/**
 * The server's "same template" rule (server/stacks.ts `normalizeTemplate`):
 * line endings and trailing whitespace don't make a template custom.
 */
export const normalizeTemplate = (text) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd()

export const sameTemplate = (a, b) => normalizeTemplate(a) === normalizeTemplate(b)

/** "docker  compose" → ["docker", "compose"]. Argv, never a shell string. */
export const splitCommand = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean)

/**
 * Field → message; empty when valid. Only the folder can be wrong here: an
 * empty command means "the default", and an empty template falls back to the
 * default on the server. Whether the folder exists is the server's call
 * (it answers 400 with a readable message).
 */
export function stacksErrors(stacks) {
  const errors = {}
  if (!stacks || stacks.dir === null) return errors
  const dir = String(stacks.dir ?? '').trim()
  if (!dir) errors.dir = 'Enter the folder, or turn on Don’t manage stacks'
  else if (!dir.startsWith('/')) errors.dir = 'Use a full path, starting with /'
  return errors
}

/** Stacks as setup and Settings send them: trimmed, and empty → the default (null). */
export function outgoingStacks(stacks) {
  const dir = stacks.dir === null ? null : String(stacks.dir ?? '').trim() || null
  const command = (stacks.command ?? []).map((part) => String(part).trim()).filter(Boolean)
  return {
    dir,
    command: command.length ? command : null,
    template: stacks.template ?? null,
    envTemplate: stacks.envTemplate ?? null,
  }
}

/**
 * A service address on the host the browser is using right now — the same
 * name or IP that reached helm will usually reach its neighbours' ports.
 */
export function urlOnThisHost(port, host = location.hostname) {
  const name = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${name}:${port}`
}

/** A Glances URL as the server stores it: trimmed, no trailing slash. */
export const cleanUrl = (value) => String(value ?? '').trim().replace(/\/+$/, '')

/** A short id for list keys (crypto.randomUUID needs a secure context, which a tailnet http:// address isn't). */
export const localKey = () => Math.random().toString(36).slice(2, 10)
