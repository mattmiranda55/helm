<script setup>
/**
 * Every container on one machine, grouped by compose stack. Starting and
 * stopping happens here (and only for the machine helm runs on); the Apps page
 * is just the launcher.
 *
 * Page state lives in the query string — ?node=…&show=stopped&open=rdtclient —
 * so the home page's "View logs" can link straight to a container.
 */
import { computed, shallowRef } from 'vue'
import ContainerRow from '@/components/containers/ContainerRow.vue'
import ContainerSheet from '@/components/containers/ContainerSheet.vue'
import StackSheet from '@/components/containers/StackSheet.vue'
import Icon from '@/components/ui/Icon.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useMetrics } from '@/composables/useMetrics'
import { useStacks } from '@/composables/useStacks'
import { useToast } from '@/composables/useToast'
import { route, setQuery } from '@/lib/router'

const { config, loaded } = useAppConfig()
const { show } = useToast()

// --- which machine, which filter -------------------------------------------
const nodeId = computed({
  get: () => {
    const wanted = route.value.query.node
    const nodes = config.value.nodes
    return nodes.some((n) => n.id === wanted) ? wanted : (nodes[0]?.id ?? null)
  },
  set: (id) => setQuery({ node: id, open: null }),
})
const node = computed(() => config.value.nodes.find((n) => n.id === nodeId.value) ?? null)
const machineOptions = computed(() => config.value.nodes.map((n) => ({ value: n.id, label: n.label })))

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'stopped', label: 'Stopped' },
]
const filter = computed(() => (FILTERS.some((f) => f.key === route.value.query.show) ? route.value.query.show : 'all'))

const { metrics, error, capabilities, refresh } = useMetrics(nodeId, computed(() => config.value.refreshMs), null)
const containers = computed(() => metrics.value?.containers ?? [])

/** Why the buttons are missing, in terms of what you'd change. */
const viewOnly = computed(() => {
  if (!node.value || capabilities.value.containers) return null
  return capabilities.value.local
    ? `helm can't start or stop containers here: container control is turned off in its config, or podman/docker isn't installed on ${node.value.label}.`
    : `helm runs on a different machine, so it can watch ${node.value.label}'s containers but not start or stop them.`
})

const isUp = (c) => c.status === 'running' || c.status === 'healthy'
const counts = computed(() => ({
  all: containers.value.length,
  running: containers.value.filter(isUp).length,
  stopped: containers.value.filter((c) => !isUp(c)).length,
}))

const summary = computed(() => {
  if (!metrics.value) return ''
  const crashing = containers.value.filter((c) => c.status === 'restarting' || c.status === 'dead').map((c) => c.name)
  const base = `${counts.value.running} of ${counts.value.all} running.`
  if (!crashing.length) return base
  return `${base} ${crashing.join(', ')} ${crashing.length === 1 ? 'keeps' : 'keep'} restarting.`
})

// --- stacks -------------------------------------------------------------------
const stacksApi = useStacks(() => !!capabilities.value.stacks)

/** container name -> stack name, from the compose labels the server reads. */
const stackOf = computed(() => {
  const map = new Map()
  for (const stack of stacksApi.stacks.value) {
    for (const service of stack.services) if (service.container) map.set(service.container, stack.name)
  }
  return map
})

const groups = computed(() => {
  // By name, not by the server's CPU order — rows that reshuffle every poll
  // move out from under your thumb.
  const shown = containers.value
    .filter((c) => filter.value === 'all' || (filter.value === 'running' ? isUp(c) : !isUp(c)))
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const byStack = new Map()
  for (const container of shown) {
    const stack = stackOf.value.get(container.name) ?? null
    if (!byStack.has(stack)) byStack.set(stack, [])
    byStack.get(stack).push(container)
  }
  return [...byStack.entries()]
    .sort(([a], [b]) => (a === null) - (b === null) || String(a).localeCompare(String(b)))
    .map(([stack, list]) => {
      const all = containers.value.filter((c) => (stackOf.value.get(c.name) ?? null) === stack)
      return {
        key: stack ?? '__none',
        stack,
        title: stack ?? (stackOf.value.size ? 'Not in a stack' : null),
        up: all.filter(isUp).length,
        total: all.length,
        containers: list,
      }
    })
})

// --- sheets -------------------------------------------------------------------
const openName = computed(() => route.value.query.open ?? null)
const openContainer = computed(() => containers.value.find((c) => c.name === openName.value) ?? null)
const openService = computed(() =>
  openContainer.value
    ? config.value.services.find(
        (s) => s.container === openContainer.value.name && (!s.node || s.node === nodeId.value),
      ) ?? null
    : null,
)

const stackSheet = shallowRef(null) // { name } | { creating: true }
const sheetStack = computed(() =>
  stackSheet.value?.name ? (stacksApi.stacks.value.find((s) => s.name === stackSheet.value.name) ?? null) : null,
)

