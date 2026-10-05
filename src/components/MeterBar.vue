<script setup>
/**
 * Utilization meter. The fill carries severity; the track is a lighter step of
 * the fill's own hue so the state reads across the whole bar rather than only
 * the filled part. Data-end is rounded 4px, the baseline end stays square.
 */
import { computed } from 'vue'
import { SEVERITY_COLOR, SEVERITY_LABEL, severity } from '@/lib/format'

const props = defineProps({
  value: { type: Number, required: true },
  max: { type: Number, default: 100 },
  height: { type: Number, default: 6 },
  /** Override the automatic severity color (e.g. to hold a series color). */
  color: { type: String, default: null },
  thresholds: { type: Object, default: () => ({}) },
})

const ratio = computed(() => Math.min(Math.max(props.value / props.max, 0), 1))
const level = computed(() => severity((props.value / props.max) * 100, props.thresholds))
const fill = computed(() => props.color ?? SEVERITY_COLOR[level.value])
</script>

<template>
  <div
    class="w-full overflow-hidden rounded-full"
    :style="{
      height: `${height}px`,
      background: `color-mix(in oklab, ${fill} 20%, var(--color-surface))`,
    }"
    role="meter"
    :aria-valuenow="Math.round(value * 10) / 10"
    :aria-valuemin="0"
    :aria-valuemax="max"
    :aria-label="SEVERITY_LABEL[level]"
  >
    <div
      class="h-full transition-[width] duration-500 ease-out"
      :style="{
        width: `${ratio * 100}%`,
        background: fill,
        borderRadius: '0 4px 4px 0',
      }"
    />
  </div>
</template>
