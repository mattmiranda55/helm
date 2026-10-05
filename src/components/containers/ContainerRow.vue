<script setup>
/** One container in a list. Healthy ones show usage; anything else shows its state. */
import { computed } from 'vue'
import StatusText from '@/components/ui/StatusText.vue'
import { bytes } from '@/lib/format'

const props = defineProps({
  container: { type: Object, required: true },
})

const emit = defineEmits(['select'])

const STATE = {
  restarting: { level: 'critical', label: 'Restarting' },
  dead: { level: 'critical', label: 'Dead' },
  paused: { level: 'warning', label: 'Paused' },
}
const state = computed(() => {
  const { status } = props.container
  if (status === 'running' || status === 'healthy') return null
  return STATE[status] ?? { level: 'muted', label: 'Stopped' }
})

const image = computed(() => String(props.container.image ?? '').replace(/^docker\.io\/(library\/)?/, ''))
</script>

<template>
  <button type="button" class="row" @click="emit('select', container.name)">
    <span class="text">
      <span class="name" translate="no">{{ container.name }}</span>
      <span v-if="image" class="image num" translate="no">{{ image }}</span>
    </span>
    <StatusText v-if="state" :level="state.level">{{ state.label }}</StatusText>
    <span v-else class="usage num">
      <span>{{ container.cpu.toFixed(1) }}% CPU</span>
      <span class="mem">{{ bytes(container.memory) }}</span>
    </span>
  </button>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 10px 14px;
  text-align: left;
  transition: background-color 0.15s;
}
.row:hover {
  background: color-mix(in srgb, var(--color-sunken) 60%, transparent);
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.name {
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image {
  color: var(--color-muted);
  font-size: 11px;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 13px;
  color: var(--color-ink-2);
  flex-shrink: 0;
}
.mem {
  color: var(--color-muted);
}
</style>
