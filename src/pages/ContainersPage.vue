<script setup>
/**
 * Every container on one machine, grouped by compose stack. Starting and
 * stopping happens here (and only for the machine helm runs on); the Apps page
 * is just the launcher.
 *
 * Page state lives in the query string — ?node=…&show=stopped&open=rdtclient —
 * so the home page's "View logs" can link straight to a container. That link
 * can land while this page is already mounted in its tab, so everything here
 * derives from the (reactive) query rather than reading it once.
 */
import { IonButton, IonIcon, IonList, IonRefresher, IonRefresherContent } from '@ionic/vue'
import { add } from 'ionicons/icons'
import { computed, shallowRef } from 'vue'
import HelmPage from '@/components/layout/HelmPage.vue'
import ContainerRow from '@/components/containers/ContainerRow.vue'
import ContainerSheet from '@/components/containers/ContainerSheet.vue'
import StackSheet from '@/components/containers/StackSheet.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useMetrics } from '@/composables/useMetrics'
import { usePageActive } from '@/composables/usePageActive'
import { useStacks } from '@/composables/useStacks'
import { useToast } from '@/composables/useToast'
import { useQuery } from '@/composables/useQuery'

const { config, loaded } = useAppConfig()
const { show } = useToast()
const { query, setQuery } = useQuery()
const active = usePageActive()

// --- which machine, which filter -------------------------------------------
const nodeId = computed({
  get: () => {
    const wanted = query.value.node
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
const filter = computed({
  get: () => (FILTERS.some((f) => f.key === query.value.show) ? query.value.show : 'all'),
  set: (key) => setQuery({ show: key === 'all' ? null : key }),
})

const { metrics, error, capabilities, refresh } = useMetrics(
  nodeId,
  computed(() => config.value.refreshMs),
  null,
  active,
)
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

/** The filter as a segmented control, each label carrying its count ("Stopped 2"). */
const filterOptions = computed(() => FILTERS.map((f) => ({ value: f.key, label: `${f.label} ${counts.value[f.key]}` })))

const summary = computed(() => {
  if (!metrics.value) return ''
  const crashing = containers.value.filter((c) => c.status === 'restarting' || c.status === 'dead').map((c) => c.name)
  const base = `${counts.value.running} of ${counts.value.all} running.`
  if (!crashing.length) return base
  return `${base} ${crashing.join(', ')} ${crashing.length === 1 ? 'keeps' : 'keep'} restarting.`
})

// --- stacks -------------------------------------------------------------------
const stacksApi = useStacks(() => !!capabilities.value.stacks, active)

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
const openName = computed(() => query.value.open ?? null)
const openContainer = computed(() => containers.value.find((c) => c.name === openName.value) ?? null)
const openService = computed(() =>
  openContainer.value
    ? config.value.services.find(
        (s) => s.container === openContainer.value.name && (!s.node || s.node === nodeId.value),
      ) ?? null
    : null,
)

/**
 * The sheet closed: clear ?open= — but only when it was dismissed by hand.
 * It also closes on its own when the container drops out of the list (e.g.
 * while a link switches machines and the list reloads, which must not wipe the
 * link's own ?open=), and when the page is left (Ionic keeps this page
 * mounted, and writing the query then would navigate back here).
 */
function closeContainerSheet() {
  if (active.value && openContainer.value) setQuery({ open: null })
}

const stackSheet = shallowRef(null) // { name } | { creating: true }
const sheetStack = computed(() =>
  stackSheet.value?.name ? (stacksApi.stacks.value.find((s) => s.name === stackSheet.value.name) ?? null) : null,
)

/** Leaving the page only hides the sheet; it comes back with the page. */
function onStackSheetClose() {
  if (active.value) closeStackSheet()
}

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

/** Pull to refresh: the machine's containers and, where there are any, its stacks. */
async function onRefresh(event) {
  try {
    await Promise.all([refresh(), capabilities.value.stacks ? stacksApi.load() : null])
  } finally {
    event.target.complete()
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
  <HelmPage title="Containers">
    <!-- Pull to refresh: ion-refresher must be a direct child of ion-content,
         in its fixed slot; complete() on the event target ends the spinner. -->
    <template #fixed>
      <ion-refresher slot="fixed" @ion-refresh="onRefresh">
        <ion-refresher-content />
      </ion-refresher>
    </template>

    <template v-if="capabilities.stacks" #actions>
      <ion-button aria-label="New stack" @click="stackSheet = { creating: true }">
        <ion-icon slot="icon-only" :icon="add" />
      </ion-button>
    </template>

    <div class="page">
      <div v-if="summary || machineOptions.length > 1" class="head">
        <p v-if="summary" class="summary">{{ summary }}</p>
        <SegmentedControl v-if="machineOptions.length > 1" v-model="nodeId" :options="machineOptions" label="Machine" />
      </div>

      <p v-if="metrics && viewOnly" class="note">View only. {{ viewOnly }}</p>

      <SegmentedControl v-if="metrics" v-model="filter" :options="filterOptions" label="Show" class="filter" />

      <!-- No machines: HelmPage's notice says so and how to fix it. -->
      <template v-if="loaded && !config.nodes.length" />
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
            <ion-button
              v-if="group.stack && capabilities.stacks"
              fill="clear"
              size="small"
              class="manage"
              @click="stackSheet = { name: group.stack }"
            >
              Manage stack
            </ion-button>
          </div>
          <ion-list class="list" inset lines="full">
            <ContainerRow
              v-for="container in group.containers"
              :key="container.name"
              :container="container"
              @select="setQuery({ open: $event })"
            />
          </ion-list>
        </section>
      </div>

      <!-- Inline sheet modals (ion-modal in the template, presented by
           `is-open`): they stay where they are declared and render nothing
           until presented. `active &&` hides them when this tab is left,
           since Ionic keeps the page — and an open modal — mounted. -->
      <ContainerSheet
        v-if="node"
        :open="active && !!openContainer"
        :container="openContainer"
        :node-id="node.id"
        :machine="node.label"
        :can-control="!!capabilities.containers"
        :view-only="viewOnly"
        :stack="openContainer ? (stackOf.get(openContainer.name) ?? null) : null"
        :service="openService"
        @close="closeContainerSheet"
        @changed="refresh"
      />

      <StackSheet
        :open="active && !!stackSheet"
        :creating="!!stackSheet?.creating"
        :stack="sheetStack"
        :output="stacksApi.output.value"
        :busy="!!stacksApi.busy.value"
        :error="stacksApi.error.value"
        :template="config.stacks?.template"
        :env-template="config.stacks?.envTemplate"
        @close="onStackSheetClose"
        @run="runStack"
        @save="saveStack"
        @remove="removeStack"
      />
    </div>
  </HelmPage>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.summary {
  color: var(--color-muted);
  font-size: 0.875rem;
}
/* Not stretched across a desktop-wide page: three short options. */
.filter {
  max-width: 420px;
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
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  margin: 0 4px 4px;
}
/* Flush with the card's right edge rather than indented by its own padding. */
.manage {
  margin: 0 -8px 0 0;
}
.group-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-ink-2);
}
.group-count {
  color: var(--color-muted);
  font-weight: 500;
}
/* An inset list for its rounded card and last-row-has-no-line, on helm's
 * spacing and radius rather than iOS settings'. */
ion-list.list {
  margin: 0;
  border-radius: var(--radius-row);
  background: var(--color-surface);
  overflow: hidden;
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
  font-size: 1rem;
}
</style>
