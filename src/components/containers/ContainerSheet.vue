<script setup>
/**
 * One container: its state, the actions that apply to it, and recent logs.
 *
 * Stop asks first, with the native action sheet; start and restart don't —
 * a restart comes straight back, so a confirmation would only be a speed bump.
 * The actions sit in the sheet's footer so they stay in reach of your thumb
 * however far the logs are scrolled.
 *
 * Self-contained, so any page can show it (an inline ion-modal stays where it
 * is declared): the parent owns `open` and should turn it off when its page
 * is left — Ionic keeps that page mounted, so an open modal would otherwise
 * stay up over the next one. `changed` asks the parent to re-poll.
 */
import { IonButton, IonIcon, IonSpinner } from '@ionic/vue'
import { refresh } from 'ionicons/icons'
import { computed, shallowRef, watch } from 'vue'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import StatusText from '@/components/ui/StatusText.vue'
import { useConfirm } from '@/composables/useConfirm'
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

/**
 * What the sheet shows. The modal keeps rendering through its dismiss
 * animation, by which time the parent has usually let go of the container (and
 * its stack, service and capabilities with it), so hold the last open state
 * rather than blanking or reflowing the sheet as it slides away.
 */
const shown = shallowRef(null)
watch(
  () => ({ ...props }),
  (next) => {
    if (next.open && next.container) shown.value = next
  },
  { immediate: true },
)
const container = computed(() => shown.value?.container ?? null)

const { confirm } = useConfirm()
const { show } = useToast()
const busy = shallowRef(null)
const actionError = shallowRef(null)
const logs = shallowRef({ text: '', loading: false, error: null })

const running = computed(() => ['running', 'healthy'].includes(container.value?.status))
const live = computed(() => running.value || container.value?.status === 'restarting')

const state = computed(() => {
  const status = container.value?.status
  if (running.value) return { level: 'good', label: 'Running' }
  if (status === 'restarting') return { level: 'critical', label: 'Restarting' }
  if (status === 'dead') return { level: 'critical', label: 'Dead' }
  if (status === 'paused') return { level: 'warning', label: 'Paused' }
  return { level: 'muted', label: 'Stopped' }
})

const image = computed(() => String(container.value?.image ?? '').replace(/^docker\.io\/(library\/)?/, ''))

async function loadLogs() {
  if (!container.value || !shown.value.canControl) return
  const { nodeId } = shown.value
  const name = container.value.name
  logs.value = { ...logs.value, loading: true, error: null }
  try {
    const result = await fetchContainerLogs(nodeId, name, 150)
    if (container.value?.name === name) logs.value = { text: result.text, loading: false, error: null }
  } catch (cause) {
    if (container.value?.name === name) logs.value = { text: '', loading: false, error: cause.message }
  }
}

