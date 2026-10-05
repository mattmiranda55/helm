<script setup>
/**
 * The terminal page. App.vue keeps this mounted after the first visit, so the
 * shell keeps running while you look at other pages.
 */
import { computed, shallowRef, useTemplateRef } from 'vue'
import TerminalPane from './TerminalPane.vue'
import StatusText from '@/components/ui/StatusText.vue'
import { useAppConfig } from '@/composables/useAppConfig'

defineProps({
  active: { type: Boolean, default: true },
})

const { config } = useAppConfig()
const pane = useTemplateRef('pane')
const connection = shallowRef({ status: 'idle', detail: null })

const state = computed(() => {
  const { status, detail } = connection.value
  if (status === 'open') return { level: 'good', label: 'Connected' }
  if (status === 'connecting' || status === 'idle') return { level: 'muted', label: 'Connecting…' }
  return { level: 'critical', label: detail ?? 'Disconnected' }
})
</script>

<template>
  <div class="terminal-page">
    <div class="head">
      <div>
        <h1 class="page-title">Terminal</h1>
        <p class="page-sub">A shell on the machine helm runs on.</p>
      </div>
      <div class="status">
        <StatusText :level="state.level">{{ state.label }}</StatusText>
        <button v-if="connection.status === 'closed'" type="button" class="text-link" @click="pane?.reconnect()">
          Reconnect
        </button>
      </div>
    </div>

    <p v-if="!config.terminal.enabled" class="note">
      The terminal is turned off in this server's config (<code class="num">terminal.enabled</code>).
    </p>
    <TerminalPane v-else ref="pane" :commands="config.commands" :active="active" @status="connection = $event" />
  </div>
</template>

<style scoped>
.terminal-page {
  max-width: 1180px;
  margin-inline: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 12px;
  flex-wrap: wrap;
}
.status {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
