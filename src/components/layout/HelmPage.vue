<script setup>
/**
 * Every page's frame: an Ionic page with a native iOS navigation bar (back
 * button, title, whether the server is answering, Settings) and the large
 * title that collapses into it as you scroll.
 *
 * Structure is Ionic's page shell: ion-page > ion-header + ion-content, with
 * ion-content the only thing that scrolls.
 * https://ionicframework.com/docs/vue/navigation (IonPage)
 * https://ionicframework.com/docs/layout/structure
 *
 * ion-page must stay this component's single root, with attribute fallthrough
 * left on. The router outlet hands each routed page a `registerIonPage` prop;
 * a page whose root is <HelmPage> passes it down as an attribute to here, and
 * that is how the outlet finds the page element to animate and to fire the
 * Ionic lifecycle hooks (onIonViewWillEnter…) on the routed page itself.
 *
 * Collapsible large title (iOS): a translucent header, fullscreen content
 * (so it scrolls under the header), and a second header inside the content
 * with collapse="condense" and a size="large" title. Ionic swaps which of the
 * two titles is shown (and hidden from VoiceOver) as you scroll. The
 * toolbar's background must match the content's — both are the plane color
 * (variables.css). https://ionicframework.com/docs/api/title#collapsible-large-titles
 *
 * The title carries role="heading" aria-level="1": Ionic does not make
 * ion-title a heading itself, and pages start their sections at h2.
 * https://ionicframework.com/docs/api/title#headings
 *
 * Slots:
 *   default  the page body, inside the gutter
 *   actions  extra toolbar buttons (ion-button), before Settings
 *   fixed    direct children of ion-content, e.g. <ion-refresher slot="fixed">
 *            (Ionic expects it there; the default slot is inside the gutter).
 *            Ionic's `fixed` slot is for things placed outside the scroll
 *            area — a refresher, a FAB. https://ionicframework.com/docs/api/content#fixed-content
 *
 * `fill` (the terminal) sets scroll-y="false" on ion-content, Ionic's switch
 * for turning its scrolling off, so a full-height widget that scrolls itself
 * (xterm) fills the page in normal flow — not in the fixed slot, which would
 * take it out of the layout. https://ionicframework.com/docs/api/content#properties
 *
 * Shell-wide notices (config failed to load, no machines configured) show
 * above the body so every page explains itself the same way.
 *
 * Settings is a modal over every tab, not a page (useSettings explains why),
 * so its button opens it instead of linking anywhere.
 */
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { settingsOutline } from 'ionicons/icons'
import { computed } from 'vue'
import StatusText from '@/components/ui/StatusText.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useSettings } from '@/composables/useSettings'
import { connection } from '@/lib/connection'

const props = defineProps({
  title: { type: String, default: '' },
  /** The title is a name (a machine's), so browsers shouldn't translate it. */
  literalTitle: { type: Boolean, default: false },
  /** Show a back button to this path (its default when there's no history). */
  back: { type: String, default: null },
  backText: { type: String, default: 'Back' },
  /** The iOS large title above the content. Off for pages that don't scroll. */
  largeTitle: { type: Boolean, default: true },
  /** Fill the viewport without scrolling (the terminal). */
  fill: { type: Boolean, default: false },
  /** Show the shell notices above the body. */
  notices: { type: Boolean, default: true },
})

const { config, loaded, error } = useAppConfig()
const { open: openSettings } = useSettings()
const condensed = computed(() => props.largeTitle && !props.fill && !!props.title)

const live = computed(
  () =>
    ({
      live: { level: 'good', label: 'Live' },
      offline: { level: 'critical', label: 'Offline' },
      connecting: { level: 'muted', label: 'Connecting' },
    })[connection.value],
)
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button v-if="back" :default-href="back" :text="backText" />
          <span v-else class="live" :title="connection === 'offline' ? 'The helm server is not answering' : undefined">
            <StatusText :level="live.level">{{ live.label }}</StatusText>
          </span>
        </ion-buttons>
        <ion-title role="heading" aria-level="1" :translate="literalTitle ? 'no' : undefined">{{ title }}</ion-title>
        <ion-buttons slot="end">
          <slot name="actions" />
          <ion-button aria-label="Settings" @click="openSettings()">
            <ion-icon slot="icon-only" :icon="settingsOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true" :scroll-y="!fill">
      <slot name="fixed" />
      <ion-header v-if="condensed" collapse="condense">
        <ion-toolbar>
          <ion-title size="large" role="heading" aria-level="1" :translate="literalTitle ? 'no' : undefined">
            {{ title }}
          </ion-title>
        </ion-toolbar>
      </ion-header>

      <div class="body" :class="{ 'body-fill': fill }">
        <template v-if="notices">
          <p v-if="error" class="note notice" style="color: var(--color-critical)">
            Couldn't load the server's config: {{ error }}
          </p>
          <p v-else-if="loaded && !config.nodes.length" class="note notice">
            No machines yet.
            <ion-button fill="clear" size="small" class="notice-action" @click="openSettings('machines')">
              Add one in Settings
            </ion-button>
          </p>
        </template>
        <slot />
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.live {
  padding-inline: 8px;
}
.live :deep(.status) {
  font-weight: 500;
  font-size: 0.8125rem;
}
.body {
  padding: 4px 16px 28px;
}
.body-fill {
  height: 100%;
  box-sizing: border-box;
  padding-bottom: 12px;
  display: flex;
  flex-direction: column;
}
.notice {
  max-width: 1180px;
  margin: 0 auto 20px;
}
/* An inline action in a line of text: no button margins pushing it out of line. */
.notice-action {
  margin: 0;
  vertical-align: baseline;
}
@media (min-width: 768px) {
  .body {
    padding: 8px 32px 40px;
  }
  .body-fill {
    padding-bottom: 24px;
  }
}
</style>