// Reset on opening (or switching container), not on closing — closing would
// change what the sheet shows while it is still sliding away.
watch(
  [() => props.open, () => props.container?.name],
  ([open]) => {
    if (!open) return
    actionError.value = null
    logs.value = { text: '', loading: false, error: null }
    loadLogs()
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
  const name = container.value.name
  if (action === 'stop') {
    const ok = await confirm({
      header: `Stop ${name}?`,
      message: `It stays stopped until you start it again${shown.value.service ? `, and ${shown.value.service.name} won't load meanwhile` : ''}.`,
      action: 'Stop',
    })
    // The sheet may have closed or moved on while the action sheet was up.
    if (!ok || container.value?.name !== name || busy.value) return
  }
  busy.value = action
  actionError.value = null
  try {
    await containerAction(shown.value.nodeId, name, action)
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
  <BottomSheet :open="open && !!props.container" :title="container?.name ?? ''" :subtitle="image" mono-subtitle @close="emit('close')">
    <template v-if="container">
      <div class="state-line">
        <StatusText :level="state.level">{{ state.label }}</StatusText>
        <span v-if="running && container.uptime" class="since">for {{ container.uptime }}</span>
      </div>

      <dl class="kv">
        <div><dt>Machine</dt><dd>{{ shown.machine }}</dd></div>
        <div><dt>Stack</dt><dd translate="no">{{ shown.stack ?? 'None' }}</dd></div>
        <template v-if="running">
          <div><dt>CPU</dt><dd class="num">{{ container.cpu.toFixed(1) }}%</dd></div>
          <div><dt>Memory</dt><dd class="num">{{ bytes(container.memory) }}</dd></div>
        </template>
      </dl>

      <p v-if="!shown.canControl" class="note">View only. {{ shown.viewOnly }}</p>

      <p v-if="actionError" class="error">{{ actionError }}</p>

      <section v-if="shown.canControl">
        <div class="logs-head">
          <h3 class="logs-title">Recent logs</h3>
          <ion-button fill="clear" size="small" class="logs-refresh" :disabled="logs.loading" @click="loadLogs">
            <ion-spinner v-if="logs.loading" slot="start" name="crescent" class="spinner" aria-hidden="true" />
            <ion-icon v-else slot="start" :icon="refresh" aria-hidden="true" />
            {{ logs.loading ? 'Loading…' : 'Refresh' }}
          </ion-button>
        </div>
        <pre class="logs" translate="no">{{ logs.error ? `Couldn't read logs: ${logs.error}` : logs.text || (logs.loading ? 'Loading…' : 'No output.') }}</pre>
      </section>
    </template>

    <template v-if="container && shown.canControl" #footer>
      <div class="actions">
        <ion-button
          v-if="shown.service && running"
          class="action"
          :href="shown.service.url"
          target="_blank"
          rel="noopener noreferrer"
        >Open {{ shown.service.name }}</ion-button>
        <ion-button v-if="live" class="action" fill="outline" :disabled="!!busy" @click="run('restart')">
          <ion-spinner v-if="busy === 'restart'" slot="start" name="crescent" class="spinner" aria-hidden="true" />
          {{ busy === 'restart' ? 'Restarting…' : 'Restart' }}
        </ion-button>
        <ion-button v-else class="action" :disabled="!!busy" @click="run('start')">
          <ion-spinner v-if="busy === 'start'" slot="start" name="crescent" class="spinner" aria-hidden="true" />
          {{ busy === 'start' ? 'Starting…' : 'Start' }}
        </ion-button>
        <ion-button v-if="live" class="action" fill="outline" color="danger" :disabled="!!busy" @click="run('stop')">
          <ion-spinner v-if="busy === 'stop'" slot="start" name="crescent" class="spinner" aria-hidden="true" />
          {{ busy === 'stop' ? 'Stopping…' : 'Stop' }}
        </ion-button>
      </div>
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
  font-size: 0.875rem;
}
.kv {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px 16px;
}
.kv dt {
  color: var(--color-muted);
  font-size: 0.8125rem;
}
.kv dd {
  font-size: 0.9375rem;
  overflow-wrap: anywhere;
}
/* Side by side, sharing the footer's width; a long "Open …" wraps the rest
 * onto a second row rather than squeezing them. */
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.action {
  flex: 1 1 0;
  min-width: max-content;
  margin: 0;
}
.spinner {
  width: 16px;
  height: 16px;
  margin-inline-end: 6px;
  color: currentColor;
}
.error {
  color: var(--color-critical);
  font-size: 0.875rem;
}
.logs-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.logs-refresh {
  margin: 0 -8px 0 0;
}
.logs-title {
  font-size: 0.875rem;
  color: var(--color-muted);
  font-weight: 500;
}
/* No max-height/overflow of its own: the sheet's ion-content scrolls the
 * logs. A nested scroller would fight the sheet's drag gesture, which only
 * checks ion-content's scroll position — dragging down to scroll a scrolled
 * log back up would pull the sheet down instead. */
.logs {
  background: var(--color-term);
  color: var(--color-term-ink);
  border-radius: 8px;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 0.7188rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
