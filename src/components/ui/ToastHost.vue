<script setup>
import { useToast } from '@/composables/useToast'

const { message } = useToast()
</script>

<template>
  <div class="host" role="status" aria-live="polite">
    <Transition name="toast">
      <p v-if="message" class="toast">{{ message }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.host {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(84px + var(--safe-bottom));
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 40;
  padding-inline: 16px;
}
.toast {
  background: var(--color-ink);
  color: var(--color-plane);
  padding: 10px 16px;
  border-radius: 999px;
  font-size: 14px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
@media (min-width: 768px) {
  .host {
    bottom: 28px;
  }
}
</style>
