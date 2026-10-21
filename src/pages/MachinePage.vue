<script setup>
/**
 * One machine in detail. Polls only this machine, only while the page is on
 * screen; processes only on request.
 *
 * Each machine is its own Ionic page instance (the outlet keys views by path),
 * so switching machines never re-points a live poller: the old page is torn
 * down and the new one starts polling its own machine.
 */
import {
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  useIonRouter,
} from '@ionic/vue'
import { computed, shallowRef } from 'vue'
import HelmPage from '@/components/layout/HelmPage.vue'
import CpuPanel from '@/components/machine/CpuPanel.vue'
import MemoryPanel from '@/components/machine/MemoryPanel.vue'
import NetworkPanel from '@/components/machine/NetworkPanel.vue'
import ProcessesPanel from '@/components/machine/ProcessesPanel.vue'
import SensorsPanel from '@/components/machine/SensorsPanel.vue'
import StoragePanel from '@/components/machine/StoragePanel.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useHistory } from '@/composables/useHistory'
import { useMetrics } from '@/composables/useMetrics'
import { usePageActive } from '@/composables/usePageActive'
import { uptimeLong } from '@/lib/format'

const props = defineProps({
  id: { type: String, required: true },
})

const { config, loaded } = useAppConfig()
const ionRouter = useIonRouter()
const active = usePageActive()
const node = computed(() => config.value.nodes.find((n) => n.id === props.id) ?? null)
const nodeId = computed(() => node.value?.id ?? null)
const refreshMs = computed(() => config.value.refreshMs)

/**
 * The machine's name is the page title: in the nav bar, and as the large
 * title it collapses from. The id stands in until the config has loaded,
 * so the header doesn't appear late and shove the page down.
 */
const title = computed(() => node.value?.label ?? (loaded.value ? 'No such machine' : props.id))

// Per page instance, like everything here: another machine is another page.
const processesOpen = shallowRef(false)

const { metrics, processes, error, refresh } = useMetrics(nodeId, refreshMs, processesOpen, active)
const history = useHistory(nodeId, metrics, ['cpu', 'net.rx', 'net.tx'])
const stepSeconds = computed(() => Math.round(refreshMs.value / 1000))

const machineOptions = computed(() => config.value.nodes.map((n) => ({ value: n.id, label: n.label })))

/**
 * Switching machines replaces this page rather than pushing: flicking through
 * them shouldn't pile up a back stack, so Back still means "all machines".
 * A replace also unmounts this page, which disposes its poller.
 */
const selected = computed({
  get: () => props.id,
  set: (id) => {
    if (id !== props.id) ionRouter.replace(`/machines/${encodeURIComponent(id)}`)
  },
})

/** Pull to refresh: fetch now, and let go of the spinner once it lands. */
async function onRefresh(event) {
  try {
    await refresh()
  } finally {
    event.target.complete()
  }
}

/** About this machine, as rows in a grouped list (label left, value right, like iOS's About). */
const facts = computed(() => {
  const m = metrics.value
  if (!m) return []
  const cpu = m.cpu.name ? m.cpu.name.replace(/\s*CPU\s*@.*$/, '').replace(/\(R\)|\(TM\)/g, '') : null
  return [
    { label: 'System', value: m.system.os },
    { label: 'Processor', value: cpu && `${cpu}${m.cpu.cores ? `, ${m.cpu.cores} cores` : ''}` },
    { label: 'Uptime', value: m.system.uptime ? uptimeLong(m.system.uptime) : null },
  ].filter((fact) => fact.value)
})
</script>

<template>
  <HelmPage :title="title" literal-title back="/machines" back-text="Machines">
    <template #fixed>
      <ion-refresher slot="fixed" :disabled="!node" @ion-refresh="onRefresh">
        <ion-refresher-content />
      </ion-refresher>
    </template>

    <div class="page">
      <div v-if="node && (machineOptions.length > 1 || facts.length)" class="intro">
        <SegmentedControl v-if="machineOptions.length > 1" v-model="selected" :options="machineOptions" label="Machine" />
        <ion-list v-if="facts.length" class="facts" inset lines="full">
          <ion-item v-for="fact in facts" :key="fact.label">
            <ion-label>{{ fact.label }}</ion-label>
            <ion-note slot="end">{{ fact.value }}</ion-note>
          </ion-item>
        </ion-list>
      </div>

      <!-- No "See all machines" link: the nav bar's back button already goes to
           /machines (default-href covers a cold load). ion-router-link isn't an
           option in Vue: it's for vanilla/Stencil apps and @ionic/vue doesn't export it.
           https://ionicframework.com/docs/api/back-button https://ionicframework.com/docs/api/router-link -->
      <p v-if="loaded && !node" class="note">
        There's no machine called “{{ id }}”.
      </p>
      <p v-else-if="!metrics && error" class="note" style="color: var(--color-critical)">
        Can't reach {{ node?.label }}: {{ error }}. Check that Glances is running on it.
      </p>
      <p v-else-if="!metrics" class="note connecting"><ion-spinner name="lines-small" />Connecting…</p>

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
  </HelmPage>
</template>

<style scoped>
.intro {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
/* An inset list for its rounded group and last-row-has-no-line, on helm's
 * gutter and the panels' radius rather than iOS Settings' margins. Its
 * background and hairlines already come from the global --ion-item-background
 * and --ion-border-color (theme/variables.css). */
ion-list.facts {
  margin: 0;
  border-radius: var(--radius-card);
}
.facts ion-item {
  font-size: 0.9375rem;
}
/* A long OS or CPU name wraps under itself rather than squeezing the label:
 * the note may shrink but never grows, so ion-item's label wrapper (which
 * clips) keeps the rest of the row. */
.facts ion-note {
  flex: 0 1 auto;
  max-width: 70%;
  margin-inline-start: 16px;
  padding-block: 10px;
  text-align: right;
  font-size: 0.9375rem;
  color: var(--color-ink-2);
}
.connecting {
  display: flex;
  align-items: center;
  gap: 8px;
}
.connecting ion-spinner {
  width: 18px;
  height: 18px;
  color: var(--color-muted);
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
