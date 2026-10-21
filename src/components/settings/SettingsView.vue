<script setup>
/**
 * The frame of every page in the Settings modal's ion-nav: a navigation bar
 * (Back, title, the page's own buttons) and the scrolling content.
 *
 * A page pushed onto ion-nav is shaped like Ionic's nav examples:
 * ion-header + ion-content at the top level, with no <ion-page> around them.
 * ion-nav makes the page element itself — @ionic/vue's delegate teleports the
 * component into a <div class="ion-page"> that the nav creates, animates and
 * marks `can-go-back` — so this component is a two-root fragment that lands
 * directly in that div. (IonPage is what ion-router-outlet needs to find a
 * routed page; nothing here is routed.)
 * https://ionicframework.com/docs/api/nav#using-navlink
 *
 * Back is a plain ion-back-button: inside an ion-nav it pops the nav instead
 * of going through the router (@ionic/vue checks closest('ion-nav')), and it
 * only shows on pages the nav has marked `can-go-back`, so the root has none.
 * https://ionicframework.com/docs/api/back-button
 *
 * `guarded` (unsaved edits): ion-back-button has no way to be refused, so
 * while there's something to lose it is swapped for an ion-button that looks
 * the same, asks, and then pops. See useUnsavedGuard in editing.js.
 *
 * Collapsible large title: same recipe as HelmPage (translucent header,
 * fullscreen content, a second condense header inside the content).
 * https://ionicframework.com/docs/api/title#collapsible-large-titles
 *
 * Slots: default (the body, inside the gutter), `end` (toolbar buttons:
 * Save, Add, Done).
 */
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/vue'
import { chevronBack } from 'ionicons/icons'
import { confirmDiscard, leave } from './editing'

defineProps({
  title: { type: String, default: '' },
  /** The title is a name (a machine's), so browsers shouldn't translate it. */
  literalTitle: { type: Boolean, default: false },
  /** The back button's text (the page underneath); null on the root. */
  backText: { type: String, default: null },
  largeTitle: { type: Boolean, default: true },
  /** Unsaved edits: Back asks before leaving. */
  guarded: { type: Boolean, default: false },
})

async function guardedBack() {
  if (await confirmDiscard()) leave()
}
</script>

<template>
  <ion-header :translucent="true">
    <ion-toolbar>
      <ion-buttons v-if="backText !== null" slot="start">
        <ion-button v-if="guarded" class="guarded-back" @click="guardedBack">
          <ion-icon slot="start" :icon="chevronBack" aria-hidden="true" />{{ backText }}
        </ion-button>
        <ion-back-button v-else :text="backText" />
      </ion-buttons>
      <ion-title role="heading" aria-level="1" :translate="literalTitle ? 'no' : undefined">{{ title }}</ion-title>
      <ion-buttons slot="end">
        <slot name="end" />
      </ion-buttons>
    </ion-toolbar>
  </ion-header>

  <ion-content :fullscreen="true">
    <ion-header v-if="largeTitle" collapse="condense">
      <ion-toolbar>
        <ion-title size="large" role="heading" aria-level="1" :translate="literalTitle ? 'no' : undefined">
          {{ title }}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <div class="body">
      <slot />
    </div>
  </ion-content>
</template>

<style scoped>
.body {
  /* Clear of the home indicator at the bottom of the card. */
  padding: 4px 16px calc(28px + var(--ion-safe-area-bottom, 0px));
}
@media (min-width: 768px) {
  .body {
    padding-inline: 24px;
  }
}
/* ion-back-button's own iOS metrics (back-button.ios.css: icon 1.6em,
   margins -4px / 1px), so swapping to this button doesn't move anything. */
.guarded-back {
  --padding-start: 0;
}
.guarded-back ion-icon[slot='start'] {
  font-size: 1.6em;
  margin-inline: -4px 1px;
}
</style>
