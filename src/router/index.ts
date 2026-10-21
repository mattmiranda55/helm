// createRouter from @ionic/vue-router, not vue-router: Ionic's wrapper is what
// tracks push/back/tab direction so ion-router-outlet can animate pages and
// keep a stack per tab. https://ionicframework.com/docs/vue/navigation
import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import TabsPage from '@/components/layout/TabsPage.vue'
import { tokenPending } from '@/components/setup/wizardStore'
import { fetchHealth } from '@/lib/api'

/**
 * Real paths (/apps, /machines/basestation) so pages can be bookmarked and
 * opened from a notification; the server already answers any non-/api path
 * with the app shell. Query strings carry page state (which machine, which
 * filter) so that is linkable too.
 *
 * Everything lives under the tabs so the tab bar is always there — except the
 * first-run setup, which is full screen. Route names are what TabsPage's
 * document titles match against.
 *
 * Tab routes follow Ionic's rule for child pages: siblings that share the
 * tab's path prefix (machines, machines/:id), not nested children, so the
 * Machines tab stays selected on a machine's page.
 * https://ionicframework.com/docs/vue/navigation#child-routes-within-tabs
 *
 * Settings has no routes: every tab can open it, and Ionic's rule for a view
 * shared by all tabs is a modal, not a route pushed onto whichever tab you're
 * in. Its pages (machines, apps, commands, stacks) are a stack inside that
 * https://ionicframework.com/docs/vue/navigation#switching-between-tabs
 *
 * The shell (TabsPage) is imported eagerly; every page is lazy-loaded, so the
 * first paint only downloads the page it shows.
 */
const routes: Array<RouteRecordRaw> = [
  { path: '/setup', name: 'setup', component: () => import('@/pages/SetupPage.vue') },
  {
    path: '/',
    component: TabsPage,
    children: [
      { path: '', redirect: '/machines' },
      { path: 'machines', name: 'machines', component: () => import('@/pages/MachinesPage.vue') },
      { path: 'machines/:id', name: 'machine', component: () => import('@/pages/MachinePage.vue'), props: true },
      { path: 'apps', name: 'apps', component: () => import('@/pages/AppsPage.vue') },
      { path: 'containers', name: 'containers', component: () => import('@/pages/ContainersPage.vue') },
      { path: 'terminal', name: 'terminal', component: () => import('@/pages/TerminalPage.vue') },
      { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFoundPage.vue') },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

/**
 * Guards return a location (or nothing) instead of calling next(), which
 * vue-router 5 deprecates.
 *
 * Links from the single-page version (`/?node=x&tab=terminal`) still land
 * somewhere sensible. The token, once api.js has remembered it, is dropped
 * from the address bar so it doesn't end up in bookmarks or screenshots.
 */
let first = true
router.beforeEach((to) => {
  if (!first) return
  first = false
  const { token, ...rest } = to.query
  if (to.path === '/' || to.path === '/machines') {
    const { node, tab, ...query } = rest
    if (tab === 'terminal') return { path: '/terminal', query, replace: true }
    if (typeof node === 'string') return { path: `/machines/${encodeURIComponent(node)}`, query, replace: true }
    if (tab != null || node != null || token != null) return { path: to.path, query, replace: true }
  }
  if (token != null) return { path: to.path, query: rest, hash: to.hash, replace: true }
})

/**
 * First run: until the server has a config, every route goes to /setup; once
 * it has one, /setup goes to /machines. /api/health is open (no token), so
 * this works before there is one. Asked once per page load — finishing setup
 * reloads the app. If the server can't be reached, nothing is blocked: the
 * pages already explain an offline server.
 *
 * A finished setup whose new token hasn't been shown yet keeps /setup open,
 * so a reload on that screen doesn't lose the only copy.
 */
let setupCheck: Promise<boolean | null> | null = null
function setupNeeded(): Promise<boolean | null> {
  setupCheck ??= (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const health = await fetchHealth({ signal: controller.signal })
      return health?.setup === true
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  })()
  return setupCheck
}

router.beforeEach(async (to) => {
  const needed = await setupNeeded()
  if (needed === null) return
  if (needed && to.name !== 'setup') return { name: 'setup', replace: true }
  if (!needed && to.name === 'setup' && !tokenPending()) return { path: '/machines', replace: true }
})

export default router
