<script setup>
import { computed } from 'vue'
import Meter from '@/components/ui/Meter.vue'
import Panel from '@/components/ui/Panel.vue'
import StatusText from '@/components/ui/StatusText.vue'
import { bytes, rate } from '@/lib/format'

const props = defineProps({
  fs: { type: Array, required: true },
  disks: { type: Array, default: () => [] },
  /** Percent at which a filesystem counts as almost full (the fs alert level). */
  threshold: { type: Number, default: 90 },
})

const io = computed(() =>
  props.disks.reduce((acc, d) => ({ read: acc.read + d.read, write: acc.write + d.write }), { read: 0, write: 0 }),
)

const levelFor = (pct) => (pct >= 97 ? 'critical' : pct >= props.threshold ? 'warning' : null)
</script>

<template>
  <Panel title="Storage">
    <p v-if="disks.length" class="say">
      Reading <b class="num">{{ rate(io.read) }}</b>, writing <b class="num">{{ rate(io.write) }}</b>
    </p>

    <div v-for="entry in fs" :key="entry.mount" class="row">
      <div class="line">
        <span class="mount num" translate="no">{{ entry.mount }}</span>
        <span class="usage">
          <span class="num">{{ bytes(entry.used) }} of {{ bytes(entry.size) }}</span>
          <StatusText v-if="levelFor(entry.percent)" :level="levelFor(entry.percent)">
            {{ Math.round(entry.percent) }}% full
          </StatusText>
        </span>
      </div>
      <Meter
        :value="entry.percent"
        :color="levelFor(entry.percent) ? `var(--color-${levelFor(entry.percent)})` : 'var(--color-series-1)'"
      />
    </div>

    <p v-if="!fs.length" class="note">
      No filesystems reported. A Glances running in a container only sees mounts passed into it.
      Bind-mount the host root read-only (<code class="num">-v /:/rootfs:ro</code>) to fill this in.
    </p>
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
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.mount {
  font-weight: 700;
  font-size: 13.5px;
  overflow-wrap: anywhere;
}
.usage {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
  color: var(--color-ink-2);
}
</style>
