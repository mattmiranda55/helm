<script setup>
import { computed } from 'vue'
import Meter from '@/components/ui/Meter.vue'
import Panel from '@/components/ui/Panel.vue'
import { bytes, percent } from '@/lib/format'

const props = defineProps({
  mem: { type: Object, required: true },
  swap: { type: Object, required: true },
})

/**
 * Used / buffers / cache / free, as Glances reports them. Cache is memory the
 * kernel hands back on demand, which is why "available" is far above "free".
 */
const parts = computed(() => {
  const { used, buffers, cached, free, total } = props.mem
  const list = [
    { key: 'used', label: 'Used', value: used, color: 'var(--color-series-1)' },
    { key: 'buffers', label: 'Buffers', value: buffers, color: 'var(--color-series-2)' },
    { key: 'cache', label: 'Cache', value: cached, color: 'var(--color-series-3)' },
    { key: 'free', label: 'Free', value: free, color: 'var(--color-sunken)' },
  ]
  const sum = list.reduce((acc, part) => acc + part.value, 0) || total || 1
  return list.map((part) => ({ ...part, share: (part.value / sum) * 100 }))
})

const summary = computed(() => parts.value.map((p) => `${p.label} ${bytes(p.value)}`).join(', '))
</script>

<template>
  <Panel title="Memory">
    <div class="headline">
      <span class="big num">{{ percent(mem.percent) }}</span>
      <span class="say">{{ bytes(mem.available) }} free of {{ bytes(mem.total) }}</span>
    </div>
    <div class="stack" role="img" :aria-label="`Memory: ${summary}`">
      <span v-for="part in parts" :key="part.key" :style="{ width: `${part.share}%`, background: part.color }" />
    </div>
    <dl class="kv">
      <div v-for="part in parts" :key="part.key">
        <dt><i :style="{ background: part.color }" />{{ part.label }}</dt>
        <dd class="num">{{ bytes(part.value) }}</dd>
      </div>
    </dl>
    <div v-if="swap.total > 0" class="swap">
      <div class="swap-line">
        <span class="swap-label">Swap</span>
        <span class="num swap-value">{{ bytes(swap.used) }} of {{ bytes(swap.total) }}</span>
      </div>
      <Meter :value="swap.percent" />
    </div>
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
.stack {
  display: flex;
  gap: 2px;
  height: 14px;
  border-radius: 4px;
  overflow: hidden;
}
.stack span {
  display: block;
  height: 100%;
}
.kv {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 10px 16px;
}
.kv dt {
  color: var(--color-muted);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.kv dt i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  outline: 1px solid var(--color-hairline);
}
.kv dd {
  font-size: 15px;
}
.swap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.swap-line {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}
.swap-label {
  font-weight: 650;
}
.swap-value {
  font-size: 13px;
  color: var(--color-ink-2);
}
</style>
