<script setup>
import { computed, ref } from 'vue'
import PanelCard from './PanelCard.vue'
import MeterBar from './MeterBar.vue'
import { bytes, percent } from '@/lib/format'
import { containerAction, fetchContainerLogs } from '@/lib/api'

const props = defineProps({
  containers: { type: Array, required: true },
  /** Only true for the machine this server runs on — see server/containers.ts. */
  canControl: { type: Boolean, default: false },
  nodeId: { type: String, default: null },
})

const emit = defineEmits(['changed'])

/** Stopping something by mis-tap on a phone is easy, so destructive actions
 *  ask first. Starting a stopped container does not need a confirmation. */
const confirming = ref(null) // { name, action }
const busy = ref(null)
const actionError = ref(null)
const logs = ref(null) // { name, text, loading }

function requestAction(container, action) {
  actionError.value = null
  if (action === 'start') return runAction(container.name, action)
  confirming.value = { name: container.name, action }
}

async function runAction(name, action) {
  confirming.value = null
  busy.value = name
  actionError.value = null
  try {
    await containerAction(props.nodeId, name, action)
    emit('changed')
  } catch (error) {
    actionError.value = `${action} ${name}: ${error.message}`
  } finally {
    busy.value = null
  }
}

async function openLogs(name) {
  logs.value = { name, text: '', loading: true }
  try {
    const result = await fetchContainerLogs(props.nodeId, name, 300)
    if (logs.value?.name === name) logs.value = { name, text: result.text, loading: false }
  } catch (error) {
    if (logs.value?.name === name) {
      logs.value = { name, text: `Could not read logs: ${error.message}`, loading: false }
    }
  }
}

const isRunning = (container) => container.status === 'running' || container.status === 'healthy' 

const query = ref('')

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.containers
  return props.containers.filter(
    (container) =>
      container.name.toLowerCase().includes(needle) ||
      String(container.image ?? '').toLowerCase().includes(needle),
  )
})

const running = computed(() => props.containers.filter((c) => c.status === 'running').length)

/** Status is state, so it wears a reserved status color — plus the word. */
const STATUS_COLOR = {
  running: 'var(--color-good)',
  paused: 'var(--color-warning)',
  exited: 'var(--color-muted)',
  created: 'var(--color-muted)',
  restarting: 'var(--color-serious)',
  dead: 'var(--color-critical)',
}
const statusColor = (status) => STATUS_COLOR[status] ?? 'var(--color-muted)'

/** CPU as a share of the cores the container is allowed, in 0-100. */
function cpuShare(container) {
  const cores = container.cpuLimit || 1
  return Math.min(container.cpu / cores, 100)
}

const shortImage = (image) => String(image ?? '—').replace(/^docker\.io\/(library\/)?/, '')
</script>

