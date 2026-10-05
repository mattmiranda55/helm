import { readonly, shallowRef } from 'vue'
import { fetchAppConfig } from '@/lib/api'
import { markFailed, markReached } from '@/lib/connection'

const DEFAULTS = {
  refreshMs: 5000,
  nodes: [],
  commands: [],
  services: [],
  terminal: { enabled: true },
  stacks: { template: null, envTemplate: null },
  thresholds: { fs: 90 },
}

const config = shallowRef(DEFAULTS)
const loaded = shallowRef(false)
const error = shallowRef(null)
let request = null

/** The server's public config, fetched once and shared by every page. */
export function useAppConfig() {
  request ??= fetchAppConfig()
    .then((value) => {
      markReached()
      config.value = { ...DEFAULTS, ...value }
    })
    .catch((cause) => {
      markFailed(cause)
      error.value = cause.message
    })
    .finally(() => {
      loaded.value = true
    })
  return { config: readonly(config), loaded: readonly(loaded), error: readonly(error) }
}
