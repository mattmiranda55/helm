<script setup>
/** What's wrong right now, each with the one button that gets you to the fix. */
import AppLink from '@/components/ui/AppLink.vue'
import Icon from '@/components/ui/Icon.vue'
import StatusText from '@/components/ui/StatusText.vue'

defineProps({
  /** From lib/attention.js */
  items: { type: Array, required: true },
  /** Hide the all-clear line until the machines have reported once. */
  ready: { type: Boolean, default: true },
})
</script>

<template>
  <section v-if="items.length">
    <h2 class="section-title">Needs attention <span class="count num">{{ items.length }}</span></h2>
    <ul class="list">
      <li v-for="item in items" :key="item.key" class="alert" :class="item.level">
        <span class="glyph"><Icon :name="item.icon" :size="18" /></span>
        <div class="min-w-0">
          <p class="what">{{ item.title }}</p>
          <p class="why">{{ item.detail }}</p>
        </div>
        <AppLink :to="item.action.to" class="btn action">{{ item.action.label }}</AppLink>
      </li>
    </ul>
  </section>
  <p v-else-if="ready" class="clear">
    <StatusText level="good">Nothing needs attention.</StatusText>
    <span class="clear-sub">All machines are reporting.</span>
  </p>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.alert {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 4px 12px;
  background: var(--color-surface);
  border-radius: var(--radius-row);
  padding: 14px 14px 14px 16px;
}
.glyph {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
}
.critical .glyph {
  background: color-mix(in srgb, var(--color-critical) 14%, transparent);
  color: var(--color-critical);
}
.warning .glyph {
  background: color-mix(in srgb, var(--color-warning) 16%, transparent);
  color: var(--color-warning);
}
.what {
  font-weight: 650;
}
.why {
  color: var(--color-muted);
  font-size: 14px;
}
.action {
  grid-column: 2;
  justify-self: start;
  margin-top: 8px;
  padding: 6px 14px;
}
.clear {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}
.clear-sub {
  color: var(--color-muted);
  font-size: 14px;
}

@media (min-width: 560px) {
  .alert {
    grid-template-columns: auto 1fr auto;
    align-items: center;
  }
  .action {
    grid-column: auto;
    margin-top: 0;
  }
}
</style>
