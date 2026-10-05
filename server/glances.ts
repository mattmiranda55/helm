/**
 * Glances REST client, tuned to stay cheap on the machine being watched.
 *
 * Three things drive the design, all measured against your-server's Glances:
 *
 *  1. Glances computes plugins on demand, per request. `/all` costs ~194ms of
 *     its CPU and 288KB on the wire every single tick; the plugins this
 *     dashboard actually shows cost ~20KB. So we never call /all.
 *  2. There is a fixed ~12-25ms of request overhead regardless of plugin, so
 *     the win is in asking for FEWER plugins, not smaller ones — hence the TTL
 *     tiers below. Container lists and sensor readings do not change at
 *     sparkline cadence, so they are not refetched at sparkline cadence.
 *  3. Requests must be sequential. Glances derives CPU and I/O percentages from
 *     deltas against its own last sample, and concurrent plugin requests race
 *     for that state — `cpu` and `quicklook` fired together will happily report
 *     0% and 100% for the same instant.
 *
 * Nothing polls on a timer here: a fetch happens only when a browser asks, so
 * an idle install costs nothing beyond the Bun process itself.
 *
 * Responses are normalized here rather than in the browser so the payload stays
 * small and the frontend never has to care which plugins a given node exposes
 * (a containerized Glances with no host mount returns [] for `fs`, a headless
 * box has no `sensors`, and so on).
 */

import type { NodeConfig } from './config'

/**
 * How stale each plugin is allowed to be, in ms.
 *
 * 0 means "as fresh as the poll interval" — these are the series that get
 * plotted, so they are refetched every tick. Everything else is re-read only
 * when its TTL lapses, which is what keeps a steady-state refresh at six
 * requests instead of thirteen.
 */
const PLUGIN_TTL_MS: Record<string, number> = {
  // Plotted every tick.
  quicklook: 0, // cpu total + per-core + model name, in one request
  cpu: 0, // the user/system/iowait breakdown quicklook omits
  mem: 0,
  load: 0,
  network: 0,
  diskio: 0,
  // Real, but not sparkline-fast.
  memswap: 15_000,
  processcount: 15_000,
  containers: 15_000,
  sensors: 30_000,
  fs: 60_000,
  uptime: 60_000,
  // Effectively static for the life of the process.
  system: 600_000,
}

const METRIC_PLUGINS = Object.keys(PLUGIN_TTL_MS)

type Plugin = string

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

const arr = (value: unknown): any[] => (Array.isArray(value) ? value : [])

function authHeaders(node: NodeConfig): Record<string, string> {
  if (!node.username && !node.password) return {}
  const credentials = btoa(`${node.username ?? 'glances'}:${node.password ?? ''}`)
  return { Authorization: `Basic ${credentials}` }
}

