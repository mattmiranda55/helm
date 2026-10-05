<script setup>
/** A small trend line with an area fill and an emphasized latest point. */
import { computed } from 'vue'

const props = defineProps({
  values: { type: Array, default: () => [] },
  /** Fixed top of the scale (100 for percentages); auto when omitted. */
  max: { type: Number, default: null },
  color: { type: String, default: 'var(--color-series-1)' },
})

const top = computed(() => props.max ?? Math.max(1, ...props.values) * 1.15)

const line = computed(() => {
  const n = props.values.length
  if (n < 2) return ''
  return props.values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * 100).toFixed(2)},${(36 - (Math.min(v, top.value) / top.value) * 36).toFixed(2)}`)
    .join('')
})

const endY = computed(() => {
  const last = props.values.at(-1) ?? 0
  return 100 - (Math.min(last, top.value) / top.value) * 100
})
</script>

<template>
  <div class="spark" aria-hidden="true">
    <svg v-if="line" viewBox="0 0 100 36" preserveAspectRatio="none">
      <path class="area" :d="`${line}L100,36L0,36Z`" :style="{ fill: `color-mix(in srgb, ${color} 14%, transparent)` }" />
      <path class="line" :d="line" :style="{ stroke: color }" />
    </svg>
    <span v-if="line" class="end" :style="{ top: `${endY}%`, background: color }" />
  </div>
</template>

<style scoped>
.spark {
  position: relative;
  height: 36px;
}
.spark svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
.line {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
}
.end {
  position: absolute;
  left: 100%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 2px var(--color-surface);
}
</style>
