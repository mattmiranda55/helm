<script setup>
/**
 * Line chart for the machine page: faint grid, labelled scale, a dot on each
 * series' latest value, and a crosshair + tooltip on hover or touch.
 */
import { computed, shallowRef } from 'vue'

const props = defineProps({
  /** [{ name, color, values }] — all series share one scale. */
  series: { type: Array, required: true },
  max: { type: Number, default: null },
  format: { type: Function, default: (v) => String(Math.round(v)) },
  /** Seconds between samples, for "2m 30s ago" in the tooltip. */
  stepSeconds: { type: Number, default: 5 },
  label: { type: String, required: true },
})

const length = computed(() => Math.max(0, ...props.series.map((s) => s.values.length)))

function nice(value) {
  const power = 10 ** Math.floor(Math.log10(value || 1))
  return [1, 2, 2.5, 5, 10].map((step) => step * power).find((step) => step >= value) ?? 10 * power
}

const top = computed(() => props.max ?? nice(Math.max(1e-9, ...props.series.flatMap((s) => s.values)) * 1.15))

const y = (v) => 40 - (Math.min(v, top.value) / top.value) * 40

function path(values) {
  if (values.length < 2) return ''
  return values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 100).toFixed(2)},${y(v).toFixed(2)}`).join('')
}

const lines = computed(() => props.series.map((s) => ({ ...s, d: path(s.values), end: s.values.at(-1) })))

// --- hover ----------------------------------------------------------------
const hover = shallowRef(null) // sample index

function onMove(event) {
  if (length.value < 2) return
  const rect = event.currentTarget.getBoundingClientRect()
  const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
  hover.value = Math.round((x / rect.width) * (length.value - 1))
}

const hoverLeft = computed(() => (hover.value == null ? 0 : (hover.value / (length.value - 1)) * 100))

const hoverLabel = computed(() => {
  if (hover.value == null) return ''
  const seconds = (length.value - 1 - hover.value) * props.stepSeconds
  if (seconds === 0) return 'Now'
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${seconds % 60}s ago` : `${seconds}s ago`
})
</script>

<template>
  <div
    class="chart"
    :class="{ hovering: hover != null }"
    role="img"
    :aria-label="label"
    @pointermove="onMove"
    @pointerleave="hover = null"
  >
    <svg viewBox="0 0 100 40" preserveAspectRatio="none">
      <g class="grid">
        <line x1="0" x2="100" y1="0" y2="0" />
        <line x1="0" x2="100" y1="20" y2="20" />
        <line x1="0" x2="100" y1="40" y2="40" />
      </g>
      <path
        v-if="lines.length === 1 && lines[0].d"
        :d="`${lines[0].d}L100,40L0,40Z`"
        :style="{ fill: `color-mix(in srgb, ${lines[0].color} 13%, transparent)` }"
      />
      <path v-for="line in lines" :key="line.name" class="line" :d="line.d" :style="{ stroke: line.color }" />
    </svg>

    <span class="scale num" style="top: 0">{{ format(top) }}</span>
    <span class="scale num" style="top: 50%">{{ format(top / 2) }}</span>

    <template v-for="line in lines" :key="`end-${line.name}`">
      <span v-if="line.end != null" class="dot" :style="{ left: '100%', top: `${(y(line.end) / 40) * 100}%`, background: line.color }" />
    </template>

    <template v-if="hover != null">
      <span class="crosshair" :style="{ left: `${hoverLeft}%` }" />
      <span
        v-for="line in lines"
        :key="`h-${line.name}`"
        class="dot"
        :style="{ left: `${hoverLeft}%`, top: `${(y(line.values[hover] ?? 0) / 40) * 100}%`, background: line.color }"
      />
      <span class="tip" :style="{ left: `${Math.min(Math.max(hoverLeft, 18), 82)}%` }">
        {{ hoverLabel }}<br />
        <span v-for="line in lines" :key="`t-${line.name}`" class="tip-row">
          {{ line.name }} <b class="num">{{ format(line.values[hover] ?? 0) }}</b>
        </span>
      </span>
    </template>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  height: 120px;
  touch-action: pan-y;
}
.chart svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
.grid line {
  stroke: var(--color-grid);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.line {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
}
.scale {
  position: absolute;
  right: 0;
  transform: translateY(-110%);
  font-size: 11px;
  color: var(--color-muted);
  background: var(--color-surface);
  padding: 0 3px;
  border-radius: 3px;
  z-index: 1;
}
.dot {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 2px var(--color-surface);
  pointer-events: none;
}
.crosshair {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-muted);
  pointer-events: none;
}
.tip {
  position: absolute;
  top: -8px;
  transform: translate(-50%, -100%);
  background: var(--color-ink);
  color: var(--color-plane);
  font-size: 12.5px;
  padding: 6px 9px;
  border-radius: 8px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 2;
}
.tip-row + .tip-row {
  margin-left: 10px;
}
</style>
