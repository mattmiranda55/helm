<script setup>
/**
 * The tabs shell: one Ionic tab per destination, each keeping its own page
 * stack. https://ionicframework.com/docs/vue/navigation#working-with-tabs
 *
 * ion-tabs wraps a nested ion-router-outlet (the tab pages render there) and
 * the tab bar. Ionic decides which tab a URL belongs to by matching it against
 * each button's href as a path prefix: /machines/basestation is in the
 * Machines tab because its button's href is /machines.
 *
 * Pages stay mounted after you leave them (that is how the terminal's shell
 * survives a trip to another tab), so anything that polls must pause with
 * usePageActive().
 *
 * Settings is not a tab or a route but a modal over all of them, hosted here
 * once so every tab's pages can open it (useSettings). It's an iOS card
 * modal, so it needs the element to scale back behind it: this ion-page,
 * taken from its template ref once mounted, as in the card modal docs.
 * Its code is only loaded the first time Settings opens (defineAsyncComponent,
 * mounted from `requested` on).
 * https://ionicframework.com/docs/api/modal#card-modal
 */
import { IonIcon, IonLabel, IonPage, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from '@ionic/vue'
import { defineAsyncComponent, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NAV_ITEMS } from '@/components/nav/navItems'
import { useAppConfig } from '@/composables/useAppConfig'
import { useSettings } from '@/composables/useSettings'

const SettingsModal = defineAsyncComponent(() => import('@/components/settings/SettingsModal.vue'))

const route = useRoute()
const { config } = useAppConfig()
const { isOpen: settingsOpen, requested: settingsRequested } = useSettings()

const page = useTemplateRef('page')
const presentingElement = shallowRef(null)
onMounted(() => {
  presentingElement.value = page.value?.$el ?? null
})

// The browser tab / app switcher title, by route name (router/index.ts).
const TITLES = {
  machines: 'Machines',
  apps: 'Apps',
  containers: 'Containers',
  terminal: 'Terminal',
  'not-found': 'Not found',
}

function titleFor(name, id) {
  if (name === 'machine') return config.value.nodes.find((n) => n.id === id)?.label ?? id
  return TITLES[name]
}

// While the Settings modal is open, it's what the app switcher should name.
watch(
  [() => route.name, () => route.params.id, () => config.value.nodes, settingsOpen],
  ([name, id, , settings]) => {
    const title = settings ? 'Settings' : titleFor(name, id)
    document.title = title ? `${title} · helm` : 'helm'
  },
  { immediate: true },
)
</script>

<template>
  <ion-page ref="page">
    <ion-tabs>
      <ion-router-outlet />
      <!-- id="tabbar" is useToast's positionAnchor. -->
      <ion-tab-bar id="tabbar" slot="bottom">
        <ion-tab-button v-for="item in NAV_ITEMS" :key="item.tab" :tab="item.tab" :href="item.to">
          <ion-icon aria-hidden="true" :icon="item.icon" />
          <ion-label>{{ item.label }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
    <SettingsModal v-if="settingsRequested" :presenting-element="presentingElement" />
  </ion-page>
</template>
