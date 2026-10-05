<script setup>
/**
 * The launcher: only apps you can open right now. Stopped ones are counted and
 * left to the Containers page, which is where you'd start them.
 */
import { computed } from 'vue'
import AppGrid from '@/components/apps/AppGrid.vue'
import AppLink from '@/components/ui/AppLink.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useFleet } from '@/composables/useFleet'
import { isOpenable, serviceState } from '@/lib/services'

const { config, loaded } = useAppConfig()
const nodes = computed(() => config.value.nodes)
const { snapshots } = useFleet(nodes, () => config.value.refreshMs)

const states = computed(() => config.value.services.map((service) => ({ service, state: serviceState(service, snapshots.value) })))
const running = computed(() => states.value.filter(({ state }) => isOpenable(state)).map(({ service }) => ({ service, flag: null })))
const hidden = computed(() => states.value.length - running.value.length)
</script>

<template>
  <div class="page">
    <div>
      <h1 class="page-title">Apps</h1>
      <p class="page-sub">
        <template v-if="running.length">{{ running.length }} running. Tap one to open it.</template>
        <template v-else-if="loaded && !config.services.length">No apps yet.</template>
      </p>
    </div>

    <AppGrid v-if="running.length" :apps="running" />

    <p v-else-if="loaded && !config.services.length" class="note">
      Add your apps to <code class="num">services</code> in config.json. Each one can name its
      container, so it only shows here while it's running.
    </p>

    <p v-if="hidden" class="hidden-note">
      {{ hidden }} stopped {{ hidden === 1 ? 'app is' : 'apps are' }} hidden.
      <AppLink to="/containers" class="text-link">Start them in Containers</AppLink>
    </p>
  </div>
</template>

<style scoped>
.hidden-note {
  color: var(--color-muted);
  font-size: 14px;
}
</style>
