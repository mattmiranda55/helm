/**
 * A few lines of routing instead of a dependency.
 *
 * Real paths (/apps, /machines/basestation) so pages can be bookmarked and
 * opened from a notification; the server already answers any non-/api path
 * with the app shell. Query strings carry page state (which machine, which
 * filter) so that is linkable too.
 */
import { computed, shallowRef } from 'vue'
import { token } from './api'

const ROUTES = [
  { name: 'machines', pattern: /^\/$/ },
  { name: 'machine', pattern: /^\/machines\/([^/]+)\/?$/, keys: ['id'] },
  { name: 'apps', pattern: /^\/apps\/?$/ },
  { name: 'containers', pattern: /^\/containers\/?$/ },
  { name: 'terminal', pattern: /^\/terminal\/?$/ },
]

function parse(url) {
  const query = Object.fromEntries(url.searchParams)
  for (const route of ROUTES) {
    const match = url.pathname.match(route.pattern)
    if (!match) continue
    const params = Object.fromEntries(
      (route.keys ?? []).map((key, i) => [key, decodeURIComponent(match[i + 1])]),
    )
    return { name: route.name, params, query, path: url.pathname }
  }
  return { name: 'not-found', params: {}, query, path: url.pathname }
}

/**
 * Links from the single-page version (`/?node=x&tab=terminal`) still land
 * somewhere sensible. The token, once api.js has remembered it, is dropped
 * from the address bar so it doesn't end up in bookmarks or screenshots.
 */
function initialUrl() {
  const url = new URL(location.href)
  const { node, tab } = Object.fromEntries(url.searchParams)
  if (url.pathname === '/' && tab === 'terminal') url.pathname = '/terminal'
  else if (url.pathname === '/' && node) url.pathname = `/machines/${encodeURIComponent(node)}`
  for (const key of ['node', 'tab', 'token']) url.searchParams.delete(key)
  if (url.href !== location.href) history.replaceState(null, '', url)
  void token
  return url
}

const current = shallowRef(parse(initialUrl()))

window.addEventListener('popstate', () => {
  current.value = parse(new URL(location.href))
})

export const route = computed(() => current.value)

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin)
  if (url.href === location.href) return
  history[replace ? 'replaceState' : 'pushState'](null, '', url)
  current.value = parse(url)
}

/** Merge into the current query without adding a history entry. */
export function setQuery(patch) {
  const url = new URL(location.href)
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  navigate(url.pathname + url.search, { replace: true })
}
