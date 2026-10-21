<script setup>
/** Home: favorites, then anything wrong, then every machine at a glance. */
import { IonRefresher, IonRefresherContent } from '@ionic/vue'
import { computed, shallowRef } from 'vue'
import AppGrid from '@/components/apps/AppGrid.vue'
import ContainerSheet from '@/components/containers/ContainerSheet.vue'
import HelmPage from '@/components/layout/HelmPage.vue'
import AttentionList from '@/components/machines/AttentionList.vue'
import MachineCard from '@/components/machines/MachineCard.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useFleet } from '@/composables/useFleet'
import { usePageActive } from '@/composables/usePageActive'
import { useStacks } from '@/composables/useStacks'
import { attentionItems } from '@/lib/attention'
import { serviceState } from '@/lib/services'

const { config } = useAppConfig()
const nodes = computed(() => config.value.nodes)
// The Machines tab stays mounted under the others; only poll while it's showing.
const active = usePageActive()
const { snapshots, refresh } = useFleet(nodes, () => config.value.refreshMs, active)

/** Pull to refresh: fetch every machine now and hold the spinner until they've all answered. */
function onRefresh(event) {
  refresh().finally(() => event.target.complete())
}

const items = computed(() => attentionItems(nodes.value, snapshots.value, config.value.thresholds))
const ready = computed(() => nodes.value.length > 0 && nodes.value.every((n) => snapshots.value[n.id]?.metrics))

const issuesFor = (id) => items.value.filter((item) => item.nodeId === id)

/** Favorites show whatever you pinned, running or not; a stopped one gets a grey flag. */
const favorites = computed(() =>
  config.value.services
    .filter((service) => service.favorite)
    .map((service) => {
      const state = serviceState(service, snapshots.value)
      const flag = state === 'restarting' || state === 'dead' ? 'critical' : ['exited', 'missing', 'created', 'paused'].includes(state) ? 'stopped' : null
      return { service, flag }
    }),
)

// --- a crashed container, as a modal over this tab ---------------------------
/**
 * "View logs" opens the container right here instead of pushing the
 * Containers page onto this tab's stack: a view several tabs need is a modal,
 * so every tab keeps its own history. Everything the sheet shows comes from
 * the fleet poll already running, so it stays live without another fetch.
 */
const sheet = shallowRef(null) // { nodeId, name }
const sheetNode = computed(() => nodes.value.find((n) => n.id === sheet.value?.nodeId) ?? null)
const sheetSnapshot = computed(() => (sheet.value ? snapshots.value[sheet.value.nodeId] : null))
const sheetCaps = computed(() => sheetSnapshot.value?.capabilities ?? {})
const sheetContainer = computed(
  () => sheetSnapshot.value?.metrics?.containers.find((c) => c.name === sheet.value.name) ?? null,
)
const sheetService = computed(() =>
  sheetContainer.value
    ? (config.value.services.find(
        (s) => s.container === sheetContainer.value.name && (!s.node || s.node === sheet.value.nodeId),
      ) ?? null)
    : null,
)
/** Same wording as the Containers page: why there are no buttons or logs. */
const viewOnly = computed(() => {
  if (!sheetNode.value || sheetCaps.value.containers) return null
  return sheetCaps.value.local
    ? `helm can't start or stop containers here: container control is turned off in its config, or podman/docker isn't installed on ${sheetNode.value.label}.`
    : `helm runs on a different machine, so it can watch ${sheetNode.value.label}'s containers but not start or stop them.`
})

// Which compose stack it belongs to, asked for only while the sheet is open.
const stacksApi = useStacks(() => !!sheet.value && !!sheetCaps.value.stacks, active)
const sheetStack = computed(() => {
  const name = sheet.value?.name
  return stacksApi.stacks.value.find((stack) => stack.services.some((s) => s.container === name))?.name ?? null
})

/**
 * The modal has gone. Leaving the tab also dismisses it (its `open` includes
 * `active`); keep the selection then, so it is back when you return.
 */
function closeSheet() {
  if (active.value) sheet.value = null
}
</script>

<template>
  <HelmPage title="Machines">
    <template #fixed>
      <ion-refresher slot="fixed" @ion-refresh="onRefresh">
        <ion-refresher-content />
      </ion-refresher>
    </template>

    <div class="page">
      <section v-if="favorites.length">
        <!-- No "All apps" shortcut: only the tab bar switches tabs, and Apps is one tap away there.
             https://ionicframework.com/docs/vue/navigation#switching-between-tabs -->
        <h2 class="section-title">Favorites</h2>
        <AppGrid :apps="favorites" />
      </section>

      <AttentionList :items="items" :ready="ready" @open-container="sheet = $event" />

      <section>
        <h2 class="section-title">Machines <span class="count num">{{ nodes.length }}</span></h2>
        <div class="machines">
          <MachineCard
            v-for="node in nodes"
            :key="node.id"
            :node="node"
            :snapshot="snapshots[node.id]"
            :issues="issuesFor(node.id)"
          />
        </div>
      </section>
    </div>

    <ContainerSheet
      v-if="sheetNode"
      :open="active && !!sheetContainer"
      :container="sheetContainer"
      :node-id="sheetNode.id"
      :machine="sheetNode.label"
      :can-control="!!sheetCaps.containers"
      :view-only="viewOnly"
      :stack="sheetStack"
      :service="sheetService"
      @close="closeSheet"
      @changed="refresh"
    />
  </HelmPage>
</template>

<style scoped>
.machines {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 768px) {
  .machines {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
