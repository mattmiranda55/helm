<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TopBar from './components/TopBar.vue'
import StatTile from './components/StatTile.vue'
import CpuPanel from './components/CpuPanel.vue'
import MemoryPanel from './components/MemoryPanel.vue'
import NetworkPanel from './components/NetworkPanel.vue'
import StoragePanel from './components/StoragePanel.vue'
import SensorsPanel from './components/SensorsPanel.vue'
import ContainersPanel from './components/ContainersPanel.vue'
import StacksPanel from './components/StacksPanel.vue'
import ProcessPanel from './components/ProcessPanel.vue'
import SidePane from './components/SidePane.vue'
import { useMetrics } from './composables/useMetrics'
import { fetchAppConfig } from './lib/api'
import { read } from './lib/history'
import { bytes, percent, temperature, uptime } from './lib/format'

const appConfig = ref({
  refreshMs: 5000,
  nodes: [],
  commands: [],
  services: [],
  terminal: { enabled: true },
})
const configError = ref(null)

// URL wins over the remembered choice, so a view can be bookmarked or shared:
//   /?node=laptop&tab=terminal
const urlParams = new URLSearchParams(location.search)
const activeId = ref(urlParams.get('node') ?? localStorage.getItem('tools.node'))
const paneOpen = ref(localStorage.getItem('tools.pane') !== 'closed')
const processesOpen = ref(localStorage.getItem('tools.processes') === 'open')

const refreshMs = computed(() => appConfig.value.refreshMs)
const { metrics, processes, error, loading, misses, capabilities, refresh } =
  useMetrics(activeId, refreshMs, processesOpen)

onMounted(async () => {
  try {
    const config = await fetchAppConfig()
    appConfig.value = config
    if (!config.nodes.some((node) => node.id === activeId.value)) {
      activeId.value = config.nodes[0]?.id ?? null
    }
  } catch (cause) {
    configError.value = cause.message
  }
})

watch(activeId, (id) => id && localStorage.setItem('tools.node', id))
watch(paneOpen, (open) => localStorage.setItem('tools.pane', open ? 'open' : 'closed'))
watch(processesOpen, (open) => localStorage.setItem('tools.processes', open ? 'open' : 'closed'))

// --- history for the sparklines, keyed to the node currently on screen ------
const nodeId = computed(() => metrics.value?.node.id ?? null)
const series = (name) => (nodeId.value ? read(nodeId.value, name) : [])
// `metrics` is the tick signal; re-read the ring buffers whenever it lands.
const histories = computed(() => {
  void metrics.value
  return {
    cpu: series('cpu'),
    mem: series('mem'),
    rx: series('net.rx'),
    tx: series('net.tx'),
    read: series('disk.read'),
    write: series('disk.write'),
  }
})

const hottest = computed(() => {
  const sensors = (metrics.value?.sensors ?? []).filter((s) => s.unit === 'C' || s.unit === 'F')
  return sensors.reduce((max, s) => (s.value > (max?.value ?? -Infinity) ? s : max), null)
})

const loadPercent = computed(() => {
  const { min1, cores } = metrics.value?.load ?? {}
  return min1 != null && cores ? (min1 / cores) * 100 : null
})

// --- resizable terminal pane -----------------------------------------------
const paneWidth = ref(Number(localStorage.getItem('tools.paneWidth')) || 560)
const dragging = ref(false)
const isWide = ref(window.matchMedia('(min-width: 1024px)').matches)
const wideQuery = window.matchMedia('(min-width: 1024px)')
const onWidth = (event) => (isWide.value = event.matches)
wideQuery.addEventListener('change', onWidth)
// The pixel width only applies to the side-by-side layout; stacked, it is full
// width and an inline width would break the phone layout.
const paneStyle = computed(() => (isWide.value ? { width: `${paneWidth.value}px` } : {}))

function startDrag(event) {
  dragging.value = true
  event.preventDefault()
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
}
function onDrag(event) {
  const next = window.innerWidth - event.clientX
  paneWidth.value = Math.min(Math.max(next, 320), window.innerWidth - 400)
}
function endDrag() {
  dragging.value = false
  localStorage.setItem('tools.paneWidth', String(Math.round(paneWidth.value)))
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
}
onBeforeUnmount(() => {
  endDrag()
  wideQuery.removeEventListener('change', onWidth)
})
</script>

