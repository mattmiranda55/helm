import { computed, toValue } from 'vue'
import { read } from '@/lib/history'

/**
 * Sparkline series for one machine. `metrics` is the tick signal: the ring
 * buffers in lib/history are plain arrays, so they are re-read whenever a new
 * snapshot lands.
 */
export function useHistory(nodeId, metrics, names) {
  return computed(() => {
    void toValue(metrics)
    const id = toValue(nodeId)
    return Object.fromEntries(names.map((name) => [name, id ? read(id, name) : []]))
  })
}
