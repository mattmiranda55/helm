<script setup>
import { computed } from 'vue'
import LineChart from '@/components/ui/LineChart.vue'
import Panel from '@/components/ui/Panel.vue'
import { percent } from '@/lib/format'

const props = defineProps({
  metrics: { type: Object, required: true },
  history: { type: Array, default: () => [] },
  stepSeconds: { type: Number, default: 5 },
})

const load = computed(() => {
  const { min1, min5, min15 } = props.metrics.load
  return [min1, min5, min15].map((v) => (v ?? 0).toFixed(2)).join(', ')
})
</script>

<template>
  <Panel title="CPU">
    <div class="headline">
      <span class="big num">{{ percent(metrics.cpu.total) }}</span>
      <span class="say">Load {{ load }} over 1, 5 and 15 minutes</span>
    </div>
    <LineChart
      :series="[{ name: 'CPU', color: 'var(--color-series-1)', values: history }]"
      :max="100"
      :format="(v) => percent(v, 0)"
      :step-seconds="stepSeconds"
      :label="`CPU usage over the last few minutes, now ${percent(metrics.cpu.total)}`"
    />
    <dl class="kv">
      <div><dt>Processes</dt><dd class="num">{{ metrics.processes.total }}</dd></div>
      <div><dt>Threads</dt><dd class="num">{{ metrics.processes.threads }}</dd></div>
      <div v-if="metrics.cpu.cores"><dt>Cores</dt><dd class="num">{{ metrics.cpu.cores }}</dd></div>
    </dl>
  </Panel>
</template>

<style scoped>
.headline {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.big {
  font-weight: 700;
  font-size: 34px;
  line-height: 1;
  letter-spacing: -0.04em;
}
.say {
  color: var(--color-ink-2);
  font-size: 14px;
}
.kv {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 10px 16px;
}
.kv dt {
  color: var(--color-muted);
  font-size: 13px;
}
.kv dd {
  font-size: 15px;
}
</style>
