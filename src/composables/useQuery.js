import { computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * This page's query string, as reactive state, plus a setter that merges into
 * it without adding a history entry.
 *
 * Ionic keeps pages mounted after you leave them, and useRoute() is always the
 * *current* route, so a page reading route.query directly would see another
 * page's query (and react to it) while it sits in the background. This keeps
 * the last query seen while this page's own path was current.
 */
export function useQuery() {
  const route = useRoute()
  const router = useRouter()
  const path = route.path
  const query = shallowRef({ ...route.query })

  watch(
    () => [route.path, route.fullPath],
    () => {
      if (route.path === path) query.value = { ...route.query }
    },
  )

  /**
   * Merge into the current query; null or '' removes a key.
   *
   * vue-router's replace(), not useIonRouter().replace(): Ionic's replace
   * navigates with direction "root", which animates a page transition. Plain
   * router.replace() reaches Ionic with direction "none", and the path is
   * unchanged, so the outlet keeps the same page and nothing moves.
   */
  function setQuery(patch) {
    const next = { ...query.value }
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === '') delete next[key]
      else next[key] = String(value)
    }
    query.value = next
    router.replace({ path, query: next })
  }

  return { query: computed(() => query.value), setQuery }
}
