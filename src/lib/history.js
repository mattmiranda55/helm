/**
 * Fixed-length series buffers, one set per node.
 *
 * Sparklines need history the API does not provide, and switching nodes must
 * not splice one machine's numbers onto another's line — so buffers are keyed
 * by node id and survive a switch-and-return.
 */

export const HISTORY_LENGTH = 60

const buffers = new Map()

function keyFor(nodeId, series) {
  return `${nodeId}::${series}`
}

/**
 * Append a sample and return the new buffer.
 *
 * Deliberately immutable: these arrays are handed to components as props, and
 * Vue compares props by reference. Mutating in place left every sparkline
 * frozen at whatever it happened to hold when it mounted. Copying a 60-element
 * array a handful of times per refresh costs nothing.
 */
export function push(nodeId, series, value) {
  const key = keyFor(nodeId, series)
  const previous = buffers.get(key) ?? []
  const next = [...previous, Number.isFinite(value) ? value : 0]
  if (next.length > HISTORY_LENGTH) next.splice(0, next.length - HISTORY_LENGTH)
  buffers.set(key, next)
  return next
}

/** Nodes already backfilled this session — the seed happens once. */
const seeded = new Set()

export function isSeeded(nodeId) {
  return seeded.has(nodeId)
}

/**
 * Prepend Glances' own history in front of whatever has arrived live.
 *
 * Runs once per node and never displaces live samples, so it can land
 * whenever the request happens to finish without racing the first poll.
 */
export function seed(nodeId, series, values) {
  seeded.add(nodeId)
  if (!values?.length) return
  const key = keyFor(nodeId, series)
  const live = buffers.get(key) ?? []
  buffers.set(key, [...values, ...live].slice(-HISTORY_LENGTH))
}

export function read(nodeId, series) {
  return buffers.get(keyFor(nodeId, series)) ?? []
}

export function reset(nodeId) {
  seeded.delete(nodeId)
  for (const key of buffers.keys()) {
    if (key.startsWith(`${nodeId}::`)) buffers.delete(key)
  }
}
