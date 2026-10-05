/** Value formatting. Kept in one place so tiles, tables and tooltips agree. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** 1_536_000 → "1.5 GB". `precision` is significant-ish, not fixed. */
export function bytes(value, precision = 1) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(Math.abs(n)) / Math.log(1024)), BYTE_UNITS.length - 1)
  const scaled = n / 1024 ** exponent
  const digits = exponent === 0 ? 0 : scaled >= 100 ? 0 : precision
  return `${scaled.toFixed(digits)} ${BYTE_UNITS[exponent]}`
}

/** Bytes per second, in the compact form a network readout wants. */
export function rate(value) {
  return `${bytes(value)}/s`
}

export function percent(value, digits = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(n >= 100 ? 0 : digits)}%`
}

/** Counts, auto-compacted the way a stat tile wants: 1,284 / 12.9K / 4.2M */
export function count(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

export function hertz(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${(n / 1e9).toFixed(2)} GHz`
}

/** "73 days, 1:57:38" → "73d 1h" — the tile has no room for seconds. */
export function uptime(value) {
  if (!value) return '—'
  const match = String(value).match(/(?:(\d+)\s*days?,\s*)?(\d+):(\d+):(\d+)/)
  if (!match) return String(value)
  const [, days, hours, minutes] = match
  if (days) return `${days}d ${Number(hours)}h`
  if (Number(hours)) return `${Number(hours)}h ${Number(minutes)}m`
  return `${Number(minutes)}m`
}

/** "73 days, 1:57:38" → "73 days 1 hour" — for the machine page's facts. */
export function uptimeLong(value) {
  const match = String(value ?? '').match(/(?:(\d+)\s*days?,\s*)?(\d+):(\d+):(\d+)/)
  if (!match) return value ? String(value) : null
  const [, days, hours, minutes] = match.map(Number)
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (days) return `${unit(days, 'day')} ${unit(hours, 'hour')}`
  if (hours) return `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`
  return unit(minutes, 'minute')
}

/** "73 days, 1:57:38" → "up 73 days" — one unit, for a card corner. */
export function uptimeShort(value) {
  const match = String(value ?? '').match(/(?:(\d+)\s*days?,\s*)?(\d+):(\d+):(\d+)/)
  if (!match) return null
  const [, days, hours, minutes] = match.map(Number)
  if (days) return `up ${days} day${days === 1 ? '' : 's'}`
  if (hours) return `up ${hours} hour${hours === 1 ? '' : 's'}`
  return `up ${minutes} min`
}

export function temperature(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n)}°${unit === 'F' ? 'F' : 'C'}`
}

/**
 * Severity for a 0-100 utilization figure. Status colors are reserved for
 * state, so this is the only thing allowed to choose one.
 */
export function severity(value, { warn = 70, serious = 85, critical = 95 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'idle'
  if (n >= critical) return 'critical'
  if (n >= serious) return 'serious'
  if (n >= warn) return 'warning'
  return 'good'
}

export const SEVERITY_COLOR = {
  idle: 'var(--color-muted)',
  good: 'var(--color-series-1)',
  warning: 'var(--color-warning)',
  serious: 'var(--color-serious)',
  critical: 'var(--color-critical)',
}

/** Status colors never carry meaning alone — each ships with this label. */
export const SEVERITY_LABEL = {
  idle: 'No data',
  good: 'Normal',
  warning: 'Elevated',
  serious: 'High',
  critical: 'Critical',
}
