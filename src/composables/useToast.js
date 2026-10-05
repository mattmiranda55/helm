import { readonly, shallowRef } from 'vue'

const message = shallowRef(null)
let timer = null

/** One short confirmation at a time, e.g. "Restarted navidrome". */
export function useToast() {
  function show(text, ms = 2600) {
    message.value = text
    clearTimeout(timer)
    timer = setTimeout(() => (message.value = null), ms)
  }
  return { message: readonly(message), show }
}
