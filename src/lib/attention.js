/**
 * "Needs attention" — what the home page leads with.
 *
 * Mirrors the alert rules in server/alerts.ts so the page and the
 * notifications agree: a crash loop is a problem, a container you stopped
 * yourself (`exited`) is not; a disk past the same threshold the fs alert
 * uses; a sensor at its own warning or critical point.
 */
import { bytes } from './format'

const CRASHED = new Set(['restarting', 'dead'])

/**
 * @param nodes      [{ id, label }]
 * @param snapshots  { [id]: { metrics, error, misses } }
 * @param thresholds { fs } — percent at which a filesystem counts as almost full
 */
export function attentionItems(nodes, snapshots, thresholds = {}) {
  const fsLimit = thresholds.fs ?? 90
  const items = []

  for (const node of nodes) {
    const { metrics, error, misses = 0 } = snapshots[node.id] ?? {}

    // One blip is not an outage; two misses in a row is.
    if (error && misses >= 2) {
      items.push({
        key: `down:${node.id}`,
        level: 'critical',
        icon: 'alert',
        nodeId: node.id,
        title: `Can't reach ${node.label}`,
        detail: `${error}. Check that Glances is running on it.`,
        short: 'Not reachable',
        action: { label: 'Open', to: `/machines/${encodeURIComponent(node.id)}` },
      })
      continue
    }
    if (!metrics) continue

    for (const container of metrics.containers) {
      if (!CRASHED.has(container.status)) continue
      const verb = container.status === 'dead' ? 'has died' : 'keeps restarting'
      items.push({
        key: `crash:${node.id}:${container.name}`,
        level: 'critical',
        icon: 'alert',
        nodeId: node.id,
        title: `${container.name} ${verb}`,
        detail: `On ${node.label}. Its logs usually say why.`,
        short: `${container.name} ${verb}`,
        action: {
          label: 'View logs',
          to: `/containers?node=${encodeURIComponent(node.id)}&open=${encodeURIComponent(container.name)}`,
        },
      })
    }

    for (const fs of metrics.fs) {
      if (fs.percent < fsLimit) continue
      items.push({
        key: `fs:${node.id}:${fs.mount}`,
        level: 'warning',
        icon: 'disk',
        nodeId: node.id,
        title: `Disk almost full on ${node.label}`,
        detail: `${fs.mount} is ${Math.round(fs.percent)}% full, ${bytes(fs.free)} left.`,
        short: `Disk ${fs.mount} is ${Math.round(fs.percent)}% full`,
        action: { label: 'Open', to: `/machines/${encodeURIComponent(node.id)}` },
      })
    }

    const hot = metrics.sensors
      .filter((s) => s.unit === 'C' || s.unit === 'F')
      .map((s) => ({
        ...s,
        level:
          s.critical != null && s.value >= s.critical
            ? 'critical'
            : s.warning != null && s.value >= s.warning
              ? 'warning'
              : null,
      }))
      .filter((s) => s.level)
      .sort((a, b) => b.value - a.value)[0]
    if (hot) {
      items.push({
        key: `hot:${node.id}`,
        level: hot.level,
        icon: 'alert',
        nodeId: node.id,
        title: `${node.label} is running hot`,
        detail: `${hot.label} is at ${Math.round(hot.value)}°${hot.unit}.`,
        short: 'Running hot',
        action: { label: 'Open', to: `/machines/${encodeURIComponent(node.id)}` },
      })
    }
  }

  return items.sort((a, b) => Number(b.level === 'critical') - Number(a.level === 'critical'))
}