<template>
  <PanelCard
    title="Containers"
    :subtitle="`${running} of ${containers.length} running`"
    flush
  >
    <template #actions>
      <input
        v-model="query"
        type="search"
        placeholder="Filter"
        class="w-28 rounded-md border border-hairline bg-sunken px-2 py-1 text-[11px] text-ink placeholder:text-muted focus:border-[var(--color-series-1)] focus:outline-none"
      />
    </template>

    <p
      v-if="actionError"
      class="border-b border-hairline px-4 py-2 text-[11px]"
      :style="{ color: 'var(--color-critical)' }"
    >
      {{ actionError }}
    </p>

    <!-- Bounded beside the other panels on desktop; on a phone it just runs
         with the page rather than becoming a scroll box inside a scroll box. -->
    <div class="lg:max-h-[22rem] lg:overflow-y-auto">
      <!-- Phones get a stacked card per container. Four columns at 390px left
           the name column ~150px, which truncates almost every real container
           name; here the name owns a full line and wraps instead. -->
      <ul class="lg:hidden">
        <li
          v-for="container in visible"
          :key="container.name"
          class="border-t border-hairline px-4 py-2.5"
        >
          <div class="flex items-start gap-2">
            <span class="min-w-0 flex-1 font-mono text-[12px] break-words text-ink">
              {{ container.name }}
            </span>
            <span
              class="flex shrink-0 items-center gap-1.5 pt-0.5 text-[10px] whitespace-nowrap"
              :style="{ color: statusColor(container.status) }"
            >
              <span
                class="h-1.5 w-1.5 rounded-full"
                :style="{ background: statusColor(container.status) }"
              />
              {{ container.status }}
            </span>
          </div>

          <div class="truncate text-[10px] text-muted">
            {{ shortImage(container.image) }}<template v-if="container.uptime">
              · {{ container.uptime }}</template>
          </div>

          <div class="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div class="flex items-baseline justify-between text-[10px]">
                <span class="text-muted">CPU</span>
                <span class="tabular text-ink-2">{{ percent(container.cpu) }}</span>
              </div>
              <MeterBar class="mt-1" :value="cpuShare(container)" :height="3" />
            </div>
            <div>
              <div class="flex items-baseline justify-between text-[10px]">
                <span class="text-muted">Memory</span>
                <span class="tabular text-ink-2">{{ bytes(container.memory) }}</span>
              </div>
              <MeterBar class="mt-1" :value="container.memoryPercent" :height="3" />
            </div>
          </div>

          <!-- Actions live on the card itself: on a phone this is the whole
               point of the panel — see it broken, restart it. -->
          <div v-if="canControl" class="mt-2 border-t border-hairline pt-2">
            <div v-if="confirming?.name === container.name" class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-[11px] text-ink-2">
                {{ confirming.action }} {{ container.name }}?
              </span>
              <button
                type="button"
                class="shrink-0 rounded-md border border-hairline px-2 py-1 text-[11px] text-muted"
                @click="confirming = null"
              >
                Cancel
              </button>
              <button
                type="button"
                class="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium text-plane"
                :style="{ background: 'var(--color-critical)' }"
                @click="runAction(confirming.name, confirming.action)"
              >
                {{ confirming.action }}
              </button>
            </div>

            <div v-else class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 disabled:opacity-40"
                :disabled="busy === container.name"
                @click="openLogs(container.name)"
              >
                Logs
              </button>
              <button
                v-if="isRunning(container)"
                type="button"
                class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 disabled:opacity-40"
                :disabled="busy === container.name"
                @click="requestAction(container, 'restart')"
              >
                Restart
              </button>
              <button
                type="button"
                class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 disabled:opacity-40"
                :disabled="busy === container.name"
                @click="requestAction(container, isRunning(container) ? 'stop' : 'start')"
              >
                {{ isRunning(container) ? 'Stop' : 'Start' }}
              </button>
              <span v-if="busy === container.name" class="ml-auto text-[10px] text-muted">
                working…
              </span>
            </div>
          </div>
        </li>
        <li v-if="!visible.length" class="px-4 py-6 text-center text-[11px] text-muted">
          {{ containers.length ? 'No containers match that filter.' : 'No containers reported.' }}
        </li>
      </ul>

      <table class="hidden w-full text-[11px] lg:table">
        <thead class="sticky top-0 z-10 bg-surface">
          <tr class="text-muted">
            <th class="px-4 py-2 text-left font-medium">Container</th>
            <th class="px-2 py-2 text-left font-medium">Status</th>
            <th class="w-32 px-2 py-2 text-right font-medium">CPU</th>
            <th class="w-32 px-4 py-2 text-right font-medium">Memory</th>
            <th v-if="canControl" class="w-44 px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="container in visible"
            :key="container.name"
            class="border-t border-hairline hover:bg-raised"
          >
            <td class="max-w-0 px-4 py-2">
              <div class="truncate font-mono text-ink" :title="container.name">
                {{ container.name }}
              </div>
              <div class="truncate text-[10px] text-muted">{{ shortImage(container.image) }}</div>
            </td>
            <td class="px-2 py-2">
              <span class="flex items-center gap-1.5 whitespace-nowrap">
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  :style="{ background: statusColor(container.status) }"
                />
                <span :style="{ color: statusColor(container.status) }">{{ container.status }}</span>
              </span>
              <span class="text-[10px] text-muted">{{ container.uptime }}</span>
            </td>
            <td
              class="px-2 py-2 text-right"
              :title="
                container.cpuLimit
                  ? `${percent(container.cpu)} of ${container.cpuLimit} cores`
                  : percent(container.cpu)
              "
            >
              <div class="tabular text-ink-2">{{ percent(container.cpu) }}</div>
              <!-- cpu_percent sums across cores, so scale the meter to the
                   cores the container may use, not to a single core. -->
              <MeterBar class="mt-1" :value="cpuShare(container)" :height="3" />
            </td>
            <td class="px-4 py-2 text-right">
              <div class="tabular text-ink-2">{{ bytes(container.memory) }}</div>
              <MeterBar class="mt-1" :value="container.memoryPercent" :height="3" />
            </td>
            <td v-if="canControl" class="px-4 py-2 text-right whitespace-nowrap">
              <template v-if="confirming?.name === container.name">
                <button
                  type="button"
                  class="rounded-md border border-hairline px-2 py-1 text-[10px] text-muted"
                  @click="confirming = null"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="ml-1 rounded-md px-2 py-1 text-[10px] font-medium text-plane"
                  :style="{ background: 'var(--color-critical)' }"
                  @click="runAction(confirming.name, confirming.action)"
                >
                  {{ confirming.action }}
                </button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="rounded-md border border-hairline px-2 py-1 text-[10px] text-ink-2 disabled:opacity-40"
                  :disabled="busy === container.name"
                  @click="openLogs(container.name)"
                >
                  Logs
                </button>
                <button
                  v-if="isRunning(container)"
                  type="button"
                  class="ml-1 rounded-md border border-hairline px-2 py-1 text-[10px] text-ink-2 disabled:opacity-40"
                  :disabled="busy === container.name"
                  @click="requestAction(container, 'restart')"
                >
                  Restart
                </button>
                <button
                  type="button"
                  class="ml-1 rounded-md border border-hairline px-2 py-1 text-[10px] text-ink-2 disabled:opacity-40"
                  :disabled="busy === container.name"
                  @click="requestAction(container, isRunning(container) ? 'stop' : 'start')"
                >
                  {{ isRunning(container) ? 'Stop' : 'Start' }}
                </button>
              </template>
            </td>
          </tr>
          <tr v-if="!visible.length">
            <td :colspan="canControl ? 5 : 4" class="px-4 py-6 text-center text-muted">
              {{ containers.length ? 'No containers match that filter.' : 'No containers reported.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Logs open as a sheet rather than inline: on a phone there is nowhere
         near enough room to show them beside the list. -->
    <Teleport to="body">
      <div
        v-if="logs"
        class="safe-overlay fixed inset-0 z-50 flex flex-col bg-plane/95 backdrop-blur-sm"
        @click.self="logs = null"
      >
        <div
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-sunken"
        >
          <header class="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5">
            <h3 class="truncate font-mono text-[13px] text-ink">{{ logs.name }}</h3>
            <span class="text-[11px] text-muted">last 300 lines</span>
            <button
              type="button"
              class="ml-auto shrink-0 rounded-md border border-hairline px-3 py-2 text-[12px] text-ink-2 hover:bg-raised hover:text-ink"
              @click="openLogs(logs.name)"
            >
              Refresh
            </button>
            <button
              type="button"
              class="shrink-0 rounded-md border border-hairline px-3 py-2 text-[12px] font-medium text-ink hover:bg-raised"
              aria-label="Close logs"
              @click="logs = null"
            >
              Close
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-auto p-3">
            <p v-if="logs.loading" class="text-[11px] text-muted">Loading…</p>
            <pre
              v-else
              class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2"
              >{{ logs.text }}</pre
            >
          </div>
        </div>
      </div>
    </Teleport>
  </PanelCard>
</template>
