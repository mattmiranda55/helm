/**
 * Threshold alerts, delivered to ntfy.
 *
 * This is the one thing in the app that polls on its own — everything else
 * happens because a browser asked. That is the point: an alert you only see
 * when you open the dashboard is useless, since you open the dashboard when you
 * already know something is wrong. The cost is kept small by running on a slow
 * interval (60s by default, against the dashboard's 5s) and reusing the same
 * TTL-cached Glances client the UI uses.
 *
 * Two rules keep it from becoming noise you learn to ignore:
 *   - a condition must hold for several consecutive checks before it fires, so
 *     one busy minute of a backup job does not page you;
 *   - it fires on the TRANSITION, then stays quiet until it recovers (or until
 *     the repeat interval lapses), rather than every cycle.
 */

import type { AlertConfig, Config, NodeConfig } from './config'
import { fetchMetrics, type Metrics } from './glances'

type Finding = {
  key: string
  title: string
  message: string
  priority: number
  tags: string[]
}

type State = { streak: number; notifiedAt: number; firing: boolean }

const states = new Map<string, State>()

/**
 * How stale a snapshot may be when evaluating alerts.
 *
 * Deliberately NOT the sweep interval: passing that as the freshness bound lets
 * a sweep evaluate data from just before the previous sweep, delaying detection
 * by up to a full interval. A small bound still reuses the dashboard's poll
 * when someone is watching, and fetches fresh when nobody is.
 */
const FRESH_MS = 10_000

const pct = (value: number) => `${value.toFixed(1)}%`

function evaluate(node: NodeConfig, metrics: Metrics, rules: AlertConfig['rules']): Finding[] {
  const found: Finding[] = []
  const at = `${node.label}`

  if (rules.cpu != null && metrics.cpu.total >= rules.cpu) {
    found.push({
      key: `${node.id}:cpu`,
      title: `${at}: CPU ${pct(metrics.cpu.total)}`,
      message: `CPU has been at ${pct(metrics.cpu.total)} (threshold ${rules.cpu}%).\nLoad ${metrics.load.min1?.toFixed(2)} across ${metrics.cpu.cores} cores.`,
      priority: 4,
      tags: ['fire'],
    })
  }

  if (rules.mem != null && metrics.mem.percent >= rules.mem) {
    found.push({
      key: `${node.id}:mem`,
      title: `${at}: memory ${pct(metrics.mem.percent)}`,
      message: `Memory at ${pct(metrics.mem.percent)} (threshold ${rules.mem}%).`,
      priority: 4,
      tags: ['fire'],
    })
  }

  if (rules.swap != null && metrics.swap.total > 0 && metrics.swap.percent >= rules.swap) {
    found.push({
      key: `${node.id}:swap`,
      title: `${at}: swap ${pct(metrics.swap.percent)}`,
      message: `Swap at ${pct(metrics.swap.percent)} (threshold ${rules.swap}%) — the box is under memory pressure.`,
      priority: 4,
      tags: ['fire'],
    })
  }

  if (rules.loadPerCore != null && metrics.load.min5 != null && metrics.load.cores) {
    const perCore = metrics.load.min5 / metrics.load.cores
    if (perCore >= rules.loadPerCore) {
      found.push({
        key: `${node.id}:load`,
        title: `${at}: load ${metrics.load.min5.toFixed(2)}`,
        message: `5-minute load ${metrics.load.min5.toFixed(2)} over ${metrics.load.cores} cores (${perCore.toFixed(2)} per core).`,
        priority: 4,
        tags: ['fire'],
      })
    }
  }

  if (rules.fs != null) {
    for (const mount of metrics.fs) {
      if (mount.percent >= rules.fs) {
        found.push({
          key: `${node.id}:fs:${mount.mount}`,
          title: `${at}: ${mount.mount} ${pct(mount.percent)} full`,
          message: `${mount.mount} (${mount.device}) is ${pct(mount.percent)} full — ${bytesShort(mount.free)} free of ${bytesShort(mount.size)}.`,
          priority: 4,
          tags: ['floppy_disk'],
        })
      }
    }
  }

  if (rules.temperature) {
    for (const sensor of metrics.sensors) {
      // The hardware's CRITICAL point, not its warning point. Intel cores warn
      // at ~84°C, which a long transcode reaches routinely and which needs no
      // action; critical is the number that means "act now".
      const limit = sensor.critical
      if (limit && sensor.value >= limit) {
        found.push({
          key: `${node.id}:temp:${sensor.label}`,
          title: `${at}: ${sensor.label} ${Math.round(sensor.value)}°${sensor.unit}`,
          message: `${sensor.label} at ${Math.round(sensor.value)}°${sensor.unit}, at or past its ${Math.round(limit)}°${sensor.unit} critical point.`,
          priority: 5,
          tags: ['fire'],
        })
      }
    }
  }

  if (rules.containerCrashed) {
    for (const container of metrics.containers) {
      // Only a container the engine is fighting with counts as a crash.
      //
      // Every stack here uses `restart: always`, and that policy is NOT applied
      // to a manual stop — so a container sitting in `exited` was stopped on
      // purpose, and one that is `restarting` or `dead` failed on its own.
      // Alerting on "was running, now isn't" instead meant every deliberate
      // `compose down` paged the phone.
      if (container.status !== 'restarting' && container.status !== 'dead') continue
      found.push({
        key: `${node.id}:container:${container.name}`,
        title: `${at}: ${container.name} is ${container.status}`,
        message:
          container.status === 'restarting'
            ? `Container ${container.name} keeps restarting — it is crash-looping, not running.`
            : `Container ${container.name} is dead and did not come back.`,
        priority: 4,
        tags: ['warning'],
      })
    }
  }

  return found
}

