import { computed, effectScope, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import { useMetrics } from './useMetrics'

/**
 * Polls every machine at once, for the pages that summarize all of them
 * (Machines, Apps). Each machine gets its own useMetrics poller, so the
 * finish-then-wait scheduling, abort-on-unmount, pause-when-hidden and
 * sparkline history all behave exactly as they do for a single machine.
 *
 * Machines are separate Glances instances, so polling them side by side does
 * not break the one-request-at-a-time rule — that rule is per machine, and
 * the server enforces it.
 */
export function useFleet(nodes, refreshMs) {
  const interval = computed(() => toValue(refreshMs))
  const pollers = new Map() // id -> { scope, api }
  const active = shallowRef({})

  watch(
    () => toValue(nodes).map((node) => node.id).join('\n'),
    () => {
      const ids = new Set(toValue(nodes).map((node) => node.id))
      for (const [id, poller] of pollers) {
        if (ids.has(id)) continue
        poller.scope.stop()
        pollers.delete(id)
      }
      for (const id of ids) {
        if (pollers.has(id)) continue
        const scope = effectScope(true)
        const api = scope.run(() => useMetrics(shallowRef(id), interval, null))
        pollers.set(id, { scope, api })
      }
      active.value = Object.fromEntries([...pollers].map(([id, { api }]) => [id, api]))
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    for (const { scope } of pollers.values()) scope.stop()
    pollers.clear()
  })

  /** { [id]: { metrics, error, misses, loading, capabilities } } */
  const snapshots = computed(() =>
    Object.fromEntries(
      Object.entries(active.value).map(([id, api]) => [
        id,
        {
          metrics: api.metrics.value,
          error: api.error.value,
          misses: api.misses.value,
          loading: api.loading.value,
          capabilities: api.capabilities.value,
        },
      ]),
    ),
  )

  return { snapshots }
}
