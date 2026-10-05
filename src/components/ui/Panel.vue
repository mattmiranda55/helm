<script setup>
/** A section card on the machine page. */
defineProps({
  title: { type: String, required: true },
})
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2 class="panel-title">{{ title }}</h2>
      <slot name="actions" />
    </div>
    <slot />
  </section>
</template>

<style scoped>
.panel {
  background: var(--color-surface);
  border-radius: var(--radius-card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.panel-title {
  font-size: 16px;
  font-weight: 700;
}
</style>
