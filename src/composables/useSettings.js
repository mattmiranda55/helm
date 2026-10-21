import { computed, onBeforeUnmount, shallowReactive, shallowRef } from 'vue'

/**
 * The app's one Settings modal: open it from anywhere, optionally straight
 * to a section.
 *
 *   const { open } = useSettings()
 *   open()            // the Settings root
 *   open('machines')  // Settings, with Machines pushed on top
 *
 * Why a modal and not a route: Settings is reachable from every tab, and
 * Ionic's rule is that a view shared by all tabs must not be routed into
 * whichever tab you happen to be on (that would put it on that tab's stack,
 * and the tab bar would point at the wrong place). A modal sits above the
 * tabs instead. https://ionicframework.com/docs/vue/navigation#switching-between-tabs
 *
 * The modal itself lives once in TabsPage (SettingsModal.vue, lazy-loaded the
 * first time it opens); this module is just the shared state between it and
 * the buttons that open it. Module-level refs, so every caller sees the same
 * modal.
 */

const isOpen = shallowRef(false)
/** True from the first open on, so TabsPage only loads the modal's code once it's wanted. */
const requested = shallowRef(false)
/** The section to push after the root, taken once by the root page. */
let pendingSection = null

/** Set by SettingsModal: how to dismiss it, and where its ion-nav is. */
let host = { dismiss: null, nav: () => null }

export function useSettings() {
  function open(section = null) {
    if (isOpen.value) return
    pendingSection = section
    requested.value = true
    isOpen.value = true
  }
  /** Goes through the modal's own dismiss, so canDismiss (unsaved edits) still asks. */
  function close() {
    return host.dismiss?.()
  }
  return { open, close, isOpen, requested }
}

// ------------------------------------------------------------ for the modal

/** SettingsModal registers itself; it calls the returned `dismissed()` from didDismiss. */
export function registerSettingsHost(next) {
  host = next
  return {
    dismissed() {
      isOpen.value = false
      pendingSection = null
    },
  }
}

/** The section open() asked for, once (the root page pushes it). */
export function takeSettingsSection() {
  const section = pendingSection
  pendingSection = null
  return section
}

/**
 * The modal's <ion-nav> element, for the programmatic API (push, pop) where
 * <ion-nav-link> doesn't fit. https://ionicframework.com/docs/api/nav#methods
 */
export function settingsNav() {
  return host.nav()
}

// ------------------------------------------------------------ unsaved edits

/** Every mounted Settings page's "has unsaved edits" ref. */
const unsaved = shallowReactive(new Set())

/** Whether any page in the Settings stack has edits that would be lost. */
export const hasUnsavedSettings = computed(() => [...unsaved].some((dirty) => dirty.value))

/**
 * Register a page's dirty ref for as long as the page is mounted. Each push
 * onto ion-nav creates a fresh component instance and each pop unmounts it,
 * so mount/unmount is exactly "on the stack".
 */
export function trackUnsaved(dirty) {
  unsaved.add(dirty)
  onBeforeUnmount(() => unsaved.delete(dirty))
}
