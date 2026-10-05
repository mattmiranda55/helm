<script setup>
/** Pick one of a few options, e.g. which machine. */
const model = defineModel({ type: String })

defineProps({
  /** [{ value, label }] */
  options: { type: Array, required: true },
  label: { type: String, required: true },
})
</script>

<template>
  <div class="seg" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="model === option.value"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  background: var(--color-sunken);
  border-radius: 999px;
  padding: 3px;
  max-width: 100%;
  overflow-x: auto;
}
.seg button {
  border: 0;
  background: none;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 14px;
  color: var(--color-ink-2);
  white-space: nowrap;
  transition: background-color 0.2s, color 0.2s;
}
.seg button[aria-pressed='true'] {
  background: var(--color-surface);
  color: var(--color-ink);
  font-weight: 650;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
}
</style>
