<script setup>
/**
 * Throughput. Rx and tx share one axis because they share a unit — a second
 * y-scale would make "down looks bigger than up" a lie about the geometry.
 */
import { computed } from 'vue'
import PanelCard from './PanelCard.vue'
import SparkLine from './SparkLine.vue'
import { bytes, rate } from '@/lib/format'

const props = defineProps({
  interfaces: { type: Array, required: true },
  rxHistory: { type: Array, default: () => [] },
  txHistory: { type: Array, default: () => [] },
  intervalMs: { type: Number, default: 3000 },
})

const series = computed(() => [
  { key: 'rx', label: 'Down', color: 'var(--color-series-1)', values: props.rxHistory },
  { key: 'tx', label: 'Up', color: 'var(--color-series-2)', values: props.txHistory },
])

const totals = computed(() =>
  props.interfaces.reduce(
    (acc, iface) => ({ rx: acc.rx + iface.rx, tx: acc.tx + iface.tx }),
    { rx: 0, tx: 0 },
  ),
)
</script>

<template>
  <PanelCard title="Network" :subtitle="`${interfaces.length} interfaces`">
    <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <div v-for="s in series" :key="s.key" class="flex items-baseline gap-2">
        <span class="h-2 w-2 rounded-full" :style="{ background: s.color }" />
        <span class="text-[11px] text-muted">{{ s.label }}</span>
        <span class="text-lg leading-none font-semibold text-ink">
          {{ rate(s.key === 'rx' ? totals.rx : totals.tx) }}
        </span>
      </div>
    </div>

    <SparkLine
      class="mt-3"
      :series="series"
      :height="72"
      :format="(v) => rate(v)"
      :interval-ms="intervalMs"
    />

    <table class="mt-3 w-full border-t border-hairline text-[11px]">
      <thead>
        <tr class="text-muted">
          <th class="py-2 text-left font-medium">Interface</th>
          <th class="py-2 text-right font-medium">Down</th>
          <th class="py-2 text-right font-medium">Up</th>
          <th class="hidden py-2 text-right font-medium sm:table-cell">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="iface in interfaces" :key="iface.name" class="border-t border-hairline">
          <td class="truncate py-1.5 pr-2 font-mono text-ink-2">{{ iface.name }}</td>
          <td class="tabular py-1.5 text-right text-ink-2">{{ rate(iface.rx) }}</td>
          <td class="tabular py-1.5 text-right text-ink-2">{{ rate(iface.tx) }}</td>
          <td class="tabular hidden py-1.5 text-right text-muted sm:table-cell">
            {{ bytes(iface.rxTotal + iface.txTotal) }}
          </td>
        </tr>
      </tbody>
    </table>
  </PanelCard>
</template>
