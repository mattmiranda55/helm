<script setup>
import { computed } from 'vue'
import PanelCard from './PanelCard.vue'
import SparkLine from './SparkLine.vue'
import { SEVERITY_COLOR, hertz, percent, severity } from '@/lib/format'

const props = defineProps({
  cpu: { type: Object, required: true },
  load: { type: Object, required: true },
  history: { type: Array, default: () => [] },
  intervalMs: { type: Number, default: 3000 },
})

const series = computed(() => [
  { key: 'cpu', label: 'CPU', color: 'var(--color-series-1)', values: props.history },
])

/** Below ~9 cores every column can carry its value; past that the axis of
 *  labels becomes noise and the tooltip carries it instead. */
const labelCores = computed(() => props.cpu.perCore.length <= 8)

const breakdown = computed(() => [
  { key: 'user', label: 'User', value: props.cpu.user },
  { key: 'system', label: 'System', value: props.cpu.system },
  { key: 'iowait', label: 'I/O wait', value: props.cpu.iowait },
  { key: 'steal', label: 'Steal', value: props.cpu.steal },
])

const coreColor = (value) => SEVERITY_COLOR[severity(value)]
</script>

<template>
  <PanelCard title="Processor" :subtitle="cpu.name">
    <template #actions>
      <span v-if="cpu.hz" class="tabular text-[11px] text-muted">
        {{ hertz(cpu.hz) }} / {{ hertz(cpu.hzMax) }}
      </span>
    </template>

    <div class="flex items-baseline gap-3">
      <span class="text-3xl leading-none font-semibold text-ink">{{ percent(cpu.total) }}</span>
      <span class="text-[11px] text-muted">
        {{ cpu.cores }} cores · load {{ (load.min1 ?? 0).toFixed(2) }} /
        {{ (load.min5 ?? 0).toFixed(2) }} / {{ (load.min15 ?? 0).toFixed(2) }}
      </span>
    </div>

    <SparkLine
      class="mt-3"
      :series="series"
      :height="80"
      :max="100"
      :format="(v) => percent(v)"
      :interval-ms="intervalMs"
    />

    <dl class="mt-3 grid grid-cols-4 gap-3 border-t border-hairline pt-3">
      <div v-for="item in breakdown" :key="item.key">
        <dt class="text-[10px] tracking-wide text-muted uppercase">{{ item.label }}</dt>
        <dd class="tabular mt-0.5 text-sm text-ink-2">{{ percent(item.value) }}</dd>
      </div>
    </dl>

    <div v-if="cpu.perCore.length" class="mt-4">
      <p class="mb-2 text-[10px] tracking-wide text-muted uppercase">Per core</p>
      <!-- 2px surface gap does the separating; columns cap at 24px so the
           band's leftover stays as air. -->
      <div class="flex h-16 items-end gap-[2px]">
        <div
          v-for="(value, index) in cpu.perCore"
          :key="index"
          class="group relative flex h-full max-w-6 flex-1 flex-col justify-end"
          :title="`Core ${index}: ${percent(value)}`"
        >
          <span
            v-if="labelCores"
            class="tabular mb-1 text-center text-[10px] text-muted"
          >{{ Math.round(value) }}</span>
          <div
            class="w-full transition-[height] duration-500 ease-out"
            :style="{
              height: `${Math.max(Math.min(value, 100), 1.5)}%`,
              background: coreColor(value),
              borderRadius: '4px 4px 0 0',
            }"
          />
          <div
            class="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 rounded-md border border-hairline bg-raised px-2 py-1 text-[11px] whitespace-nowrap text-ink group-hover:block"
          >
            Core {{ index }} · {{ percent(value) }}
          </div>
        </div>
      </div>
      <div class="mt-1 h-px bg-grid" />
    </div>
  </PanelCard>
</template>
