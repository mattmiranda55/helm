<script setup>
/**
 * Service launcher — the Homepage replacement.
 *
 * Status is free: the container list for the node you are already watching is
 * on screen anyway, so matching a service to its container costs no extra
 * request against the machine. Services whose container lives on another node
 * simply show no badge rather than a guess.
 *
 * Tiles are monograms, not remote icons: a tailnet-only dashboard should not
 * depend on reaching an icon CDN, and it keeps the page at zero outbound
 * requests. Color is reserved for status, so the monogram stays neutral.
 */
import { computed, ref } from 'vue'

const props = defineProps({
  services: { type: Array, required: true },
  /** Containers on the node currently being viewed. */
  containers: { type: Array, default: () => [] },
  /** Id of that node, so we only claim status for services that live on it. */
  nodeId: { type: String, default: null },
})

const query = ref('')

const byName = computed(() => {
  const map = new Map()
  for (const container of props.containers) map.set(container.name, container)
  return map
})

/** Only claim "not running" when the node actually reports containers —
 *  MagicMirror's Glances has no container socket at all. */
const canResolve = computed(() => props.containers.length > 0)

const STATUS = {
  running: { label: 'running', color: 'var(--color-good)' },
  healthy: { label: 'healthy', color: 'var(--color-good)' },
  paused: { label: 'paused', color: 'var(--color-warning)' },
  restarting: { label: 'restarting', color: 'var(--color-serious)' },
  exited: { label: 'stopped', color: 'var(--color-muted)' },
  created: { label: 'created', color: 'var(--color-muted)' },
  dead: { label: 'dead', color: 'var(--color-critical)' },
}

function statusFor(service) {
  if (!service.container || !canResolve.value) return null
  // A service pinned to another node tells us nothing while we look at this one.
  if (service.node && service.node !== props.nodeId) return null
  const container = byName.value.get(service.container)
  if (!container) return { label: 'not running', color: 'var(--color-muted)', dim: true }
  return STATUS[container.status] ?? { label: container.status, color: 'var(--color-muted)' }
}

function monogram(service) {
  if (service.icon) return service.icon
  return service.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
}

const groups = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const matches = needle
    ? props.services.filter((service) =>
        `${service.name} ${service.description} ${service.group}`.toLowerCase().includes(needle),
      )
    : props.services

  const ordered = new Map()
  for (const service of matches) {
    if (!ordered.has(service.group)) ordered.set(service.group, [])
    ordered.get(service.group).push(service)
  }
  return [...ordered].map(([name, items]) => ({ name, items }))
})
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="shrink-0 px-3 pt-3">
      <input
        v-model="query"
        type="search"
        placeholder="Filter services"
        class="w-full rounded-lg border border-hairline bg-sunken px-3 py-1.5 text-[12px] text-ink placeholder:text-muted focus:border-[var(--color-series-1)] focus:outline-none"
      />
    </div>

    <div class="min-h-0 flex-1 p-3 lg:overflow-y-auto">
      <div v-for="group in groups" :key="group.name" class="mb-4 last:mb-0">
        <h3 class="mb-2 text-[10px] font-medium tracking-wide text-muted uppercase">
          {{ group.name }}
        </h3>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <a
            v-for="service in group.items"
            :key="service.name"
            :href="service.url"
            target="_blank"
            rel="noopener noreferrer"
            class="group flex items-center gap-3 rounded-lg border border-hairline bg-surface px-3 py-2.5 transition-colors hover:border-[var(--color-series-1)] hover:bg-raised"
          >
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-raised font-mono text-[11px] font-semibold text-ink-2 group-hover:text-ink"
            >
              {{ monogram(service) }}
            </span>

            <span class="min-w-0 flex-1">
              <span class="block truncate text-[12px] font-medium text-ink">{{ service.name }}</span>
              <span class="block truncate text-[11px] text-muted">{{ service.description }}</span>
            </span>

            <span
              v-if="statusFor(service)"
              class="flex shrink-0 items-center gap-1.5 text-[10px] whitespace-nowrap"
              :style="{ color: statusFor(service).color }"
              :title="`Container ${service.container}`"
            >
              <span
                class="h-1.5 w-1.5 rounded-full"
                :style="{ background: statusFor(service).color }"
              />
              {{ statusFor(service).label }}
            </span>
          </a>
        </div>
      </div>

      <p v-if="!groups.length" class="px-1 py-6 text-center text-[12px] text-muted">
        <template v-if="services.length">No services match that filter.</template>
        <template v-else>
          Nothing listed for this node. A service appears here when its
          <code class="font-mono text-ink-2">node</code> matches the selected tab,
          or when it has no <code class="font-mono text-ink-2">node</code> at all.
        </template>
      </p>
    </div>
  </div>
</template>
