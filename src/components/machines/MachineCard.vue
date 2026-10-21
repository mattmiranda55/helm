<script setup>
/**
 * One machine at a glance: four readings, a CPU trend, and a one-line status.
 * The whole card links to the machine's page.
 *
 * It's an ion-card with router-link, so the press feedback is Ionic's own: the
 * iOS card shrinks on .ion-activated, which Ionic sets a beat after the touch
 * lands and clears once the touch turns into a scroll or a pull-to-refresh, so
 * cards don't flash as you scroll past them.
 */
import { IonCard, IonSkeletonText } from '@ionic/vue'
import { computed } from 'vue'
import Sparkline from '@/components/ui/Sparkline.vue'
import StatusText from '@/components/ui/StatusText.vue'
import TapeLabel from '@/components/ui/TapeLabel.vue'
import { useHistory } from '@/composables/useHistory'
import { uptimeShort } from '@/lib/format'

const props = defineProps({
  node: { type: Object, required: true },
  /** { metrics, error, misses, loading } */
  snapshot: { type: Object, default: () => ({}) },
  /** This machine's attention items. */
  issues: { type: Array, default: () => [] },
})

const metrics = computed(() => props.snapshot.metrics)
/** No first answer yet, and no error either: hold the readings' place rather than leave a gap. */
const connecting = computed(() => !metrics.value && !props.snapshot.error)
const history = useHistory(() => props.node.id, metrics, ['cpu'])

const level = (value, warn, critical) => (value >= critical ? 'critical' : value >= warn ? 'warning' : '')

const readings = computed(() => {
  const m = metrics.value
  if (!m) return []
  const fullest = m.fs.reduce((a, b) => (b.percent > (a?.percent ?? -1) ? b : a), null)
  const hottest = m.sensors
    .filter((s) => s.unit === 'C' || s.unit === 'F')
    .reduce((a, b) => (b.value > (a?.value ?? -Infinity) ? b : a), null)
  const list = [
    { label: 'CPU', value: Math.round(m.cpu.total), unit: '%', level: level(m.cpu.total, 85, 95) },
    { label: 'Memory', value: Math.round(m.mem.percent), unit: '%', level: level(m.mem.percent, 85, 95) },
  ]
  if (fullest) {
    list.push({ label: 'Disk', title: `Fullest disk: ${fullest.mount}`, value: Math.round(fullest.percent), unit: '%', level: level(fullest.percent, 90, 97) })
  }
  if (hottest) {
    const tempLevel =
      hottest.critical != null && hottest.value >= hottest.critical
        ? 'critical'
        : hottest.warning != null && hottest.value >= hottest.warning
          ? 'warning'
          : ''
    list.push({ label: 'Temp', value: Math.round(hottest.value), unit: `°${hottest.unit}`, level: tempLevel })
  } else {
    list.push({ label: 'Load', value: (m.load.min1 ?? 0).toFixed(2), unit: '', level: '' })
  }
  return list
})

const containers = computed(() => {
  const list = metrics.value?.containers ?? []
  return { up: list.filter((c) => c.status === 'running').length, total: list.length }
})

const status = computed(() => {
  if (props.issues.length) {
    const [first] = props.issues
    const more = props.issues.length > 1 ? `, +${props.issues.length - 1} more` : ''
    return { level: first.level, text: `${first.short}${more}` }
  }
  if (!metrics.value) return { level: 'muted', text: props.snapshot.error ? 'Not reporting' : 'Connecting…' }
  return { level: 'good', text: 'All good' }
})
</script>

<template>
  <ion-card class="card" :router-link="`/machines/${encodeURIComponent(node.id)}`">
    <div class="body">
      <div class="head">
        <TapeLabel>{{ node.label }}</TapeLabel>
        <span v-if="metrics?.system.uptime" class="uptime">{{ uptimeShort(metrics.system.uptime) }}</span>
      </div>

      <div v-if="readings.length" class="readings">
        <div v-for="reading in readings" :key="reading.label" class="reading" :class="reading.level" :title="reading.title">
          <div class="value num">{{ reading.value }}<small>{{ reading.unit }}</small></div>
          <div class="label">{{ reading.label }}</div>
        </div>
      </div>
      <div v-else-if="connecting" class="readings" aria-hidden="true">
        <div v-for="n in 4" :key="n">
          <ion-skeleton-text animated class="skeleton-value" />
          <ion-skeleton-text animated class="skeleton-label" />
        </div>
      </div>
      <div v-else class="readings-empty" />

      <Sparkline :values="history.cpu" :max="100" />

      <div class="foot">
        <StatusText :level="status.level">{{ status.text }}</StatusText>
        <span v-if="containers.total">{{ containers.up }} of {{ containers.total }} containers up</span>
      </div>
    </div>
  </ion-card>
</template>

<style scoped>
/* Ionic's iOS card on helm's flat surfaces: its own margins, drop shadow and
   grey body text give way to the grid's gap, helm's radius and plain ink. */
.card {
  --color: var(--color-ink);
  margin: 0;
  border-radius: var(--radius-card);
  box-shadow: none;
  font-size: inherit;
}
@media (hover: hover) {
  .card:hover {
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.08);
  }
}
.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 18px 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.uptime {
  color: var(--color-muted);
  font-size: 0.8438rem;
}
.readings {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
.readings-empty {
  height: 47px;
}
/* Same 47px as a row of readings, so nothing shifts when the numbers land. */
.skeleton-value {
  --border-radius: 6px;
  width: 60%;
  height: 26px;
  margin: 0;
}
.skeleton-label {
  --border-radius: 4px;
  width: 45%;
  height: 13px;
  margin: 6px 0 2px;
}
.value {
  font-weight: 700;
  font-size: 1.625rem;
  line-height: 1;
  letter-spacing: -0.04em;
  white-space: nowrap;
}
.value small {
  font-size: 0.55em;
  margin-left: 1px;
  color: var(--color-ink-2);
}
.warning .value {
  color: var(--color-warning);
}
.critical .value {
  color: var(--color-critical);
}
.label {
  color: var(--color-muted);
  font-size: 0.8125rem;
  margin-top: 4px;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  font-size: 0.8438rem;
  color: var(--color-muted);
}
</style>
