/**
 * What the Settings pages (Machines, a machine, Apps, Commands, Stacks)
 * share: the unsaved-changes guard, going back, refreshing after a save, the
 * wording of a failed load or save, the save itself (then refreshing the
 * app's cached config), and a few small helpers.
 */
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import { cleanUrl, urlOnThisHost } from '@/components/setup/validate'
import { reloadAppConfig, useAppConfig } from '@/composables/useAppConfig'
import { useConfirm } from '@/composables/useConfirm'
import { settingsNav, trackUnsaved } from '@/composables/useSettings'
import { saveEditableConfig } from '@/lib/api'

/** A deep copy through JSON, for snapshots and "what changed" comparisons. */
export const clone = (value) => JSON.parse(JSON.stringify(value ?? null))

/** A load or save failure, in words. `.status` comes from api.js `call`. */
export function describeError(cause, doing = 'save') {
  if (cause?.status === 401) return 'helm refused this device’s token. Check it under Connection in Settings.'
  if (cause?.status === 409) return cause.message
  if (cause?.status === 400) return cause.message
  const verb = doing === 'load' ? 'load the settings' : 'save'
  return `Couldn’t ${verb}: ${cause?.message ?? String(cause)}`
}

/**
 * Write the edited lists (only the ones given), then refetch the app's
 * cached config so every page shows the change.
 */
export async function saveConfig(patch) {
  await saveEditableConfig(patch)
  await reloadAppConfig()
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Whether a node is the machine helm runs on, as far as the browser can
 * tell: `local` when the config says so, else a loopback Glances address.
 * (The server's own check also compares Glances' hostname; this is only
 * for the "This server" badge and which container suggestions to offer.)
 */
export function isLocalNode(node) {
  if (typeof node?.local === 'boolean') return node.local
  try {
    return LOOPBACK.has(new URL(cleanUrl(node?.url)).hostname)
  } catch {
    return false
  }
}

/** The one question every way out of unsaved edits asks. */
export function confirmDiscard() {
  return useConfirm().confirm({
    header: 'Discard your changes?',
    message: 'They haven’t been saved.',
    action: 'Discard Changes',
  })
}

/**
 * Protect a Settings page's unsaved edits.
 *
 *   const { guarded, allowLeave } = useUnsavedGuard(dirty)
 *
 * There is no router in the Settings modal, so there is no route guard to
 * hook into. Instead each way out is covered by the Ionic piece that owns it:
 *
 *   - Done, swipe down, Escape: the modal's `canDismiss` (SettingsModal)
 *     asks while any page registered here is dirty.
 *     https://ionicframework.com/docs/api/modal#preventing-a-modal-from-dismissing
 *   - Back in the nav bar: ion-back-button pops ion-nav itself, with no hook
 *     to refuse, so while `guarded` SettingsView swaps it for an ion-button
 *     that asks first and then calls nav.pop().
 *   - The iOS edge swipe back: ion-nav's `swipe-gesture` is turned off while
 *     anything is dirty (SettingsModal). The swipe animates the page away as
 *     you drag, so it can't be asked about afterwards.
 *     https://ionicframework.com/docs/api/nav#properties
 *   - Reloading or closing the browser tab: that isn't Ionic's to handle, so
 *     the browser's own beforeunload prompt.
 *
 * Call `allowLeave()` just before leaving on purpose (after a delete).
 */
export function useUnsavedGuard(dirty) {
  const bypass = shallowRef(false)
  const guarded = computed(() => !bypass.value && !!dirty.value)
  trackUnsaved(guarded)

  const onBeforeUnload = (event) => {
    if (!guarded.value) return
    event.preventDefault()
    event.returnValue = ''
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

  return {
    guarded,
    allowLeave() {
      bypass.value = true
    },
  }
}

/**
 * Back to the page underneath, after a save or delete. ion-nav is a plain
 * stack with no URL, so this is just pop().
 * https://ionicframework.com/docs/api/nav#pop
 */
export function leave() {
  return settingsNav()?.pop()
}

/**
 * Push a Settings page from code, for the places <ion-nav-link> doesn't fit
 * (list rows — see SettingsRoot). `props` become the component's props.
 * https://ionicframework.com/docs/api/nav#push
 */
export function pushPage(component, props, opts) {
  return settingsNav()?.push(component, props, opts)
}

/**
 * Refresh a list page when Settings saves something, e.g. Machines after a
 * machine's page saved and popped back to it.
 *
 * Ionic Vue's onIonViewWillEnter would be the natural hook, but it only fires
 * for pages rendered by ion-router-outlet: @ionic/vue calls the hooks from the
 * outlet, and ion-nav (which only dispatches DOM events on its own wrapper
 * element) never reaches them. https://ionicframework.com/docs/vue/lifecycle
 * Every save goes through saveConfig(), which ends by reloading the shared
 * app config, so watching that is "something was saved" — and it already
 * holds the new values by the time the page underneath is shown again.
 *
 * flush: 'sync' runs `reload` the moment the config is replaced, i.e. while
 * the saving page's own `saving` flag is still set — so a page's load(),
 * which skips itself while saving or dirty, never reloads over its own save.
 */
export function onConfigSaved(reload) {
  const { config } = useAppConfig()
  watch(config, () => reload(), { flush: 'sync' })
}

/**
 * ServicesEditor suggestions from this machine's containers (Local): a
 * container publishing a port becomes a toggle with its address filled in.
 * The same mapping the setup wizard uses.
 */
export function localSuggestions(local) {
  return (local?.containers ?? []).map((container) => {
    const ports = container.ports ?? []
    const bits = [container.image, container.status !== 'running' ? container.status : null]
    if (!ports.length) return { name: container.name, container: container.name, detail: bits.filter(Boolean).join(' · ') }
    bits.unshift(ports.length > 1 ? `ports ${ports.join(', ')}` : `port ${ports[0]}`)
    return {
      name: container.name,
      container: container.name,
      url: urlOnThisHost(ports[0]),
      detail: bits.filter(Boolean).join(' · '),
    }
  })
}

/** Suggestions from another machine's Glances probe: names only, helm can't know their addresses. */
export const probeSuggestions = (probe) =>
  probe?.ok ? (probe.containers ?? []).map((c) => ({ name: c.name, container: c.name, detail: c.image ?? '' })) : []

/** A service that was added and never typed into. */
export const blankService = (s) => !s.name?.trim() && !s.url?.trim() && !s.container?.trim()

/** A node as Settings sends it back: no hasPassword, and no password unless one is given. */
export function outgoingNode(node, password) {
  const out = { id: node.id, label: String(node.label ?? '').trim(), url: cleanUrl(node.url), api: node.api ?? 4 }
  if (typeof node.local === 'boolean') out.local = node.local
  const username = String(node.username ?? '').trim()
  if (username) out.username = username
  if (password !== undefined) out.password = password
  return out
}

/** A service as Settings sends it back: trimmed, stamped with its node. */
export function outgoingService(service, nodeId) {
  const out = { ...service, name: String(service.name ?? '').trim(), url: String(service.url ?? '').trim() }
  if (nodeId) out.node = nodeId
  else delete out.node
  return out
}

/** Scroll the first highlighted field into view once the errors have rendered. */
export async function revealInvalid(root = document) {
  await nextTick()
  root.querySelector?.('.ion-invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
