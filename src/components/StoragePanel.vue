<script setup>
import { computed } from 'vue'
import PanelCard from './PanelCard.vue'
import MeterBar from './MeterBar.vue'
import SparkLine from './SparkLine.vue'
import { bytes, percent, rate } from '@/lib/format'

const props = defineProps({
  fs: { type: Array, required: true },
  disks: { type: Array, required: true },
  readHistory: { type: Array, default: () => [] },
  writeHistory: { type: Array, default: () => [] },
  intervalMs: { type: Number, default: 3000 },
})

const series = computed(() => [
  { key: 'read', label: 'Read', color: 'var(--color-series-1)', values: props.readHistory },
  { key: 'write', label: 'Write', color: 'var(--color-series-2)', values: props.writeHistory },
])

const busiest = computed(() => props.disks.filter((disk) => disk.read + disk.write > 0).slice(0, 4))
</script>

<template>
  <PanelCard title="Storage">
    <div v-if="fs.length" class="flex flex-col gap-3">
      <div v-for="mount in fs" :key="mount.mount">
        <div class="mb-1.5 flex items-baseline gap-2">
          <span class="truncate font-mono text-[12px] text-ink">{{ mount.mount }}</span>
          <span class="truncate text-[10px] text-muted">{{ mount.device }} · {{ mount.type }}</span>
          <span class="tabular ml-auto shrink-0 text-[11px] text-ink-2">
            {{ bytes(mount.used) }} / {{ bytes(mount.size) }} · {{ percent(mount.percent, 0) }}
          </span>
        </div>
        <MeterBar :value="mount.percent" />
      </div>
    </div>

    <!-- your-server's Glances runs in a container with no host filesystem
         mounted, so it reports no filesystems at all. Say why, don't show a
         blank panel. -->
    <p v-else class="text-[11px] leading-relaxed text-muted">
      No filesystems reported. A containerized Glances only sees mounts that were
      passed into it — bind-mount the host root read-only
      (<code class="font-mono text-ink-2">-v /:/rootfs:ro</code>) to populate this.
    </p>

    <div class="mt-4 border-t border-hairline pt-3">
      <div class="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <div v-for="s in series" :key="s.key" class="flex items-baseline gap-2">
          <span class="h-2 w-2 rounded-full" :style="{ background: s.color }" />
          <span class="text-[11px] text-muted">{{ s.label }}</span>
          <span class="tabular text-sm font-semibold text-ink">
            {{ rate(s.values.at(-1) ?? 0) }}
          </span>
        </div>
      </div>

      <SparkLine
        class="mt-2"
        :series="series"
        :height="56"
        :format="(v) => rate(v)"
        :interval-ms="intervalMs"
      />

      <table v-if="busiest.length" class="mt-2 w-full text-[11px]">
        <tbody>
          <tr v-for="disk in busiest" :key="disk.name" class="border-t border-hairline">
            <td class="py-1.5 font-mono text-ink-2">{{ disk.name }}</td>
            <td class="tabular py-1.5 text-right text-ink-2">{{ rate(disk.read) }}</td>
            <td class="tabular py-1.5 text-right text-ink-2">{{ rate(disk.write) }}</td>
            <td class="tabular py-1.5 text-right text-muted">
              {{ disk.writeLatency }}ms lat
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </PanelCard>
</template>
