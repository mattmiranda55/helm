<script setup>
/** Wordmark, the desktop nav, and whether the helm server is answering. */
import { computed } from 'vue'
import { NAV_ITEMS } from './navItems'
import AppLink from '@/components/ui/AppLink.vue'
import StatusText from '@/components/ui/StatusText.vue'
import { connection } from '@/lib/connection'

const live = computed(
  () =>
    ({
      live: { level: 'good', label: 'Live' },
      offline: { level: 'critical', label: 'Offline' },
      connecting: { level: 'muted', label: 'Connecting' },
    })[connection.value],
)
</script>

<template>
  <header class="header">
    <AppLink to="/" class="brand" translate="no">helm</AppLink>
    <nav class="nav" aria-label="Main">
      <AppLink v-for="item in NAV_ITEMS" :key="item.to" :to="item.to" :active-for="item.activeFor" class="nav-link">
        {{ item.label }}
      </AppLink>
    </nav>
    <span class="live" :title="connection === 'offline' ? 'The helm server is not answering' : undefined">
      <StatusText :level="live.level">{{ live.label }}</StatusText>
    </span>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 20px 10px;
  flex-shrink: 0;
}
.brand {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 20px;
  letter-spacing: -0.02em;
  color: var(--color-ink);
  text-decoration: none;
}
.nav {
  display: none;
  gap: 4px;
}
.nav-link {
  color: var(--color-ink-2);
  text-decoration: none;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 14px;
  transition: background-color 0.2s, color 0.2s;
}
.nav-link:hover {
  background: var(--color-sunken);
  color: var(--color-ink);
}
.nav-link[aria-current='page'] {
  background: var(--color-ink);
  color: var(--color-plane);
}
.live {
  margin-left: auto;
}
.live :deep(.status) {
  font-weight: 500;
  font-size: 13px;
}
@media (min-width: 768px) {
  .header {
    padding: 18px 32px 14px;
  }
  .nav {
    display: flex;
  }
}
</style>