function bytesShort(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export async function publish(alerts: AlertConfig, finding: Omit<Finding, 'key'>) {
  const url = `${alerts.url.replace(/\/+$/, '')}/${encodeURIComponent(alerts.topic)}`
  const headers: Record<string, string> = {
    Title: finding.title,
    Priority: String(finding.priority),
    Tags: finding.tags.join(','),
  }
  if (alerts.token) headers.Authorization = `Bearer ${alerts.token}`
  // Tapping the notification should land on the dashboard.
  if (alerts.clickUrl) headers.Click = alerts.clickUrl

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: finding.message,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`ntfy responded ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
}

async function notify(alerts: AlertConfig, finding: Omit<Finding, 'key'>) {
  try {
    await publish(alerts, finding)
  } catch (error) {
    console.error(`[alerts] could not publish: ${(error as Error).message}`)
  }
}

/** One pass over every node. Exported so the test endpoint can force one. */
export async function sweep(config: Config) {
  const alerts = config.alerts
  const now = Date.now()

  for (const node of config.nodes) {
    let findings: Finding[]

    try {
      const metrics = await fetchMetrics(node, FRESH_MS)
      findings = evaluate(node, metrics, alerts.rules)
    } catch (error) {
      findings = alerts.rules.nodeDown
        ? [
            {
              key: `${node.id}:down`,
              title: `${node.label} is unreachable`,
              message: `Cannot reach Glances at ${node.url}\n${(error as Error).message}`,
              priority: 5,
              tags: ['rotating_light'],
            },
          ]
        : []
    }

    const active = new Set(findings.map((f) => f.key))

    for (const finding of findings) {
      const state = states.get(finding.key) ?? { streak: 0, notifiedAt: 0, firing: false }
      state.streak += 1

      const sustained = state.streak >= alerts.sustain
      // repeatMs <= 0 means "tell me once": it stays quiet until the condition
      // clears and comes back, rather than re-firing on a timer.
      const stale = alerts.repeatMs > 0 && now - state.notifiedAt >= alerts.repeatMs
      if (sustained && (!state.firing || stale)) {
        state.firing = true
        state.notifiedAt = now
        await notify(alerts, finding)
      }
      states.set(finding.key, state)
    }

    // Anything that was firing for this node and no longer appears has recovered.
    for (const [key, state] of states) {
      if (!key.startsWith(`${node.id}:`) || active.has(key)) continue
      if (state.firing && alerts.notifyRecovery) {
        await notify(alerts, {
          title: `${node.label}: recovered`,
          message: `${key.split(':').slice(1).join(' ')} is back to normal.`,
          priority: 2,
          tags: ['white_check_mark'],
        })
      }
      states.delete(key)
    }
  }
}

export function startAlerts(config: Config): { stop: () => void } | null {
  const { alerts } = config
  if (!alerts.enabled || !alerts.url || !alerts.topic) return null

  let timer: Timer | undefined
  let stopped = false

  const loop = async () => {
    if (stopped) return
    try {
      await sweep(config)
    } catch (error) {
      console.error('[alerts]', error)
    }
    if (!stopped) timer = setTimeout(loop, alerts.intervalMs)
  }

  // A first sweep only records baselines; nothing can be "sustained" yet.
  timer = setTimeout(loop, 5_000)

  return {
    stop: () => {
      stopped = true
      clearTimeout(timer)
    },
  }
}
