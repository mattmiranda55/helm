<script setup>
/**
 * One container: its state, the actions that apply to it, and recent logs.
 * Stop asks for a second tap; start and restart don't.
 */
import { computed, shallowRef, watch } from 'vue'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import StatusText from '@/components/ui/StatusText.vue'
import { useArmed } from '@/composables/useArmed'
import { useToast } from '@/composables/useToast'
import { containerAction, fetchContainerLogs } from '@/lib/api'
import { bytes } from '@/lib/format'

const props = defineProps({
  open: { type: Boolean, default: false },
  container: { type: Object, default: null },
  nodeId: { type: String, required: true },
  machine: { type: String, required: true },
  canControl: { type: Boolean, default: false },
  /** Why it's view-only, when it is. */
  viewOnly: { type: String, default: null },
  stack: { type: String, default: null },
  /** The configured app backed by this container, for an "Open" button. */
  service: { type: Object, default: null },
})

const emit = defineEmits(['close', 'changed'])

const { armed, confirm, disarm } = useArmed()
const { show } = useToast()
const busy = shallowRef(null)
const actionError = shallowRef(null)
const logs = shallowRef({ text: '', loading: false, error: null })

const running = computed(() => ['running', 'healthy'].includes(props.container?.status))
const live = computed(() => running.value || props.container?.status === 'restarting')

const state = computed(() => {
  const status = props.container?.status
  if (running.value) return { level: 'good', label: 'Running' }
  if (status === 'restarting') return { level: 'critical', label: 'Restarting' }
  if (status === 'dead') return { level: 'critical', label: 'Dead' }
  if (status === 'paused') return { level: 'warning', label: 'Paused' }
  return { level: 'muted', label: 'Stopped' }
})

const image = computed(() => String(props.container?.image ?? '').replace(/^docker\.io\/(library\/)?/, ''))

async function loadLogs() {
  if (!props.container || !props.canControl) return
  const name = props.container.name
  logs.value = { ...logs.value, loading: true, error: null }
  try {
    const result = await fetchContainerLogs(props.nodeId, name, 150)
    if (props.container?.name === name) logs.value = { text: result.text, loading: false, error: null }
  } catch (cause) {
    if (props.container?.name === name) logs.value = { text: '', loading: false, error: cause.message }
  }
}

watch(
  [() => props.open, () => props.container?.name],
  ([open]) => {
    disarm()
    actionError.value = null
    if (open) {
      logs.value = { text: '', loading: false, error: null }
      loadLogs()
    }
  },
  { immediate: true },
)

// Opened from a link, the sheet can appear before the machine's capabilities
// arrive; fetch the logs once we know they can be read.
watch(
  () => props.canControl,
  (can) => {
    if (can && props.open && !logs.value.text) loadLogs()
  },
)

const PAST = { start: 'Started', stop: 'Stopped', restart: 'Restarted' }

async function run(action) {
  const name = props.container.name
  if (action === 'stop' && !confirm(`stop:${name}`)) return
  busy.value = action
  actionError.value = null
  try {
    await containerAction(props.nodeId, name, action)
    show(`${PAST[action]} ${name}`)
    emit('changed')
    loadLogs()
  } catch (cause) {
    actionError.value = `Couldn't ${action} ${name}: ${cause.message}`
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <BottomSheet :open="open && !!container" :title="container?.name ?? ''" :subtitle="image" mono-subtitle @close="emit('close')">
    <template v-if="container">
      <div class="state-line">
        <StatusText :level="state.level">{{ state.label }}</StatusText>
        <span v-if="running && container.uptime" class="since">for {{ container.uptime }}</span>
      </div>

      <dl class="kv">
        <div><dt>Machine</dt><dd>{{ machine }}</dd></div>
        <div><dt>Stack</dt><dd translate="no">{{ stack ?? 'None' }}</dd></div>
        <template v-if="running">
          <div><dt>CPU</dt><dd class="num">{{ container.cpu.toFixed(1) }}%</dd></div>
          <div><dt>Memory</dt><dd class="num">{{ bytes(container.memory) }}</dd></div>
        </template>
      </dl>

      <div v-if="canControl" class="actions">
        <a v-if="service && running" class="btn btn-primary" :href="service.url" target="_blank" rel="noopener noreferrer">Open {{ service.name }}</a>
        <button v-if="live" type="button" class="btn" :disabled="!!busy" @click="run('restart')">
          {{ busy === 'restart' ? 'Restarting…' : 'Restart' }}
        </button>
        <button v-else type="button" class="btn btn-primary" :disabled="!!busy" @click="run('start')">
          {{ busy === 'start' ? 'Starting…' : 'Start' }}
        </button>
        <button
          v-if="live"
          type="button"
          class="btn btn-danger"
          :class="{ 'btn-armed': armed === `stop:${container.name}` }"
          :disabled="!!busy"
          @click="run('stop')"
        >
          {{ busy === 'stop' ? 'Stopping…' : armed === `stop:${container.name}` ? 'Tap again to stop' : 'Stop' }}
        </button>
      </div>
      <p v-else class="note">View only. {{ viewOnly }}</p>

      <p v-if="actionError" class="error">{{ actionError }}</p>

      <section v-if="canControl">
        <div class="logs-head">
          <h3 class="logs-title">Recent logs</h3>
          <button type="button" class="text-link" :disabled="logs.loading" @click="loadLogs">
            {{ logs.loading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
        <pre class="logs" translate="no">{{ logs.error ? `Couldn't read logs: ${logs.error}` : logs.text || (logs.loading ? 'Loading…' : 'No output.') }}</pre>
      </section>
    </template>
  </BottomSheet>
</template>

<style scoped>
.state-line {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.since {
  color: var(--color-muted);
  font-size: 14px;
}
.kv {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px 16px;
}
.kv dt {
  color: var(--color-muted);
  font-size: 13px;
}
.kv dd {
  font-size: 15px;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.error {
  color: var(--color-critical);
  font-size: 14px;
}
.logs-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.logs-title {
  font-size: 14px;
  color: var(--color-muted);
  font-weight: 500;
}
.logs {
  background: var(--color-term);
  color: var(--color-term-ink);
  border-radius: 8px;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 300px;
  overflow-y: auto;
}
</style>