<template>
  <div class="flex h-full flex-col bg-plane" :class="dragging ? 'cursor-col-resize select-none' : ''">
    <TopBar
      :nodes="appConfig.nodes"
      :active-id="activeId"
      :system="metrics?.system"
      :error="metrics ? null : error"
      :stale="misses > 0 && !!metrics"
      :loading="loading"
      :pane-open="paneOpen"
      @select="activeId = $event"
      @toggle-pane="paneOpen = !paneOpen"
    />

    <main
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row lg:overflow-hidden"
    >
      <div class="order-2 min-w-0 flex-1 lg:order-1 lg:min-h-0 lg:overflow-y-auto">
        <p
          v-if="configError"
          class="rounded-xl border px-4 py-3 text-[12px]"
          style="border-color: var(--color-critical); color: var(--color-critical)"
        >
          Could not load config: {{ configError }}
        </p>

        <p
          v-else-if="!appConfig.nodes.length"
          class="rounded-xl border border-hairline bg-surface px-4 py-3 text-[12px] text-muted"
        >
          No nodes configured. Copy
          <code class="font-mono text-ink-2">config.example.json</code> to
          <code class="font-mono text-ink-2">config.json</code>, add your Glances hosts, and restart
          the server.
        </p>

        <p
          v-else-if="!metrics && error"
          class="rounded-xl border px-4 py-3 text-[12px]"
          style="border-color: var(--color-critical); color: var(--color-critical)"
        >
          {{ error }}
        </p>

        <p
          v-else-if="!metrics"
          class="rounded-xl border border-hairline bg-surface px-4 py-3 text-[12px] text-muted"
        >
          Connecting…
        </p>

        <div v-else class="fade-in flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label="CPU"
              :value="percent(metrics.cpu.total)"
              :caption="`${metrics.cpu.cores} cores`"
              :level="metrics.cpu.total"
              :history="histories.cpu"
              :interval-ms="refreshMs"
              :format="(v) => percent(v)"
            />
            <StatTile
              label="Memory"
              :value="percent(metrics.mem.percent)"
              :caption="`${bytes(metrics.mem.available)} free`"
              :level="metrics.mem.percent"
              :history="histories.mem"
              :interval-ms="refreshMs"
              :format="(v) => percent(v)"
            />
            <StatTile
              label="Load"
              :value="(metrics.load.min1 ?? 0).toFixed(2)"
              :caption="`${metrics.processes.total} procs · ${metrics.processes.threads} threads`"
              :level="loadPercent"
              :format="(v) => percent(v)"
            />
            <StatTile
              v-if="hottest"
              label="Temp"
              :value="temperature(hottest.value, hottest.unit)"
              :caption="hottest.label"
              :level="(hottest.value / (hottest.critical ?? 100)) * 100"
              :thresholds="{ warn: 70, serious: 85, critical: 95 }"
            />
            <StatTile
              v-else
              label="Uptime"
              :value="uptime(metrics.system.uptime)"
              :caption="metrics.system.hostname"
            />
          </div>

          <div class="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            <CpuPanel
              :cpu="metrics.cpu"
              :load="metrics.load"
              :history="histories.cpu"
              :interval-ms="refreshMs"
            />
            <MemoryPanel :mem="metrics.mem" :swap="metrics.swap" />
            <NetworkPanel
              :interfaces="metrics.network"
              :rx-history="histories.rx"
              :tx-history="histories.tx"
              :interval-ms="refreshMs"
            />
            <StoragePanel
              :fs="metrics.fs"
              :disks="metrics.disks"
              :read-history="histories.read"
              :write-history="histories.write"
              :interval-ms="refreshMs"
            />
            <SensorsPanel :sensors="metrics.sensors" />
            <StacksPanel
              v-if="capabilities.stacks"
              :template="appConfig.stacks?.template"
              :env-template="appConfig.stacks?.envTemplate"
            />
            <ContainersPanel
              :containers="metrics.containers"
              :can-control="capabilities.containers"
              :node-id="activeId"
              @changed="refresh"
            />
          </div>

          <!-- Collapsed by default: the process list is the most expensive
               thing we can ask Glances for, so it is opt-in. -->
          <div v-if="!processesOpen" class="rounded-xl border border-hairline bg-surface">
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised"
              @click="processesOpen = true"
            >
              <span class="text-[13px] font-semibold text-ink">Processes</span>
              <span class="text-[11px] text-muted">
                off by default — polling it costs the node noticeably more
              </span>
              <span class="ml-auto text-[11px] text-muted">Show</span>
            </button>
          </div>
          <div v-else class="relative">
            <ProcessPanel :processes="processes" />
            <button
              type="button"
              class="absolute top-2.5 right-4 text-[11px] text-muted hover:text-ink"
              @click="processesOpen = false"
            >
              Hide
            </button>
          </div>
        </div>
      </div>

      <!-- Drag handle, desktop only; the stacked layout has no side pane. -->
      <div
        v-if="paneOpen"
        class="order-3 hidden w-1 shrink-0 cursor-col-resize rounded-full transition-colors hover:bg-baseline lg:block"
        :class="dragging ? 'bg-baseline' : 'bg-transparent'"
        @mousedown="startDrag"
      />

      <SidePane
        v-if="paneOpen"
        class="order-1 shrink-0 lg:order-4"
        :style="paneStyle"
        :services="appConfig.services"
        :containers="metrics?.containers ?? []"
        :node-id="activeId"
        :commands="appConfig.commands"
        :terminal-enabled="appConfig.terminal.enabled"
      />
    </main>
  </div>
</template>
