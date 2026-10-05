<script setup>
/**
 * The right-hand pane: service launcher and terminal, as tabs.
 *
 * Services is the default tab — this replaces a Homepage instance, and opening
 * a link is the common case. The terminal is mounted lazily on first visit and
 * then kept alive behind v-show, so switching tabs never kills a running shell.
 */
import { computed, ref, watch } from 'vue'
import ServicesPanel from './ServicesPanel.vue'
import TerminalPane from './TerminalPane.vue'

const props = defineProps({
  services: { type: Array, default: () => [] },
  containers: { type: Array, default: () => [] },
  nodeId: { type: String, default: null },
  commands: { type: Array, default: () => [] },
  terminalEnabled: { type: Boolean, default: true },
})

/**
 * Services follow the node tab: looking at MagicMirror should show what runs on
 * MagicMirror. A service with no `node` is treated as belonging everywhere,
 * which is the right answer for things that are not tied to one machine (a
 * router UI, something hosted off-site).
 */
const visibleServices = computed(() =>
  props.services.filter((service) => !service.node || service.node === props.nodeId),
)

const tabs = computed(() =>
  [
    { key: 'services', label: 'Services' },
    props.terminalEnabled ? { key: 'terminal', label: 'Terminal' } : null,
  ].filter(Boolean),
)

const active = ref(
  new URLSearchParams(location.search).get('tab') ?? localStorage.getItem('tools.tab') ?? 'services',
)
if (!tabs.value.some((tab) => tab.key === active.value)) active.value = 'services'
watch(active, (tab) => localStorage.setItem('tools.tab', tab))

// Mount xterm on first visit only, then keep it. Its chunk is 83KB gzipped and
// a live shell is worth preserving across tab switches.
const terminalTouched = ref(active.value === 'terminal')
watch(active, (tab) => {
  if (tab === 'terminal') terminalTouched.value = true
})

const terminal = ref(null)

const STATUS_COLOR = {
  idle: 'var(--color-muted)',
  connecting: 'var(--color-warning)',
  open: 'var(--color-good)',
  closed: 'var(--color-muted)',
  error: 'var(--color-critical)',
}
const status = computed(() => terminal.value?.status ?? 'idle')
</script>

<template>
  <!-- Stacked on a phone the pane sizes to its content, so the page scrolls as
       one; the terminal is the exception, since xterm needs a bounded height. -->
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-hairline bg-sunken lg:h-full"
    :class="active === 'terminal' ? 'h-[60vh] lg:h-full' : ''"
  >
    <!-- Wraps rather than squeezing: on a phone the action buttons drop to
         their own row instead of crushing the tab labels. -->
    <header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-2 py-2">
      <nav class="flex shrink-0 overflow-hidden rounded-lg border border-hairline">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="px-3 py-1 text-[12px] transition-colors"
          :class="
            active === tab.key
              ? 'bg-raised font-medium text-ink'
              : 'text-muted hover:bg-raised hover:text-ink-2'
          "
          @click="active = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <template v-if="active === 'terminal'">
        <span class="flex items-center gap-1.5 text-[11px]" :style="{ color: STATUS_COLOR[status] }">
          <span class="h-1.5 w-1.5 rounded-full" :style="{ background: STATUS_COLOR[status] }" />
          {{ status }}
        </span>
        <span v-if="terminal?.detail" class="truncate text-[11px] text-muted">
          {{ terminal.detail }}
        </span>

        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            class="rounded-md border px-2 py-1 text-[11px] transition-colors"
            :class="
              terminal?.keysOpen
                ? 'border-transparent bg-raised text-ink'
                : 'border-hairline text-ink-2 hover:bg-raised hover:text-ink'
            "
            title="On-screen Ctrl, Esc, Tab and arrows"
            @click="terminal?.toggleKeys()"
          >
            Keys
          </button>
          <button
            v-if="commands.length"
            type="button"
            class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
            @click="terminal?.toggleCommands()"
          >
            Commands
          </button>
          <button
            type="button"
            class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
            @click="terminal?.clear()"
          >
            Clear
          </button>
          <button
            v-if="status !== 'open'"
            type="button"
            class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
            @click="terminal?.reconnect()"
          >
            Reconnect
          </button>
        </div>
      </template>

      <span v-else class="ml-auto shrink-0 pr-1 text-[11px] text-muted">
        {{ visibleServices.length }} {{ visibleServices.length === 1 ? 'service' : 'services' }}
      </span>
    </header>

    <ServicesPanel
      v-show="active === 'services'"
      class="min-h-0 flex-1"
      :services="visibleServices"
      :containers="containers"
      :node-id="nodeId"
    />

    <TerminalPane
      v-if="terminalTouched"
      v-show="active === 'terminal'"
      ref="terminal"
      :commands="commands"
      :active="active === 'terminal'"
    />
  </section>
</template>
