<script setup>
/** State in color and words together — never color alone. */
defineProps({
  /** good | warning | serious | critical | muted */
  level: { type: String, default: 'muted' },
})
</script>

<template>
  <span class="status" :style="{ color: level === 'muted' ? 'var(--color-muted)' : `var(--color-${level})` }">
    <span class="dot" aria-hidden="true" /><slot />
  </span>
</template>

<style scoped>
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
</style>
