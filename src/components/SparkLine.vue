<script setup>
/**
 * Time-series sparkline. One or more series share a single y-scale — a second
 * axis is never the answer; two measures of different scale get two charts.
 *
 * Marks follow the house spec: 2px line with round joins, a 10% area wash for a
 * single series, an 8px end marker carrying a 2px surface ring so it stays
 * legible where it crosses the line. Hover puts a crosshair and a tooltip on
 * every chart — an SVG chart in a browser is interactive by default.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  /** [{ key, label, color, values: number[] }] — newest sample last. */
  series: { type: Array, required: true },
  height: { type: Number, default: 56 },
  /** Fixed ceiling (percentages want 100); null auto-scales to the data. */
  max: { type: Number, default: null },
  format: { type: Function, default: (value) => String(Math.round(value)) },
  /** Sample spacing, used to label the tooltip "12s ago". */
  intervalMs: { type: Number, default: 3000 },
})

const root = ref(null)
const width = ref(240)
const hover = ref(null)

let observer = null
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    // Measure rather than stretch a viewBox: a scaled viewBox would distort
    // stroke widths and marker radii away from spec.
    width.value = Math.max(entry.contentRect.width, 40)
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const PADDING = 5 // room for the end marker + its ring
const length = computed(() => Math.max(...props.series.map((s) => s.values.length), 0))

const ceiling = computed(() => {
  if (props.max != null) return props.max
  const peak = Math.max(0, ...props.series.flatMap((s) => s.values))
  return peak <= 0 ? 1 : peak * 1.15
})

const plot = computed(() => ({
  w: width.value,
  h: props.height,
  innerW: Math.max(width.value - PADDING * 2, 1),
  innerH: Math.max(props.height - PADDING * 2, 1),
}))

function x(index) {
  const { innerW } = plot.value
  const span = Math.max(length.value - 1, 1)
  return PADDING + (index / span) * innerW
}

function y(value) {
  const { innerH } = plot.value
  const ratio = Math.min(Math.max(value / ceiling.value, 0), 1)
  return PADDING + innerH - ratio * innerH
}

const paths = computed(() =>
  props.series.map((s) => {
    const points = s.values.map((value, index) => [x(index), y(value)])
    const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
    const base = plot.value.h - PADDING
    const area =
      points.length > 1
        ? `${line} L${points.at(-1)[0].toFixed(1)},${base} L${points[0][0].toFixed(1)},${base} Z`
        : ''
    return { ...s, line, area, end: points.at(-1) ?? null }
  }),
)

const isSingle = computed(() => props.series.length === 1)

function onMove(event) {
  if (length.value < 2) return
  const rect = root.value.getBoundingClientRect()
  const ratio = (event.clientX - rect.left - PADDING) / plot.value.innerW
  const index = Math.round(Math.min(Math.max(ratio, 0), 1) * (length.value - 1))
  hover.value = { index, x: x(index) }
}

const hovered = computed(() => {
  if (!hover.value) return null
  const { index } = hover.value
  const offset = (length.value - 1 - index) * (props.intervalMs / 1000)
  return {
    x: hover.value.x,
    when: offset < 1 ? 'now' : `${Math.round(offset)}s ago`,
    rows: props.series.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      value: s.values[index],
      y: s.values[index] != null ? y(s.values[index]) : null,
    })),
  }
})

/** Keep the tooltip inside the panel instead of letting it clip at the edge. */
const tooltipStyle = computed(() => {
  if (!hovered.value) return {}
  const left = hovered.value.x
  const flip = left > plot.value.w * 0.6
  return flip
    ? { right: `${plot.value.w - left + 8}px` }
    : { left: `${left + 8}px` }
})
</script>

<template>
  <div ref="root" class="relative w-full" :style="{ height: `${height}px` }">
    <svg
      :width="plot.w"
      :height="plot.h"
      class="block overflow-visible"
      role="img"
      :aria-label="series.map((s) => `${s.label} ${format(s.values.at(-1) ?? 0)}`).join(', ')"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <!-- Baseline: recessive hairline, solid, one step off the surface -->
      <line
        :x1="PADDING"
        :x2="plot.w - PADDING"
        :y1="plot.h - PADDING"
        :y2="plot.h - PADDING"
        stroke="var(--color-grid)"
        stroke-width="1"
      />

      <template v-for="s in paths" :key="s.key">
        <path v-if="isSingle && s.area" :d="s.area" :fill="s.color" fill-opacity="0.1" />
        <path
          :d="s.line"
          fill="none"
          :stroke="s.color"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </template>

      <g v-if="hovered" pointer-events="none">
        <line
          :x1="hovered.x"
          :x2="hovered.x"
          :y1="PADDING"
          :y2="plot.h - PADDING"
          stroke="var(--color-baseline)"
          stroke-width="1"
        />
        <template v-for="row in hovered.rows" :key="row.key">
          <circle
            v-if="row.y != null"
            :cx="hovered.x"
            :cy="row.y"
            r="4"
            :fill="row.color"
            stroke="var(--color-surface)"
            stroke-width="2"
          />
        </template>
      </g>

      <!-- End marker: the current value, always visible -->
      <template v-for="s in paths" :key="`end-${s.key}`">
        <circle
          v-if="s.end && !hovered"
          :cx="s.end[0]"
          :cy="s.end[1]"
          r="4"
          :fill="s.color"
          stroke="var(--color-surface)"
          stroke-width="2"
        />
      </template>
    </svg>

    <div
      v-if="hovered"
      class="pointer-events-none absolute top-0 z-10 rounded-md border border-hairline bg-raised px-2 py-1.5 text-[11px] shadow-lg"
      :style="tooltipStyle"
    >
      <div class="mb-1 text-muted">{{ hovered.when }}</div>
      <div v-for="row in hovered.rows" :key="row.key" class="flex items-center gap-2 whitespace-nowrap">
        <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: row.color }" />
        <span class="text-ink-2">{{ row.label }}</span>
        <span class="tabular ml-auto pl-3 text-ink">{{ format(row.value ?? 0) }}</span>
      </div>
    </div>
  </div>
</template>
