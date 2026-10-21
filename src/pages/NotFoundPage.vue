<script setup>
/**
 * The catch-all route sits under the tabs shell but under no tab button's
 * href, so no tab owns it. A "Go to Machines" link would be content switching
 * tabs, which Ionic reserves for the tab bar — and the tab bar is right here.
 * https://ionicframework.com/docs/vue/navigation#switching-between-tabs
 */
import HelmPage from '@/components/layout/HelmPage.vue'
</script>

<template>
  <HelmPage title="Not found">
    <div class="page">
      <div class="empty">
        <strong>That page doesn't exist</strong>
        <span>Pick a tab below to carry on.</span>
      </div>
    </div>
  </HelmPage>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 16px;
  color: var(--color-muted);
}
.empty strong {
  color: var(--color-ink);
  font-size: 1rem;
}
</style>
