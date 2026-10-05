<script setup>
import { computed } from 'vue'
import { uptime as formatUptime } from '@/lib/format'

const props = defineProps({
  nodes: { type: Array, required: true },
  activeId: { type: String, default: null },
  system: { type: Object, default: null },
  /** null = healthy, otherwise the last error message. */
  error: { type: String, default: null },
  stale: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  paneOpen: { type: Boolean, default: true },
})

const emit = defineEmits(['select', 'toggle-pane'])

const state = computed(() => {
  if (props.error) return { label: 'unreachable', color: 'var(--color-critical)' }
  if (props.stale) return { label: 'stale', color: 'var(--color-warning)' }
  if (props.loading) return { label: 'connecting', color: 'var(--color-muted)' }
  return { label: 'live', color: 'var(--color-good)' }
})
</script>

<template>
  <header
    class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-surface px-4 py-2.5"
  >
    <div class="flex items-center gap-2">
      <span class="font-mono text-[13px] font-semibold text-ink">helm</span>
      <span class="font-mono text-[13px] text-muted">tools</span>
    </div>

    <nav v-if="nodes.length > 1" class="flex overflow-hidden rounded-lg border border-hairline">
      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        class="px-3 py-1 text-[12px] transition-colors"
        :class="
          node.id === activeId
            ? 'bg-raised font-medium text-ink'
            : 'text-muted hover:bg-raised hover:text-ink-2'
        "
        @click="emit('select', node.id)"
      >
        {{ node.label }}
      </button>
    </nav>
    <span v-else-if="nodes.length === 1" class="text-[12px] font-medium text-ink">
      {{ nodes[0].label }}
    </span>

    <p v-if="system?.os" class="hidden truncate text-[11px] text-muted lg:block">
      {{ system.os }}
    </p>

    <div class="ml-auto flex items-center gap-4">
      <span v-if="system?.uptime" class="text-[11px] text-muted">
        up {{ formatUptime(system.uptime) }}
      </span>

      <span class="flex items-center gap-1.5 text-[11px]" :style="{ color: state.color }">
        <span class="h-1.5 w-1.5 rounded-full" :style="{ background: state.color }" />
        {{ state.label }}
      </span>

      <!-- Names the thing it toggles rather than the container it lives in:
           "Panel" told you nothing about what would appear or disappear. -->
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
        :class="
          paneOpen
            ? 'border-transparent bg-raised text-ink'
            : 'border-hairline text-muted hover:bg-raised hover:text-ink-2'
        "
        :aria-pressed="paneOpen"
        :title="paneOpen ? 'Hide services and terminal' : 'Show services and terminal'"
        @click="emit('toggle-pane')"
      >
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          aria-hidden="true"
        >
          <rect x="1.5" y="2.75" width="13" height="10.5" rx="2" />
          <line x1="10" y1="2.75" x2="10" y2="13.25" />
          <rect v-if="paneOpen" x="10" y="2.75" width="4.5" height="10.5" fill="currentColor" />
        </svg>
        Services &amp; terminal
      </button>
    </div>
  </header>
</template>
