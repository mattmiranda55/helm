import { readonly, shallowRef } from 'vue'
import { fetchAppConfig } from '@/lib/api'
import { markFailed, markReached } from '@/lib/connection'

const DEFAULTS = {
  refreshMs: 5000,
  nodes: [],
  commands: [],
  services: [],
  terminal: { enabled: true },
  // The server always sends the effective templates (its built-in default
  // when none is configured); these empties only cover the moment before the
  // first fetch lands, and a server too old to send them.
  stacks: { template: '', envTemplate: '', templateIsDefault: true, dir: null },
  thresholds: { fs: 90 },
}

const config = shallowRef(DEFAULTS)
const loaded = shallowRef(false)
const error = shallowRef(null)
let request = null
/** Only the latest fetch may write the shared refs (a reload can overtake the first load). */
let latest = 0

function load() {
  const mine = ++latest
  return fetchAppConfig()
    .then((value) => {
      markReached()
      if (mine !== latest) return
      config.value = { ...DEFAULTS, ...value }
      error.value = null
    })
    .catch((cause) => {
      markFailed(cause)
      if (mine === latest) error.value = cause.message
    })
    .finally(() => {
      if (mine === latest) loaded.value = true
    })
}

/** The server's public config, fetched once and shared by every page. */
export function useAppConfig() {
  request ??= load()
  return { config: readonly(config), loaded: readonly(loaded), error: readonly(error) }
}

/**
 * Fetch the config again and update every page using it — after Settings
 * saves a change, so Machines/Apps/Terminal pick it up without a reload.
 * Resolves once the shared refs hold the new config (or the error).
 */
export function reloadAppConfig() {
  request = load()
  return request
}
