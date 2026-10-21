import { onScopeDispose, shallowRef } from 'vue'

/** True on a wide screen (≥768px), where the layout switches from phone to desktop. */
export function useWide() {
  const query = matchMedia('(min-width: 768px)')
  const wide = shallowRef(query.matches)
  const update = () => (wide.value = query.matches)
  query.addEventListener('change', update)
  onScopeDispose(() => query.removeEventListener('change', update))
  return wide
}
