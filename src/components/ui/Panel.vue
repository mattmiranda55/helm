<script setup>
/**
 * A section card on the machine page. Hand-rolled rather than an ion-card:
 * it holds charts and meters, matches the machine cards on the home page, and
 * ion-card's iOS look (inset margins, shadow, 28px title) would need undoing.
 * Header actions go in the `actions` slot as ion-buttons.
 */
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
  font-size: 1rem;
  font-weight: 700;
}
/* A clear header button keeps its tap target but lines its text up with the
 * card's edge, as a section header's trailing action does on iOS. */
.panel-head :slotted(ion-button[fill='clear']) {
  margin-block: -6px;
  margin-inline-end: -10px;
}
</style>
