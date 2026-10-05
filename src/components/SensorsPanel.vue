<script setup>
import { computed } from 'vue'
import PanelCard from './PanelCard.vue'
import MeterBar from './MeterBar.vue'
import { SEVERITY_COLOR, SEVERITY_LABEL, severity, temperature } from '@/lib/format'

const props = defineProps({
  sensors: { type: Array, required: true },
})

const temperatures = computed(() => props.sensors.filter((s) => s.unit === 'C' || s.unit === 'F'))
const others = computed(() => props.sensors.filter((s) => s.unit !== 'C' && s.unit !== 'F'))

/** Scale each reading against its own critical point, not a shared guess —
 *  a 45°C drive and a 45°C CPU core are not the same news. */
function ceilingFor(sensor) {
  return sensor.critical ?? sensor.warning ?? 100
}

function levelFor(sensor) {
  const ceiling = ceilingFor(sensor)
  const warn = sensor.warning ? (sensor.warning / ceiling) * 100 : 70
  return severity((sensor.value / ceiling) * 100, {
    warn,
    serious: (warn + 100) / 2,
    critical: 100,
  })
}

const hottest = computed(() =>
  temperatures.value.reduce((max, s) => (s.value > (max?.value ?? -Infinity) ? s : max), null),
)
</script>

<template>
  <PanelCard title="Sensors" :subtitle="`${sensors.length} readings`">
    <div v-if="hottest" class="mb-4 flex items-baseline gap-3">
      <span class="text-3xl leading-none font-semibold text-ink">
        {{ temperature(hottest.value, hottest.unit) }}
      </span>
      <span class="text-[11px] text-muted">hottest · {{ hottest.label }}</span>
      <span
        class="ml-auto flex items-center gap-1.5 text-[10px] font-medium"
        :style="{ color: SEVERITY_COLOR[levelFor(hottest)] }"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :style="{ background: SEVERITY_COLOR[levelFor(hottest)] }"
        />
        {{ SEVERITY_LABEL[levelFor(hottest)] }}
      </span>
    </div>

    <div class="flex flex-col gap-2.5">
      <div v-for="sensor in temperatures" :key="sensor.label">
        <div class="mb-1 flex items-baseline gap-2">
          <span class="truncate text-[11px] text-ink-2">{{ sensor.label }}</span>
          <span class="tabular ml-auto shrink-0 text-[11px] text-ink">
            {{ temperature(sensor.value, sensor.unit) }}
          </span>
        </div>
        <MeterBar
          :value="sensor.value"
          :max="ceilingFor(sensor)"
          :height="4"
          :thresholds="{
            warn: sensor.warning ? (sensor.warning / ceilingFor(sensor)) * 100 : 70,
            serious: 88,
            critical: 100,
          }"
        />
      </div>
    </div>

    <dl v-if="others.length" class="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3">
      <div v-for="sensor in others" :key="sensor.label" class="min-w-0">
        <dt class="truncate text-[10px] tracking-wide text-muted uppercase">{{ sensor.label }}</dt>
        <dd class="tabular mt-0.5 text-sm text-ink-2">
          {{ Math.round(sensor.value) }} {{ sensor.unit }}
        </dd>
      </div>
    </dl>

    <p v-if="!sensors.length" class="text-[11px] text-muted">
      No sensors exposed by this host.
    </p>
  </PanelCard>
</template>
