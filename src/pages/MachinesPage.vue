<script setup>
/** Home: favorites, then anything wrong, then every machine at a glance. */
import { computed } from 'vue'
import AppGrid from '@/components/apps/AppGrid.vue'
import AttentionList from '@/components/machines/AttentionList.vue'
import MachineCard from '@/components/machines/MachineCard.vue'
import AppLink from '@/components/ui/AppLink.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useFleet } from '@/composables/useFleet'
import { attentionItems } from '@/lib/attention'
import { serviceState } from '@/lib/services'

const { config } = useAppConfig()
const nodes = computed(() => config.value.nodes)
const { snapshots } = useFleet(nodes, () => config.value.refreshMs)

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
</script>

<template>
  <div class="page">
    <section v-if="favorites.length">
      <div class="section-title justify-between">
        <h2>Favorites</h2>
        <AppLink to="/apps" class="text-link">All apps</AppLink>
      </div>
      <AppGrid :apps="favorites" />
    </section>

    <AttentionList :items="items" :ready="ready" />

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
