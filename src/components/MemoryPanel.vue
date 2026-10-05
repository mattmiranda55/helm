<script setup>
/**
 * Memory composition. Buffers and cache are shown as their own segments rather
 * than folded into "used" — on Linux they are reclaimable, and a dashboard that
 * calls 12GB of page cache "used" sends you chasing a leak that isn't there.
 */
import { computed } from 'vue'
import PanelCard from './PanelCard.vue'
import MeterBar from './MeterBar.vue'
import { bytes, percent } from '@/lib/format'

const props = defineProps({
  mem: { type: Object, required: true },
  swap: { type: Object, required: true },
})

const segments = computed(() => {
  const { total, used, buffers, cached } = props.mem
  const free = Math.max(total - used - buffers - cached, 0)
  return [
    { key: 'used', label: 'Used', value: used, color: 'var(--color-series-1)' },
    { key: 'buffers', label: 'Buffers', value: buffers, color: 'var(--color-series-2)' },
    { key: 'cached', label: 'Cache', value: cached, color: 'var(--color-series-3)' },
    { key: 'free', label: 'Free', value: free, color: 'var(--color-baseline)' },
  ].filter((segment) => segment.value > 0)
})

const share = (value) => (props.mem.total > 0 ? (value / props.mem.total) * 100 : 0)
</script>

<template>
  <PanelCard title="Memory" :subtitle="`${bytes(mem.total)} total`">
    <div class="flex items-baseline gap-3">
      <span class="text-3xl leading-none font-semibold text-ink">{{ percent(mem.percent) }}</span>
      <span class="text-[11px] text-muted">{{ bytes(mem.available) }} available</span>
    </div>

    <!-- Stacked bar: a 2px surface gap separates every segment, never a stroke. -->
    <div class="mt-4 flex h-3 w-full gap-[2px] overflow-hidden">
      <div
        v-for="segment in segments"
        :key="segment.key"
        class="h-full min-w-[2px] transition-[width] duration-500 ease-out"
        :style="{
          width: `${share(segment.value)}%`,
          background: segment.color,
          borderRadius: '2px',
        }"
        :title="`${segment.label}: ${bytes(segment.value)}`"
      />
    </div>

    <!-- Legend doubles as the direct-label channel; identity is never color alone. -->
    <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
      <div v-for="segment in segments" :key="segment.key" class="min-w-0">
        <dt class="flex items-center gap-1.5 text-[10px] tracking-wide text-muted uppercase">
          <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: segment.color }" />
          {{ segment.label }}
        </dt>
        <dd class="tabular mt-0.5 truncate text-sm text-ink-2">{{ bytes(segment.value) }}</dd>
      </div>
    </dl>

    <div v-if="swap.total > 0" class="mt-4 border-t border-hairline pt-3">
      <div class="mb-1.5 flex items-baseline gap-2">
        <span class="text-[10px] tracking-wide text-muted uppercase">Swap</span>
        <span class="tabular ml-auto text-[11px] text-ink-2">
          {{ bytes(swap.used) }} / {{ bytes(swap.total) }}
        </span>
      </div>
      <MeterBar :value="swap.percent" :thresholds="{ warn: 25, serious: 50, critical: 75 }" />
    </div>
  </PanelCard>
</template>
