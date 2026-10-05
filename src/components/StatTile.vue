<script setup>
/**
 * Stat tile: label · value · optional caption · optional 60-point trend.
 * The value keeps proportional figures — tabular-nums is for columns that must
 * align vertically, and makes a large standalone number look loose.
 */
import { computed } from 'vue'
import SparkLine from './SparkLine.vue'
import { SEVERITY_COLOR, SEVERITY_LABEL, severity } from '@/lib/format'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  caption: { type: String, default: null },
  /** 0–100 utilization driving the accent, or null for a plain figure. */
  level: { type: Number, default: null },
  history: { type: Array, default: () => [] },
  format: { type: Function, default: (v) => `${Math.round(v)}%` },
  intervalMs: { type: Number, default: 3000 },
  thresholds: { type: Object, default: () => ({}) },
})

const state = computed(() => (props.level == null ? null : severity(props.level, props.thresholds)))
const accent = computed(() => (state.value ? SEVERITY_COLOR[state.value] : 'var(--color-series-1)'))
const series = computed(() => [
  { key: 'trend', label: props.label, color: accent.value, values: props.history },
])
</script>

<template>
  <div class="flex flex-col gap-2 rounded-xl border border-hairline bg-surface p-4">
    <div class="flex items-center gap-2">
      <span class="text-[11px] font-medium tracking-wide text-muted uppercase">{{ label }}</span>
      <!-- Status never rides on color alone: the dot ships with this label. -->
      <span
        v-if="state && state !== 'good'"
        class="ml-auto flex items-center gap-1.5 text-[10px] font-medium"
        :style="{ color: accent }"
      >
        <span class="h-1.5 w-1.5 rounded-full" :style="{ background: accent }" />
        {{ SEVERITY_LABEL[state] }}
      </span>
    </div>

    <div class="flex items-baseline gap-2">
      <span class="text-2xl leading-none font-semibold text-ink">{{ value }}</span>
      <span v-if="caption" class="truncate text-[11px] text-muted">{{ caption }}</span>
    </div>

    <SparkLine
      v-if="history.length > 1"
      :series="series"
      :height="34"
      :max="level == null ? null : 100"
      :format="format"
      :interval-ms="intervalMs"
    />
    <div v-else class="h-[34px]" />
  </div>
</template>
