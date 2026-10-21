<script setup>
/**
 * A native Ionic sheet modal: slides up from the bottom, drags down to close,
 * and on a wide screen (no breakpoints) becomes Ionic's centered dialog. Used
 * for anything you act on (a container, a stack) so the list behind it stays
 * put. https://ionicframework.com/docs/api/modal#sheet-modal
 *
 * Inline modal, controlled by `is-open`: the parent owns `open`, and Ionic
 * owns the dismissal. Every way out — swipe down, the backdrop, Escape, the
 * close button — goes through Ionic's dismiss, and `close` is emitted once,
 * from didDismiss, so the parent can set `open` back to false: is-open is a
 * one-way binding that Ionic never resets itself, and a stale true would
 * never reopen. https://ionicframework.com/docs/api/modal#using-isopen
 *
 * Sheet options:
 *   breakpoints / initial-breakpoint  0 is included so dragging down closes it
 *   expand-to-scroll=false            the content scrolls at any height,
 *                                     instead of a scroll first growing the sheet
 *   handle-behavior                   Ionic 9's default, "cycle": the handle
 *                                     is a focusable button that steps between
 *                                     0.6 and 0.92, so the sheet can be resized
 *                                     without dragging (#handle-behavior)
 *   presenting-element                not set: it is only for the iOS *card*
 *                                     modal, which a sheet is not
 *
 * Content is only rendered while the sheet is presented, but it *is*
 * re-rendered during the dismiss animation, so slot content should not assume
 * the data it shows is still non-null after `open` turns false.
 *
 * Slots: default (the body, padded) and `footer` (an ion-footer's contents,
 * for the sheet's primary actions so they stay reachable while it scrolls).
 */
import { IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/vue'
import { close } from 'ionicons/icons'
import { useTemplateRef } from 'vue'
import { useWide } from '@/composables/useWide'

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  /** Show the subtitle in the mono face (container image names). */
  monoSubtitle: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const wide = useWide()

// The Vue ref wraps the component; its $el is the <ion-modal> element, which
// has the methods (dismiss, setCurrentBreakpoint…).
const modal = useTemplateRef('modal')
const dismiss = () => modal.value?.$el.dismiss(undefined, 'cancel')
</script>

<template>
  <!-- Keyed on the layout: breakpoints can't be patched from an array to
       undefined (Ionic's breakpointsChanged would sort null), so crossing
       768px re-creates the modal as a sheet or a centered card instead. -->
  <ion-modal
    :key="wide ? 'card' : 'sheet'"
    ref="modal"
    :is-open="open"
    :breakpoints="wide ? undefined : [0, 0.6, 0.92]"
    :initial-breakpoint="wide ? undefined : 0.92"
    :expand-to-scroll="false"
    :aria-label="title"
    @did-dismiss="emit('close')"
  >
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title }}</ion-title>
        <ion-buttons slot="end">
          <ion-button aria-label="Close" @click="dismiss">
            <ion-icon slot="icon-only" :icon="close" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="body">
        <p v-if="subtitle" class="subtitle" :class="{ num: monoSubtitle }">{{ subtitle }}</p>
        <slot />
      </div>
    </ion-content>
    <ion-footer v-if="$slots.footer">
      <ion-toolbar class="footer">
        <slot name="footer" />
      </ion-toolbar>
    </ion-footer>
  </ion-modal>
</template>

<style scoped>
.body {
  /* Clear of the home indicator when there's no footer toolbar to do it. */
  padding: 12px 20px calc(20px + var(--ion-safe-area-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.subtitle {
  color: var(--color-muted);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
  margin-bottom: -8px;
}
.subtitle.num {
  font-size: 0.7812rem;
}
.footer {
  --padding-start: 16px;
  --padding-end: 16px;
  --padding-top: 8px;
  --padding-bottom: 8px;
}
</style>
