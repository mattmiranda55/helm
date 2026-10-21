<script setup>
/**
 * Settings, as one modal over the whole app with its own navigation stack.
 * Hosted once by TabsPage; opened and closed through useSettings().
 *
 * Why a modal: Settings can be opened from every tab, and Ionic says a view
 * shared by all tabs should be a modal rather than a route pushed onto
 * whichever tab you're in. https://ionicframework.com/docs/vue/navigation#switching-between-tabs
 *
 * The iOS card modal (`presenting-element`): the app behind scales back and
 * the card can be swiped down to close. It is UIKit's page sheet, the form
 * iOS uses for a self-contained task with its own navigation bar and a Done
 * button (an app's settings, a compose screen). A sheet modal with
 * breakpoints (BottomSheet.vue) is for a quick action over content you still
 * want to see, and a half-height Settings form would mostly be scrolling.
 * The presenting element is TabsPage's ion-page, so the tab bar scales back
 * with the rest. https://ionicframework.com/docs/api/modal#card-modal
 *
 * Inline modal controlled by `is-open`, like BottomSheet: Ionic owns the
 * dismissal, and didDismiss tells useSettings it's closed (is-open is
 * one-way; Ionic never resets it). The contents are only rendered while the
 * modal is presented, so every open starts from a fresh ion-nav at the root.
 * https://ionicframework.com/docs/api/modal#using-isopen
 *
 * ion-nav, not the router: inside the modal, Settings → Machines → a machine
 * is a stack of its own. ion-nav keeps it — push/pop transitions, the
 * back button, the iOS edge swipe — without touching the URL, which is
 * exactly right for a modal (the page behind keeps its address). It has
 * never been a router, and is "not meant to be used for routing".
 * https://ionicframework.com/docs/api/nav (Navigation within a Modal)
 * `root` takes the component itself; markRaw keeps Vue from making a
 * component definition reactive, as the Vue examples there do.
 *
 * Unsaved edits: `can-dismiss` is a function, so every way of closing — Done,
 * swiping the card down, Escape — asks first while a page has unsaved edits.
 * When it resolves false the card springs back. The nav's own back swipe is
 * off while anything is unsaved (`swipe-gesture`), and Back on such a page
 * asks (SettingsView). https://ionicframework.com/docs/api/modal#preventing-a-modal-from-dismissing
 */
import { IonModal, IonNav } from '@ionic/vue'
import { markRaw, useTemplateRef } from 'vue'
import { confirmDiscard } from './editing'
import SettingsRoot from './SettingsRoot.vue'
import { hasUnsavedSettings, registerSettingsHost, useSettings } from '@/composables/useSettings'

defineProps({
  /** The element the iOS card modal scales back (TabsPage's ion-page). */
  presentingElement: { default: null },
})

const root = markRaw(SettingsRoot)
const { isOpen } = useSettings()

// The Vue refs wrap the components; $el is the <ion-modal> / <ion-nav>
// element, which has the methods (dismiss, push, pop…).
const modal = useTemplateRef('modal')
const nav = useTemplateRef('nav')

const host = registerSettingsHost({
  dismiss: () => modal.value?.$el.dismiss(undefined, 'cancel'),
  nav: () => nav.value?.$el ?? null,
})

/** Resolves true to let the modal close. `role` is 'gesture' for a swipe down. */
async function canDismiss() {
  if (!hasUnsavedSettings.value) return true
  return confirmDiscard()
}
</script>

<template>
  <ion-modal
    ref="modal"
    class="settings-modal"
    :is-open="isOpen"
    :presenting-element="presentingElement ?? undefined"
    :can-dismiss="canDismiss"
    aria-label="Settings"
    @did-dismiss="host.dismissed()"
  >
    <ion-nav ref="nav" :root="root" :swipe-gesture="!hasUnsavedSettings" />
  </ion-modal>
</template>

<style>
/*
 * Settings is a grouped list, like iOS Settings: inset groups of surface-
 * colored rows on the plane color, the same as the pages behind. helm's
 * modals are otherwise all surface (variables.css), so this one puts the
 * page colors back. The selector matches that rule's specificity plus a class.
 */
:root.ios ion-modal.settings-modal,
:root.md ion-modal.settings-modal {
  --ion-background-color: var(--color-plane);
  --ion-toolbar-background: var(--color-plane);
  --ion-item-background: var(--color-surface);
}
/* On a tablet or desktop the card is a centered dialog; Ionic's default
   600×500 is too short for a form, so give it room. */
@media (min-width: 768px) and (min-height: 600px) {
  ion-modal.settings-modal {
    --width: min(680px, 100% - 64px);
    --height: min(860px, 100% - 64px);
  }
}
</style>
