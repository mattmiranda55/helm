<script setup>
import Panel from '@/components/ui/Panel.vue'
import { temperature } from '@/lib/format'

defineProps({
  sensors: { type: Array, required: true },
})

const levelColor = (s) =>
  s.critical != null && s.value >= s.critical
    ? 'var(--color-critical)'
    : s.warning != null && s.value >= s.warning
      ? 'var(--color-warning)'
      : null
</script>

<template>
  <Panel title="Temperature">
    <ul class="list">
      <li v-for="sensor in sensors" :key="sensor.label">
        <span class="label">{{ sensor.label }}</span>
        <span class="num" :style="{ color: levelColor(sensor) }">
          {{ sensor.unit === 'C' || sensor.unit === 'F' ? temperature(sensor.value, sensor.unit) : `${Math.round(sensor.value)} ${sensor.unit}` }}
        </span>
      </li>
    </ul>
  </Panel>
</template>

<style scoped>
.list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px 16px;
}
.list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  border-bottom: 1px solid var(--color-hairline);
  padding-bottom: 6px;
}
.label {
  color: var(--color-ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
