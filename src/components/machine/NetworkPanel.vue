<script setup>
import { computed } from 'vue'
import LineChart from '@/components/ui/LineChart.vue'
import Panel from '@/components/ui/Panel.vue'
import { bytes, rate } from '@/lib/format'

const props = defineProps({
  interfaces: { type: Array, required: true },
  rx: { type: Array, default: () => [] },
  tx: { type: Array, default: () => [] },
  stepSeconds: { type: Number, default: 5 },
})

const totals = computed(() =>
  props.interfaces.reduce((acc, i) => ({ rx: acc.rx + i.rx, tx: acc.tx + i.tx }), { rx: 0, tx: 0 }),
)

const series = computed(() => [
  { name: 'Down', color: 'var(--color-series-1)', values: props.rx },
  { name: 'Up', color: 'var(--color-series-2)', values: props.tx },
])
</script>

<template>
  <Panel title="Network">
    <p class="say">
      Down <b class="num">{{ rate(totals.rx) }}</b>, up <b class="num">{{ rate(totals.tx) }}</b>
    </p>
    <LineChart :series="series" :format="rate" :step-seconds="stepSeconds" label="Network throughput over the last few minutes" />
    <div class="legend">
      <span><i style="background: var(--color-series-1)" />Down</span>
      <span><i style="background: var(--color-series-2)" />Up</span>
    </div>
    <div class="overflow-x-auto">
      <table v-if="interfaces.length" class="table">
        <thead>
          <tr><th>Interface</th><th>Down</th><th>Up</th><th>Total</th></tr>
        </thead>
        <tbody>
          <tr v-for="iface in interfaces" :key="iface.name">
            <td class="num" translate="no">{{ iface.name }}</td>
            <td class="num">{{ rate(iface.rx) }}</td>
            <td class="num">{{ rate(iface.tx) }}</td>
            <td class="num">{{ bytes(iface.rxTotal + iface.txTotal) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </Panel>
</template>

<style scoped>
.say {
  color: var(--color-ink-2);
  font-size: 14px;
}
.say b {
  color: var(--color-ink);
  font-weight: 700;
}
.legend {
  display: flex;
  gap: 16px;
  font-size: 13.5px;
  color: var(--color-ink-2);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 14px;
  height: 3px;
  border-radius: 2px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th {
  text-align: left;
  font-weight: 500;
  color: var(--color-muted);
  padding: 6px 0;
}
.table td {
  padding: 7px 0;
  border-top: 1px solid var(--color-hairline);
  white-space: nowrap;
}
.table th:not(:first-child),
.table td:not(:first-child) {
  text-align: right;
  padding-left: 12px;
}
</style>
