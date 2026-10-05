<script setup>
/** Phone navigation, at the bottom where a thumb reaches. Hidden on wide screens. */
import { NAV_ITEMS } from './navItems'
import AppLink from '@/components/ui/AppLink.vue'
import Icon from '@/components/ui/Icon.vue'
</script>

<template>
  <nav class="tabbar" aria-label="Main">
    <AppLink v-for="item in NAV_ITEMS" :key="item.to" :to="item.to" :active-for="item.activeFor" class="tab">
      <span class="pill"><Icon :name="item.icon" /></span>
      {{ item.label }}
    </AppLink>
  </nav>
</template>

<style scoped>
.tabbar {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--color-hairline);
  background: var(--color-surface);
  padding: 6px 8px calc(8px + var(--safe-bottom));
  z-index: 10;
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: var(--color-muted);
  text-decoration: none;
  font-size: 11.5px;
  padding: 6px 0;
  border-radius: var(--radius-row);
}
.tab[aria-current='page'] {
  color: var(--color-ink);
  font-weight: 700;
}
.pill {
  padding: 3px 16px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  transition: background-color 0.2s;
}
.tab[aria-current='page'] .pill {
  background: var(--color-sunken);
}
@media (min-width: 768px) {
  .tabbar {
    display: none;
  }
}
</style>
