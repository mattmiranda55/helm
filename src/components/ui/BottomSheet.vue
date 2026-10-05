<script setup>
/**
 * Slides up from the bottom on a phone, in from the right on a wide screen.
 * Used for anything you act on (a container, a stack) so the list behind it
 * stays put. Escape and the scrim close it.
 */
import { nextTick, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  /** Show the subtitle in the mono face (container image names). */
  monoSubtitle: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const closeButton = useTemplateRef('closeButton')

function onKey(event) {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKey)
      nextTick(() => closeButton.value?.focus({ preventScroll: true }))
    } else {
      window.removeEventListener('keydown', onKey)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="scrim">
    <div v-if="open" class="scrim" @click="emit('close')" />
  </Transition>
  <Transition name="sheet">
    <aside v-if="open" class="sheet" role="dialog" aria-modal="true" :aria-label="title">
      <div class="grab" aria-hidden="true" />
      <header class="head">
        <div class="min-w-0">
          <h2 class="title">{{ title }}</h2>
          <p v-if="subtitle" class="subtitle" :class="{ num: monoSubtitle }">{{ subtitle }}</p>
        </div>
        <button ref="closeButton" type="button" class="close" aria-label="Close" @click="emit('close')">
          <Icon name="close" :size="22" />
        </button>
      </header>
      <div class="body">
        <slot />
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgb(10 12 14 / 0.4);
  z-index: 30;
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 86dvh;
  background: var(--color-surface);
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  box-shadow: 0 -8px 32px rgb(0 0 0 / 0.18);
  z-index: 31;
  display: flex;
  flex-direction: column;
}
.grab {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-hairline);
  margin: 8px auto 0;
  flex-shrink: 0;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 12px 4px 20px;
}
.title {
  font-size: 22px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.subtitle {
  color: var(--color-muted);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.subtitle.num {
  font-size: 12.5px;
}
.close {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--color-muted);
  flex-shrink: 0;
  transition: background-color 0.2s;
}
.close:hover {
  background: var(--color-sunken);
  color: var(--color-ink);
}
.body {
  padding: 8px 20px calc(20px + var(--safe-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.scrim-enter-active,
.scrim-leave-active {
  transition: opacity 0.25s;
}
.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(102%);
}

@media (min-width: 768px) {
  .sheet {
    left: auto;
    top: 0;
    width: 440px;
    max-height: none;
    border-radius: var(--radius-card) 0 0 var(--radius-card);
    padding-top: var(--safe-top);
  }
  .grab {
    display: none;
  }
  .head {
    padding-top: 22px;
  }
  .sheet-enter-from,
  .sheet-leave-to {
    transform: translateX(102%);
  }
}
</style>
