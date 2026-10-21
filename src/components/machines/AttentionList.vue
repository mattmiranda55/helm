<script setup>
/**
 * What's wrong right now, each with the one button that gets you to the fix.
 *
 * Most fixes are a machine's page, which lives in this (Machines) tab's own
 * stack, so those buttons are plain router-links. A crashed container's logs
 * live on the Containers tab, and Ionic's rule is that one tab never routes
 * into another (each keeps its own stack, and only the tab bar switches
 * between them). So those buttons emit `open-container` instead, and the page
 * presents the container as a modal over this tab.
 * https://ionicframework.com/docs/vue/navigation#switching-between-tabs
 */
import { IonButton, IonIcon } from '@ionic/vue'
import { alertOutline, fileTrayFullOutline } from 'ionicons/icons'
import { computed } from 'vue'
import StatusText from '@/components/ui/StatusText.vue'

/** lib/attention.js names icons by meaning; these are the ionicons that draw them. */
const ICONS = { alert: alertOutline, disk: fileTrayFullOutline }

const props = defineProps({
  /** From lib/attention.js */
  items: { type: Array, required: true },
  /** Hide the all-clear line until the machines have reported once. */
  ready: { type: Boolean, default: true },
})

/** { nodeId, name } of the container a "View logs" item points at. */
const emit = defineEmits(['open-container'])

/** The container an item's action points at on the Containers tab, if any. */
function containerTarget(item) {
  const url = new URL(item.action.to, location.origin)
  const nodeId = url.searchParams.get('node')
  const name = url.searchParams.get('open')
  return url.pathname === '/containers' && nodeId && name ? { nodeId, name } : null
}

const rows = computed(() => props.items.map((item) => ({ item, container: containerTarget(item) })))
</script>

<template>
  <section v-if="items.length">
    <h2 class="section-title">Needs attention <span class="count num">{{ items.length }}</span></h2>
    <ul class="list">
      <li v-for="{ item, container } in rows" :key="item.key" class="alert" :class="item.level">
        <span class="glyph"><ion-icon :icon="ICONS[item.icon] ?? alertOutline" aria-hidden="true" /></span>
        <div class="text">
          <p class="what">{{ item.title }}</p>
          <p class="why">{{ item.detail }}</p>
        </div>
        <ion-button
          v-if="container"
          class="action"
          fill="outline"
          shape="round"
          size="small"
          @click="emit('open-container', container)"
        >
          {{ item.action.label }}
        </ion-button>
        <ion-button v-else class="action" fill="outline" shape="round" size="small" :router-link="item.action.to">
          {{ item.action.label }}
        </ion-button>
      </li>
    </ul>
  </section>
  <p v-else-if="ready" class="clear">
    <StatusText level="good">Nothing needs attention.</StatusText>
    <span class="clear-sub">All machines are reporting.</span>
  </p>
</template>

<style scoped>
.text {
  min-width: 0;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.alert {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 4px 12px;
  background: var(--color-surface);
  border-radius: var(--radius-row);
  padding: 14px 14px 14px 16px;
}
.glyph {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 1.125rem;
}
.critical .glyph {
  background: color-mix(in srgb, var(--color-critical) 14%, transparent);
  color: var(--color-critical);
}
.warning .glyph {
  background: color-mix(in srgb, var(--color-warning) 16%, transparent);
  color: var(--color-warning);
}
.what {
  font-weight: 650;
}
.why {
  color: var(--color-muted);
  font-size: 0.875rem;
}
.action {
  grid-column: 2;
  justify-self: start;
  margin: 8px 0 0;
}
.clear {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}
.clear-sub {
  color: var(--color-muted);
  font-size: 0.875rem;
}

@media (min-width: 560px) {
  .alert {
    grid-template-columns: auto 1fr auto;
    align-items: center;
  }
  .action {
    grid-column: auto;
    margin: 0;
  }
}
</style>
