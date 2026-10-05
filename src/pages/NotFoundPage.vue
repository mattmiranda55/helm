<script setup>
import AppLink from '@/components/ui/AppLink.vue'
</script>

<template>
  <div class="page">
    <div class="empty">
      <strong>That page doesn't exist</strong>
      <AppLink to="/" class="text-link">Go to Machines</AppLink>
    </div>
  </div>
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
  font-size: 16px;
}
</style>
