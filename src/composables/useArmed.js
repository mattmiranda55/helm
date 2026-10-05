import { onScopeDispose, readonly, shallowRef } from 'vue'

/**
 * Tap-again confirmation for destructive actions, instead of a dialog: the
 * first tap turns the button into "Tap again to stop", the second does it,
 * and it quietly disarms after a few seconds.
 */
export function useArmed(timeoutMs = 3500) {
  const armed = shallowRef(null)
  let timer = null

  function disarm() {
    clearTimeout(timer)
    armed.value = null
  }

  /** Returns true when this tap should go ahead (the key was already armed). */
  function confirm(key) {
    if (armed.value === key) {
      disarm()
      return true
    }
    clearTimeout(timer)
    armed.value = key
    timer = setTimeout(disarm, timeoutMs)
    return false
  }

  onScopeDispose(() => clearTimeout(timer))

  return { armed: readonly(armed), confirm, disarm }
}