function closeStackSheet() {
  stackSheet.value = null
  stacksApi.stopFollowing()
}

const PAST = { up: 'Started', restart: 'Restarted', down: 'Stopped' }

async function runStack(action) {
  const name = stackSheet.value.name
  try {
    await stacksApi.run(name, action)
    show(`${PAST[action]} all of ${name}`)
  } catch {
    /* shown in the sheet */
  }
}

async function saveStack({ payload, deploy, done }) {
  try {
    const name = await stacksApi.save(stackSheet.value?.creating ? null : stackSheet.value.name, payload)
    done(null)
    show(stackSheet.value?.creating ? `Created ${name}` : `Saved ${name}`)
    stackSheet.value = { name }
    if (deploy) await runStack('up')
  } catch (cause) {
    done(cause.message)
  }
}

async function removeStack() {
  const name = stackSheet.value.name
  try {
    await stacksApi.remove(name)
    closeStackSheet()
    show(`Deleted ${name}`)
  } catch (cause) {
    show(`Couldn't delete ${name}: ${cause.message}`)
  }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h1 class="page-title">Containers</h1>
        <p class="page-sub">{{ summary }}</p>
      </div>
      <SegmentedControl v-if="machineOptions.length > 1" v-model="nodeId" :options="machineOptions" label="Machine" />
    </div>

    <p v-if="metrics && viewOnly" class="note">View only. {{ viewOnly }}</p>

    <div v-if="metrics" class="toolbar">
      <div class="chips" role="group" aria-label="Show">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          class="chip"
          :aria-pressed="filter === f.key"
          @click="setQuery({ show: f.key === 'all' ? null : f.key })"
        >
          {{ f.label }}<span class="chip-count num">{{ counts[f.key] }}</span>
        </button>
      </div>
      <button v-if="capabilities.stacks" type="button" class="btn" @click="stackSheet = { creating: true }">
        <Icon name="plus" :size="16" />New stack
      </button>
    </div>

    <p v-if="loaded && !config.nodes.length" class="note">No machines configured yet.</p>
    <p v-else-if="!metrics && error" class="note" style="color: var(--color-critical)">
      Can't reach {{ node?.label }}: {{ error }}.
    </p>
    <p v-else-if="!metrics" class="note">Connecting…</p>
    <div v-else-if="!groups.length" class="empty">
      <strong>{{ counts.all ? `No ${filter} containers` : 'No containers' }}</strong>
      <span v-if="counts.all">Everything on {{ node.label }} is {{ filter === 'stopped' ? 'running' : 'stopped' }}.</span>
      <span v-else>Glances isn't reporting any containers on {{ node.label }}.</span>
    </div>

    <div v-else class="groups">
      <section v-for="group in groups" :key="group.key" class="group">
        <div v-if="group.title" class="group-head">
          <h2 class="group-title">
            <span translate="no">{{ group.title }}</span><span class="group-count">, {{ group.up }} of {{ group.total }} up</span>
          </h2>
          <button v-if="group.stack && capabilities.stacks" type="button" class="text-link" @click="stackSheet = { name: group.stack }">
            Manage stack
          </button>
        </div>
        <div class="list">
          <ContainerRow
            v-for="container in group.containers"
            :key="container.name"
            :container="container"
            @select="setQuery({ open: $event })"
          />
        </div>
      </section>
    </div>

    <ContainerSheet
      v-if="node"
      :open="!!openContainer"
      :container="openContainer"
      :node-id="node.id"
      :machine="node.label"
      :can-control="!!capabilities.containers"
      :view-only="viewOnly"
      :stack="openContainer ? (stackOf.get(openContainer.name) ?? null) : null"
      :service="openService"
      @close="setQuery({ open: null })"
      @changed="refresh"
    />

    <StackSheet
      :open="!!stackSheet"
      :creating="!!stackSheet?.creating"
      :stack="sheetStack"
      :output="stacksApi.output.value"
      :busy="!!stacksApi.busy.value"
      :error="stacksApi.error.value"
      :template="config.stacks?.template"
      :env-template="config.stacks?.envTemplate"
      @close="closeStackSheet"
      @run="runStack"
      @save="saveStack"
      @remove="removeStack"
    />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  flex-wrap: wrap;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip-count {
  opacity: 0.65;
  margin-left: 6px;
}
/* Columns only when there's more than one group to fill them. */
.groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: 22px;
  align-items: start;
}
.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0 4px 6px;
}
.group-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink-2);
}
.group-count {
  color: var(--color-muted);
  font-weight: 500;
}
.list {
  background: var(--color-surface);
  border-radius: var(--radius-row);
  overflow: hidden;
}
.list > :deep(* + *) {
  border-top: 1px solid var(--color-hairline);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
  color: var(--color-muted);
  padding: 40px 16px;
}
.empty strong {
  color: var(--color-ink);
  font-size: 16px;
}
</style>
