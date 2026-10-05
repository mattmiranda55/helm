<script setup>
import { computed, ref } from 'vue'
import PanelCard from './PanelCard.vue'
import { bytes, percent } from '@/lib/format'

const props = defineProps({
  processes: { type: Array, required: true },
})

const sortKey = ref('cpu')

const sorted = computed(() =>
  [...props.processes].sort((a, b) => b[sortKey.value] - a[sortKey.value]),
)

const columns = [
  { key: 'cpu', label: 'CPU' },
  { key: 'memory', label: 'MEM' },
]
</script>

<template>
  <PanelCard title="Processes" :subtitle="`top ${processes.length}`" flush>
    <template #actions>
      <div class="flex overflow-hidden rounded-md border border-hairline">
        <button
          v-for="column in columns"
          :key="column.key"
          type="button"
          class="px-2 py-1 text-[10px] transition-colors"
          :class="
            sortKey === column.key
              ? 'bg-raised text-ink'
              : 'text-muted hover:text-ink-2'
          "
          @click="sortKey = column.key"
        >
          {{ column.label }}
        </button>
      </div>
    </template>

    <!-- Bounded beside the other panels on desktop; on a phone it just runs
         with the page rather than becoming a scroll box inside a scroll box. -->
    <div class="lg:max-h-[22rem] lg:overflow-y-auto">
      <!-- Same reasoning as the containers panel: five columns do not fit a
           phone, so the process name gets its own line instead of a stub. -->
      <ul class="lg:hidden">
        <li
          v-for="process in sorted"
          :key="process.pid"
          class="border-t border-hairline px-4 py-2"
        >
          <div class="flex items-baseline gap-2">
            <span class="min-w-0 flex-1 font-mono text-[12px] break-words text-ink">
              {{ process.name }}
            </span>
            <span class="tabular shrink-0 text-[10px] text-muted">pid {{ process.pid }}</span>
          </div>
          <div class="truncate text-[10px] text-muted">{{ process.cmdline }}</div>
          <div class="mt-1 flex gap-4 text-[10px]">
            <span class="text-muted">CPU <span class="tabular text-ink-2">{{ percent(process.cpu) }}</span></span>
            <span class="text-muted">MEM <span class="tabular text-ink-2">{{ percent(process.memory) }}</span></span>
            <span class="text-muted">RSS <span class="tabular text-ink-2">{{ bytes(process.rss) }}</span></span>
            <span v-if="process.user" class="ml-auto truncate text-muted">{{ process.user }}</span>
          </div>
        </li>
        <li v-if="!sorted.length" class="px-4 py-6 text-center text-[11px] text-muted">
          No process data.
        </li>
      </ul>

      <table class="hidden w-full text-[11px] lg:table">
        <thead class="sticky top-0 z-10 bg-surface">
          <tr class="text-muted">
            <th class="px-4 py-2 text-left font-medium">Process</th>
            <th class="px-2 py-2 text-left font-medium">User</th>
            <th class="px-2 py-2 text-right font-medium">CPU</th>
            <th class="px-2 py-2 text-right font-medium">MEM</th>
            <th class="px-4 py-2 text-right font-medium">RSS</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="process in sorted" :key="process.pid" class="border-t border-hairline hover:bg-raised">
            <td class="max-w-0 px-4 py-1.5">
              <div class="truncate font-mono text-ink" :title="process.cmdline">
                {{ process.name }}
              </div>
              <div class="tabular text-[10px] text-muted">pid {{ process.pid }}</div>
            </td>
            <td class="px-2 py-1.5 text-muted">{{ process.user ?? '—' }}</td>
            <td class="tabular px-2 py-1.5 text-right text-ink-2">{{ percent(process.cpu) }}</td>
            <td class="tabular px-2 py-1.5 text-right text-ink-2">{{ percent(process.memory) }}</td>
            <td class="tabular px-4 py-1.5 text-right text-muted">{{ bytes(process.rss) }}</td>
          </tr>
          <tr v-if="!sorted.length">
            <td colspan="5" class="px-4 py-6 text-center text-muted">No process data.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </PanelCard>
</template>
