<script setup>
/**
 * Top processes, off by default: listing them is the most expensive thing
 * Glances can be asked for, so it only runs while this is open.
 */
import Panel from '@/components/ui/Panel.vue'

defineProps({
  open: { type: Boolean, default: false },
  processes: { type: Array, default: () => [] },
  machine: { type: String, required: true },
})

const emit = defineEmits(['toggle'])
</script>

<template>
  <Panel title="Processes">
    <template #actions>
      <button type="button" class="btn" :aria-expanded="open" @click="emit('toggle')">
        {{ open ? 'Hide' : 'Show top processes' }}
      </button>
    </template>

    <div v-if="open" class="overflow-x-auto">
      <table class="table">
        <thead>
          <tr><th>Name</th><th>CPU</th><th>Memory</th></tr>
        </thead>
        <tbody>
          <tr v-for="process in processes" :key="process.pid">
            <td :title="process.cmdline" translate="no">{{ process.name }}</td>
            <td class="num">{{ process.cpu.toFixed(1) }}%</td>
            <td class="num">{{ process.memory.toFixed(1) }}%</td>
          </tr>
          <tr v-if="!processes.length">
            <td colspan="3" class="loading">Loading…</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="note">
      Off by default. Listing processes costs {{ machine }} noticeably more CPU, so it only runs
      while this is open.
    </p>
  </Panel>
</template>

<style scoped>
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.table th {
  text-align: left;
  font-weight: 500;
  color: var(--color-muted);
  padding: 6px 0;
  font-size: 13px;
}
.table td {
  padding: 7px 0;
  border-top: 1px solid var(--color-hairline);
}
.table td:first-child {
  max-width: 0;
  width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.table th:not(:first-child),
.table td:not(:first-child) {
  text-align: right;
  font-size: 13px;
}
.loading {
  color: var(--color-muted);
  text-align: left !important;
}
</style>
