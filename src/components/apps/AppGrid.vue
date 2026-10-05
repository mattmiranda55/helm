<script setup>
/**
 * Home-screen style grid of apps that open in a new tab. Sized to the screen
 * width: 4 across on a phone, 6 and 8 on wider screens.
 */
import AppIcon from '@/components/ui/AppIcon.vue'

defineProps({
  /** [{ service, flag }] — flag: null | 'stopped' | 'critical' */
  apps: { type: Array, required: true },
})
</script>

<template>
  <ul class="grid">
    <li v-for="{ service, flag } in apps" :key="service.name">
      <a class="tile" :href="service.url" target="_blank" rel="noopener noreferrer" :title="service.description || service.name">
        <AppIcon :service="service" :flag="flag" />
        <span class="name">{{ service.name }}</span>
      </a>
    </li>
  </ul>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px 8px;
}
@media (min-width: 560px) {
  .grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
@media (min-width: 900px) {
  .grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 24px 12px;
  }
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 6px 2px;
  min-width: 0;
  border-radius: var(--radius-row);
  color: inherit;
  text-decoration: none;
  transition: background-color 0.2s;
}
.tile:hover {
  background: var(--color-sunken);
}
.tile:active :deep(.badge) {
  transform: scale(0.96);
}
.name {
  font-size: 12px;
  letter-spacing: -0.01em;
  color: var(--color-ink-2);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
