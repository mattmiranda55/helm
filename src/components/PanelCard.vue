<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: null },
  /** Removes the body padding, for panels that hold a full-bleed table. */
  flush: { type: Boolean, default: false },
})
</script>

<template>
  <section class="rounded-xl border border-hairline bg-surface">
    <header class="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5">
      <h2 class="text-[13px] font-semibold tracking-wide text-ink">{{ title }}</h2>
      <p v-if="subtitle" class="truncate text-[11px] text-muted">{{ subtitle }}</p>
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div :class="flush ? '' : 'p-4'">
      <slot />
    </div>
  </section>
</template>
