<script setup>
/** A thin fill bar, 0–100. */
defineProps({
  value: { type: Number, default: 0 },
  color: { type: String, default: 'var(--color-series-1)' },
})
</script>

<template>
  <div class="meter" aria-hidden="true">
    <span :style="{ width: `${Math.min(Math.max(value, 0), 100)}%`, background: color }" />
  </div>
</template>

<style scoped>
.meter {
  height: 8px;
  background: var(--color-sunken);
  border-radius: 4px;
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  border-radius: 4px;
}
</style>
