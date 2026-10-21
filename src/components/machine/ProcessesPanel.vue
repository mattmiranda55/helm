<script setup>
/**
 * Top processes, off by default: listing them is the most expensive thing
 * Glances can be asked for, so it only runs while this is open.
 */
import { IonButton, IonIcon, IonSpinner } from '@ionic/vue'
import { chevronDown, chevronUp } from 'ionicons/icons'
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
      <!-- A clear button, like a section header's "Show All"; the chevron says it
           expands in place rather than going somewhere. -->
      <ion-button fill="clear" size="small" :aria-expanded="String(open)" @click="emit('toggle')">
        {{ open ? 'Hide' : 'Show top processes' }}
        <ion-icon slot="end" :icon="open ? chevronUp : chevronDown" aria-hidden="true" />
      </ion-button>
    </template>

    <div v-if="open" class="scroll-x">
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
            <td colspan="3" class="loading"><ion-spinner name="lines-small" />Loading…</td>
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
.scroll-x {
  overflow-x: auto;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.table th {
  text-align: left;
  font-weight: 500;
  color: var(--color-muted);
  padding: 6px 0;
  font-size: 0.8125rem;
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
  font-size: 0.8125rem;
}
/* Same specificity as the right-aligned columns above, and later, so no !important. */
.table td.loading {
  color: var(--color-muted);
  text-align: left;
}
.loading ion-spinner {
  width: 16px;
  height: 16px;
  margin-right: 8px;
  vertical-align: -3px;
  color: var(--color-muted);
}
</style>
