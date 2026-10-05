<script setup>
/** One machine in detail. Polls only this machine; processes only on request. */
import { computed, shallowRef, watch } from 'vue'
import CpuPanel from '@/components/machine/CpuPanel.vue'
import MemoryPanel from '@/components/machine/MemoryPanel.vue'
import NetworkPanel from '@/components/machine/NetworkPanel.vue'
import ProcessesPanel from '@/components/machine/ProcessesPanel.vue'
import SensorsPanel from '@/components/machine/SensorsPanel.vue'
import StoragePanel from '@/components/machine/StoragePanel.vue'
import AppLink from '@/components/ui/AppLink.vue'
import Icon from '@/components/ui/Icon.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import TapeLabel from '@/components/ui/TapeLabel.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useHistory } from '@/composables/useHistory'
import { useMetrics } from '@/composables/useMetrics'
import { uptimeLong } from '@/lib/format'
import { navigate } from '@/lib/router'

const props = defineProps({
  id: { type: String, required: true },
})

const { config, loaded } = useAppConfig()
const node = computed(() => config.value.nodes.find((n) => n.id === props.id) ?? null)
const nodeId = computed(() => node.value?.id ?? null)
const refreshMs = computed(() => config.value.refreshMs)

const processesOpen = shallowRef(false)
watch(nodeId, () => (processesOpen.value = false))

const { metrics, processes, error } = useMetrics(nodeId, refreshMs, processesOpen)
const history = useHistory(nodeId, metrics, ['cpu', 'net.rx', 'net.tx'])
const stepSeconds = computed(() => Math.round(refreshMs.value / 1000))

const machineOptions = computed(() => config.value.nodes.map((n) => ({ value: n.id, label: n.label })))
const selected = computed({
  get: () => props.id,
  set: (id) => navigate(`/machines/${encodeURIComponent(id)}`),
})

const facts = computed(() => {
  const m = metrics.value
  if (!m) return []
  return [
    m.system.os,
    m.cpu.name ? `${m.cpu.name.replace(/\s*CPU\s*@.*$/, '').replace(/\(R\)|\(TM\)/g, '')}${m.cpu.cores ? `, ${m.cpu.cores} cores` : ''}` : null,
    m.system.uptime ? `Up ${uptimeLong(m.system.uptime)}` : null,
  ].filter(Boolean)
})
</script>

<template>
  <div class="page">
    <div class="intro">
      <AppLink to="/" class="back"><Icon name="back" :size="18" />Machines</AppLink>

      <template v-if="node">
        <div class="title-row">
          <TapeLabel big>{{ node.label }}</TapeLabel>
          <SegmentedControl v-if="machineOptions.length > 1" v-model="selected" :options="machineOptions" label="Machine" />
        </div>
        <ul class="facts">
          <li v-for="fact in facts" :key="fact">{{ fact }}</li>
        </ul>
      </template>
    </div>

    <p v-if="loaded && !node" class="note">
      There's no machine called “{{ id }}”. <AppLink to="/" class="text-link">See all machines</AppLink>
    </p>
    <p v-else-if="!metrics && error" class="note" style="color: var(--color-critical)">
      Can't reach {{ node?.label }}: {{ error }}. Check that Glances is running on it.
    </p>
    <p v-else-if="!metrics" class="note">Connecting…</p>

    <div v-else class="grid">
      <CpuPanel :metrics="metrics" :history="history.cpu" :step-seconds="stepSeconds" />
      <MemoryPanel :mem="metrics.mem" :swap="metrics.swap" />
      <NetworkPanel :interfaces="metrics.network" :rx="history['net.rx']" :tx="history['net.tx']" :step-seconds="stepSeconds" />
      <StoragePanel :fs="metrics.fs" :disks="metrics.disks" :threshold="config.thresholds.fs" />
      <SensorsPanel v-if="metrics.sensors.length" :sensors="metrics.sensors" />
      <ProcessesPanel
        :open="processesOpen"
        :processes="processes"
        :machine="node.label"
        @toggle="processesOpen = !processesOpen"
      />
    </div>
  </div>
</template>

<style scoped>
.intro {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  color: var(--color-ink-2);
  text-decoration: none;
  font-size: 14px;
}
.back:hover {
  color: var(--color-ink);
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.facts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--color-ink-2);
  font-size: 14px;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}
@media (min-width: 768px) {
  .grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