export async function fetchPlugin(node: NodeConfig, plugin: Plugin): Promise<any> {
  const response = await fetch(`${node.url}/api/${node.api}/${plugin}`, {
    headers: { Accept: 'application/json', ...authHeaders(node) },
    signal: AbortSignal.timeout(node.timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`${plugin}: HTTP ${response.status}`)
  }
  return response.json()
}

function normalize(node: NodeConfig, raw: Record<string, any>, errors: Record<string, string>) {
  const system = raw.system ?? {}
  const quicklook = raw.quicklook ?? {}
  const cpu = raw.cpu ?? {}
  const mem = raw.mem ?? {}
  const swap = raw.memswap ?? {}
  const load = raw.load ?? {}
  const processcount = raw.processcount ?? {}

  const perCore = arr(quicklook.percpu)
    .sort((a, b) => (a.cpu_number ?? 0) - (b.cpu_number ?? 0))
    .map((core: any) => num(core.total) ?? 0)

  return {
    node: { id: node.id, label: node.label, url: node.url },
    ts: Date.now(),
    online: true,
    errors,

    system: {
      hostname: system.hostname ?? node.label,
      os: system.hr_name ?? system.os_name ?? null,
      platform: system.platform ?? null,
      uptime: typeof raw.uptime === 'string' ? raw.uptime : null,
    },

    cpu: {
      name: quicklook.cpu_name ?? null,
      hz: num(quicklook.cpu_hz_current),
      hzMax: num(quicklook.cpu_hz),
      cores: num(cpu.cpucore) ?? (perCore.length || null),
      total: num(cpu.total) ?? num(quicklook.cpu) ?? 0,
      user: num(cpu.user) ?? 0,
      system: num(cpu.system) ?? 0,
      iowait: num(cpu.iowait) ?? 0,
      steal: num(cpu.steal) ?? 0,
      idle: num(cpu.idle) ?? 0,
      perCore,
    },

    load: {
      min1: num(load.min1),
      min5: num(load.min5),
      min15: num(load.min15),
      cores: num(load.cpucore) ?? num(cpu.cpucore),
    },

    mem: {
      total: num(mem.total) ?? 0,
      used: num(mem.used) ?? 0,
      free: num(mem.free) ?? 0,
      available: num(mem.available) ?? 0,
      buffers: num(mem.buffers) ?? 0,
      cached: num(mem.cached) ?? 0,
      percent: num(mem.percent) ?? 0,
    },

    swap: {
      total: num(swap.total) ?? 0,
      used: num(swap.used) ?? 0,
      percent: num(swap.percent) ?? 0,
    },

    // `lo` is dropped — loopback traffic is never what you are watching for.
    network: arr(raw.network)
      .filter((iface: any) => iface.interface_name !== 'lo')
      .map((iface: any) => ({
        name: iface.alias || iface.interface_name,
        rx: num(iface.bytes_recv_rate_per_sec) ?? 0,
        tx: num(iface.bytes_sent_rate_per_sec) ?? 0,
        rxTotal: num(iface.bytes_recv_gauge) ?? 0,
        txTotal: num(iface.bytes_sent_gauge) ?? 0,
        speed: num(iface.speed) ?? 0,
      }))
      .sort((a, b) => b.rx + b.tx - (a.rx + a.tx)),

    // Glances lists partitions alongside their parent device, and the parent's
    // counters already include them — showing both double-counts the same I/O.
    disks: rollUpPartitions(arr(raw.diskio))
      .map((disk: any) => ({
        name: disk.disk_name,
        read: num(disk.read_bytes_rate_per_sec) ?? 0,
        write: num(disk.write_bytes_rate_per_sec) ?? 0,
        readLatency: num(disk.read_latency) ?? 0,
        writeLatency: num(disk.write_latency) ?? 0,
      }))
      .sort((a, b) => b.read + b.write - (a.read + a.write)),

    fs: arr(raw.fs).map((entry: any) => ({
      mount: entry.mnt_point,
      device: entry.device_name,
      type: entry.fs_type,
      size: num(entry.size) ?? 0,
      used: num(entry.used) ?? 0,
      free: num(entry.free) ?? 0,
      percent: num(entry.percent) ?? 0,
    })),

    sensors: arr(raw.sensors)
      .filter((sensor: any) => num(sensor.value) !== null)
      .map((sensor: any) => ({
        label: sensor.label,
        value: num(sensor.value) ?? 0,
        unit: sensor.unit ?? '',
        type: sensor.type ?? null,
        warning: num(sensor.warning),
        critical: num(sensor.critical),
      })),

    processes: {
      total: num(processcount.total) ?? 0,
      running: num(processcount.running) ?? 0,
      sleeping: num(processcount.sleeping) ?? 0,
      threads: num(processcount.thread) ?? 0,
    },

    containers: arr(raw.containers)
      .map((container: any) => {
        const usage = num(container.memory_usage) ?? num(container.memory?.usage) ?? 0
        const limit = num(container.memory_limit) ?? num(container.memory?.limit) ?? 0
        return {
          name: container.name,
          status: container.status ?? 'unknown',
          image: arr(container.image)[0] ?? container.image ?? null,
          engine: container.engine ?? null,
          uptime: container.uptime ?? null,
          cpu: num(container.cpu_percent) ?? num(container.cpu?.total) ?? 0,
          // Cores available to the container. cpu_percent is summed across
          // cores, so it exceeds 100 legitimately — the limit is what makes
          // "212%" meaningful rather than alarming.
          cpuLimit: num(container.cpu_limit) ?? num(container.cpu?.limit) ?? null,
          memory: usage,
          // Glances reports memory_percent as null under podman; derive it.
          memoryPercent:
            num(container.memory_percent) ?? (limit > 0 ? (usage / limit) * 100 : 0),
          rx: num(container.network_rx) ?? num(container.network?.rx) ?? 0,
          tx: num(container.network_tx) ?? num(container.network?.tx) ?? 0,
        }
      })
      .sort((a, b) => {
        const running = Number(b.status === 'running') - Number(a.status === 'running')
        return running !== 0 ? running : b.cpu - a.cpu
      }),
  }
}

export type Metrics = ReturnType<typeof normalize>

/** `sda1` is dropped when `sda` is present; `nvme0n1p1` when `nvme0n1` is. */
function rollUpPartitions(disks: any[]): any[] {
  const names = new Set(disks.map((disk) => disk.disk_name))
  return disks.filter((disk) => {
    const parent = String(disk.disk_name ?? '').match(/^(.*?)p?\d+$/)?.[1]
    return !parent || !names.has(parent)
  })
}

/**
 * Per-node, per-plugin cache. Two things live off it:
 *   - the TTL tiers, so slow-changing plugins are not refetched every tick
 *   - viewer coalescing, so a second browser tab costs the watched machine
 *     nothing at all
 */
type Entry = { at: number; value: any; error?: string }
const cache = new Map<string, Map<string, Entry>>()
const inflight = new Map<string, Promise<void>>()

function cacheFor(nodeId: string): Map<string, Entry> {
  let entries = cache.get(nodeId)
  if (!entries) cache.set(nodeId, (entries = new Map()))
  return entries
}

/**
 * Refresh whatever has gone stale, strictly in sequence.
 *
 * `freshMs` is the floor for tier-0 plugins. It is derived from the poll
 * interval rather than fixed at 0 so that N browsers polling out of phase still
 * produce roughly one fetch per interval, not N.
 */
async function refresh(node: NodeConfig, freshMs: number): Promise<void> {
  const entries = cacheFor(node.id)
  const now = Date.now()

  for (const plugin of METRIC_PLUGINS) {
    const ttl = PLUGIN_TTL_MS[plugin] || freshMs
    const entry = entries.get(plugin)
    // A plugin that errored is retried on the fast tier regardless of its TTL —
    // otherwise a single blip hides `containers` for the next 15 seconds.
    if (entry && !entry.error && now - entry.at < ttl) continue

    try {
      entries.set(plugin, { at: Date.now(), value: await fetchPlugin(node, plugin) })
    } catch (error) {
      entries.set(plugin, { at: Date.now(), value: entry?.value, error: (error as Error).message })
    }
  }
}

function collect(nodeId: string) {
  const raw: Record<string, any> = {}
  const errors: Record<string, string> = {}
  for (const [plugin, entry] of cacheFor(nodeId)) {
    if (entry.value !== undefined) raw[plugin] = entry.value
    if (entry.error) errors[plugin] = entry.error
  }
  return { raw, errors }
}

export async function fetchMetrics(node: NodeConfig, freshMs = 2500): Promise<Metrics> {
  const pending = inflight.get(node.id)
  if (pending) {
    await pending
  } else {
    const request = refresh(node, freshMs).finally(() => inflight.delete(node.id))
    inflight.set(node.id, request)
    await request
  }

  const { raw, errors } = collect(node.id)
  if (raw.cpu == null && raw.mem == null) {
    throw new Error(Object.values(errors)[0] ?? 'no data')
  }
  return normalize(node, raw, errors)
}

/**
 * Top processes.
 *
 * Deliberately its own endpoint rather than part of the metrics payload: it is
 * the single most expensive plugin (~89ms of Glances CPU, 176KB) and the panel
 * that shows it is collapsible, so it is only paid for while someone is
 * actually looking. `top/N` does the truncation server-side — 13KB for 20 rows.
 */
export async function fetchProcesses(node: NodeConfig, limit = 20) {
  const list = arr(await fetchPlugin(node, `processlist/top/${limit}`))
  return list
    .map((process: any) => ({
      pid: process.pid,
      name: process.name,
      cmdline: arr(process.cmdline).join(' ') || process.name,
      user: process.username ?? null,
      status: process.status ?? null,
      cpu: num(process.cpu_percent) ?? 0,
      memory: num(process.memory_percent) ?? 0,
      rss: num(process.memory_info?.rss) ?? 0,
      threads: num(process.num_threads) ?? 0,
    }))
    .sort((a, b) => b.cpu - a.cpu || b.memory - a.memory)
    .slice(0, limit)
}

// ---------------------------------------------------------------- history
//
// Glances keeps per-plugin history, which lets a freshly opened dashboard show
// a trend instead of a blank chart for the first minute.
//
// The catch: it only records a sample when something polls it, so the series is
// NOT evenly spaced. A real node showed 177 points spanning three days with a
// 46-hour gap in the middle — periods when nobody had the dashboard open.
// Plotting those as evenly spaced would draw three days as if it were five
// minutes. So we take only the most recent unbroken run, and if there isn't a
// usable one we backfill nothing and let the chart fill in live.

/** A gap longer than this ends the run — roughly a few missed samples. */
const HISTORY_GAP_MS = 30_000
/** Nothing older than this is worth showing as "recent". */
const HISTORY_MAX_AGE_MS = 20 * 60_000
/** Fewer points than this is not a trend, just noise. */
const HISTORY_MIN_POINTS = 3

type Point = { ts: number; value: number }

function toPoints(raw: unknown): Point[] {
  return arr(raw)
    .map((entry: any) => ({ ts: Date.parse(entry?.[0]), value: num(entry?.[1]) ?? 0 }))
    .filter((point) => Number.isFinite(point.ts))
}

/** Walk back from the newest sample while the spacing stays plausible. */
function recentRun(points: Point[], now: number): Point[] {
  if (points.length === 0) return []
  const newest = points[points.length - 1]
  if (now - newest.ts > HISTORY_MAX_AGE_MS) return []

  let start = points.length - 1
  while (start > 0 && points[start].ts - points[start - 1].ts <= HISTORY_GAP_MS) start--
  return points.slice(start)
}

function sumSeries(history: Record<string, any>, match: (key: string) => boolean): Point[] {
  const series = Object.keys(history).filter(match).map((key) => toPoints(history[key]))
  if (series.length === 0) return []
  const length = Math.min(...series.map((s) => s.length))
  return Array.from({ length }, (_, i) => {
    const offset = series[0].length - length + i
    return {
      ts: series[0][offset].ts,
      value: series.reduce((total, s) => total + s[s.length - length + i].value, 0),
    }
  })
}

/** `sda1` is rolled into `sda`, matching what the metrics payload reports. */
function wholeDisks(keys: string[], suffix: string): Set<string> {
  const names = new Set(
    keys.filter((k) => k.endsWith(suffix)).map((k) => k.slice(0, -suffix.length)),
  )
  return new Set([...names].filter((n) => !((n.match(/^(.*?)p?\d+$/)?.[1] ?? '') && names.has(n.match(/^(.*?)p?\d+$/)![1]))))
}

export async function fetchHistory(node: NodeConfig, points: number) {
  const ask = (plugin: string) =>
    fetchPlugin(node, `${plugin}/history/${points * 3}`).catch(() => ({}))

  // Sequential, like every other Glances call — see the note at the top.
  const cpu: any = await ask('cpu')
  const mem: any = await ask('mem')
  const network: any = await ask('network')
  const diskio: any = await ask('diskio')

  const now = Date.now()

  // Glances' reported cpu "total" is user + system; it does not fold in iowait,
  // and there is no history series for `total` itself.
  const cpuUser = toPoints(cpu?.user)
  const cpuSystem = toPoints(cpu?.system)
  const cpuTotal: Point[] = cpuUser.map((point, i) => ({
    ts: point.ts,
    value: point.value + (cpuSystem[i]?.value ?? 0),
  }))

  const netKeys = Object.keys(network ?? {})
  const diskKeys = Object.keys(diskio ?? {})
  const readDisks = wholeDisks(diskKeys, '_read_bytes_rate_per_sec')
  const writeDisks = wholeDisks(diskKeys, '_write_bytes_rate_per_sec')

  const raw = {
    cpu: cpuTotal,
    mem: toPoints(mem?.percent),
    'net.rx': sumSeries(network ?? {}, (k) => k.endsWith('_bytes_recv_rate_per_sec') && !k.startsWith('lo_')),
    'net.tx': sumSeries(network ?? {}, (k) => k.endsWith('_bytes_sent_rate_per_sec') && !k.startsWith('lo_')),
    'disk.read': sumSeries(diskio ?? {}, (k) => k.endsWith('_read_bytes_rate_per_sec') && readDisks.has(k.slice(0, -'_read_bytes_rate_per_sec'.length))),
    'disk.write': sumSeries(diskio ?? {}, (k) => k.endsWith('_write_bytes_rate_per_sec') && writeDisks.has(k.slice(0, -'_write_bytes_rate_per_sec'.length))),
  }

  const trimmed = Object.fromEntries(
    Object.entries(raw).map(([key, series]) => [key, recentRun(series, now)]),
  ) as Record<string, Point[]>

  // Keep the series mutually aligned: they are sampled together, so a differing
  // length means one plugin has extra points the others cannot corroborate.
  const usable = Object.values(trimmed).filter((s) => s.length >= HISTORY_MIN_POINTS)
  if (usable.length === 0) return { points: 0, series: {} }
  const length = Math.min(points, ...usable.map((s) => s.length))

  return {
    points: length,
    series: Object.fromEntries(
      Object.entries(trimmed).map(([key, series]) => [
        key,
        series.length >= length ? series.slice(-length).map((p) => p.value) : [],
      ]),
    ),
  }
}
