<script setup>
/**
 * The launcher: only apps you can open right now. Stopped ones are counted and
 * left to the Containers tab, which is where you'd start them.
 */
import { IonRefresher, IonRefresherContent } from '@ionic/vue'
import { computed } from 'vue'
import AppGrid from '@/components/apps/AppGrid.vue'
import HelmPage from '@/components/layout/HelmPage.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useFleet } from '@/composables/useFleet'
import { usePageActive } from '@/composables/usePageActive'
import { isOpenable, serviceState } from '@/lib/services'

const { config, loaded } = useAppConfig()
const nodes = computed(() => config.value.nodes)
// Container states come from every machine's metrics; stop asking once you've left the tab.
const active = usePageActive()
const { snapshots, refresh } = useFleet(nodes, () => config.value.refreshMs, active)

/** Pull to refresh: re-read which containers are up, so a just-started app appears. */
function onRefresh(event) {
  refresh().finally(() => event.target.complete())
}

const states = computed(() => config.value.services.map((service) => ({ service, state: serviceState(service, snapshots.value) })))
const running = computed(() => states.value.filter(({ state }) => isOpenable(state)).map(({ service }) => ({ service, flag: null })))
const hidden = computed(() => states.value.length - running.value.length)
</script>

<template>
  <HelmPage title="Apps">
    <template #fixed>
      <ion-refresher slot="fixed" @ion-refresh="onRefresh">
        <ion-refresher-content />
      </ion-refresher>
    </template>

    <div class="page">
      <p v-if="running.length || (loaded && !config.services.length)" class="page-sub">
        <template v-if="running.length">{{ running.length }} running. Tap one to open it.</template>
        <template v-else>No apps yet.</template>
      </p>

      <AppGrid v-if="running.length" :apps="running" />

      <p v-else-if="loaded && !config.services.length" class="note">
        Add your apps to <code class="num">services</code> in config.json. Each one can name its
        container, so it only shows here while it's running.
      </p>

      <!-- Plain text, not a link: only the tab bar switches tabs.
           https://ionicframework.com/docs/vue/navigation#switching-between-tabs -->
      <p v-if="hidden" class="hidden-note">
        {{ hidden }} stopped {{ hidden === 1 ? 'app is' : 'apps are' }} hidden. Start them from the Containers tab.
      </p>
    </div>
  </HelmPage>
</template>

<style scoped>
.hidden-note {
  color: var(--color-muted);
  font-size: 0.875rem;
}
</style>
