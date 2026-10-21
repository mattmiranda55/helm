import { onScopeDispose, ref, shallowRef, toValue, watch } from 'vue'
import { fetchCapabilities, fetchHistory, fetchMetrics, fetchProcesses } from '@/lib/api'
import { HISTORY_LENGTH, isSeeded, push, seed } from '@/lib/history'
import { markFailed, markReached } from '@/lib/connection'

/**
 * Polls one node. The active node is reactive, so switching machines cancels
 * the in-flight request rather than letting a slow response from the old node
 * land on top of the new one.
 *
 * Polling is self-scheduling (finish, then wait) instead of setInterval, so a
 * node that is slow or unreachable can never stack up overlapping requests, and
 * it stops entirely while the tab is hidden.
 *
 * `wantProcesses` gates the process list: it is by far the most expensive thing
 * Glances can be asked for (~89ms of the watched machine's CPU per call), so it
 * is fetched only while that panel is actually open.
 *
 * `active` pauses polling while the page is not on screen. Ionic keeps a tab's
 * pages mounted after you leave them, so without it every page you had visited
 * would keep polling in the background. Pass usePageActive() from a page.
 */
export function useMetrics(nodeId, refreshMs, wantProcesses, active) {
  const metrics = shallowRef(null)
  const processes = shallowRef([])
  const error = ref(null)
  const loading = ref(true)
  /** Consecutive failures — one blip should not blank a populated dashboard. */
  const misses = ref(0)
  /** What this server can do to the node — container control needs to be local. */
  const capabilities = ref({ containers: false, local: false })

  let controller = null
  let timer = null
  let generation = 0
  let calls = 0

  function recordHistory(snapshot) {
    const id = snapshot.node.id
    push(id, 'cpu', snapshot.cpu.total)
    push(id, 'mem', snapshot.mem.percent)
    const net = snapshot.network.reduce(
      (acc, iface) => ({ rx: acc.rx + iface.rx, tx: acc.tx + iface.tx }),
      { rx: 0, tx: 0 },
    )
    push(id, 'net.rx', net.rx)
    push(id, 'net.tx', net.tx)
    const io = snapshot.disks.reduce(
      (acc, disk) => ({ read: acc.read + disk.read, write: acc.write + disk.write }),
      { read: 0, write: 0 },
    )
    push(id, 'disk.read', io.read)
    push(id, 'disk.write', io.write)
  }

  /**
   * Fill the charts from Glances' own history so they are not blank for the
   * first minute. Fired alongside the first poll rather than before it, so a
   * slow or empty history never delays the dashboard appearing.
   *
   * It only helps when something polled the node recently — Glances records
   * history on request, not on a timer — so this covers reloads and tab
   * switches, not a cold open after hours away.
   */
  async function prime(id, mine) {
    if (isSeeded(id)) return
    try {
      const { series } = await fetchHistory(id, HISTORY_LENGTH)
      if (mine !== generation) return
      for (const [name, values] of Object.entries(series ?? {})) seed(id, name, values)
      // Re-publish so the charts pick the backfill up immediately.
      if (metrics.value) metrics.value = { ...metrics.value }
    } catch {
      seed(id, null, null) // mark as attempted; do not retry every tick
    }
  }

  async function tick(id, mine) {
    controller?.abort()
    controller = new AbortController()
    const { signal } = controller

    try {
      const [snapshot, processList] = await Promise.all([
        fetchMetrics(id, { signal }),
        wantProcesses?.value ? fetchProcesses(id, 20, { signal }).catch(() => []) : null,
      ])
      if (mine !== generation) return

      markReached()
      recordHistory(snapshot)
      metrics.value = snapshot
      if (processList) processes.value = processList
      error.value = null
      misses.value = 0
    } catch (cause) {
      if (signal.aborted || mine !== generation) return
      markFailed(cause)
      misses.value += 1
      error.value = cause.message ?? String(cause)
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  const paused = () => document.hidden || (active != null && !toValue(active))

  /** Fetch now and restart the wait; resolves once that fetch has landed (pull-to-refresh). */
  function schedule() {
    clearTimeout(timer)
    if (paused()) return
    const id = nodeId.value
    if (!id) {
      loading.value = false
      return
    }
    const mine = generation
    // A newer schedule() (pull-to-refresh, opening processes) aborts this one;
    // only the latest call may arm the next tick, or polling would double up.
    const call = ++calls
    return tick(id, mine).finally(() => {
      if (mine !== generation || call !== calls) return
      timer = setTimeout(schedule, Math.max(refreshMs.value ?? 3000, 1000))
    })
  }

  // Opening the process panel should fill it now, not on the next tick.
  watch(
    () => wantProcesses?.value,
    (wanted) => {
      if (wanted) schedule()
      else processes.value = []
    },
  )

  watch(
    nodeId,
    (id) => {
      generation += 1
      controller?.abort()
      metrics.value = null
      processes.value = []
      error.value = null
      misses.value = 0
      loading.value = true
      capabilities.value = { containers: false, local: false }
      // No machine yet (config still loading): nothing to poll, prime or ask about.
      if (!id) {
        loading.value = false
        return
      }
      schedule()
      prime(id, generation)

      const mine = generation
      fetchCapabilities(id)
        .then((caps) => {
          if (mine === generation) capabilities.value = caps
        })
        .catch(() => {})
    },
    { immediate: true },
  )

  // Coming back to the page refreshes now rather than a tick later.
  if (active != null) {
    watch(
      () => toValue(active),
      (on) => {
        if (on) schedule()
        else clearTimeout(timer)
      },
    )
  }

  // A backgrounded tab should not keep hammering every node it ever showed.
  function onVisibility() {
    if (document.hidden) {
      clearTimeout(timer)
    } else {
      schedule()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  onScopeDispose(() => {
    generation += 1
    clearTimeout(timer)
    controller?.abort()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { metrics, processes, error, loading, misses, capabilities, refresh: schedule }
}
