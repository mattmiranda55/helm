<script setup>
/**
 * Which services are favorites — pinned to the top of the Machines page.
 * One toggle per service, grouped under each machine's name (even when
 * there is only one, so it's clear whose apps these are).
 *
 * v-model (modelValue)
 *   [{ name, url, node?, favorite?, ... }] — every service, flat. Emitted as a
 *   new array of the same length and order; only `favorite` changes.
 *
 * Props
 *   nodes   [{ id, label }] to title the groups (services whose node isn't
 *           listed go under "Other")
 *
 * Emits
 *   update:modelValue  (services)
 */
import { IonList, IonItem, IonToggle } from '@ionic/vue'
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: Array, required: true },
  nodes: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

const groups = computed(() => {
  const byNode = new Map(props.nodes.map((node) => [node.id, { key: node.id, title: node.label, rows: [] }]))
  const other = { key: '', title: props.nodes.length ? 'Other' : null, rows: [] }
  props.modelValue.forEach((service, index) => {
    ;(byNode.get(service.node) ?? other).rows.push({ service, index })
  })
  return [...byNode.values(), other].filter((group) => group.rows.length)
})

const favorites = computed(() => props.modelValue.filter((s) => s.favorite).length)

function host(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function set(index, on) {
  emit(
    'update:modelValue',
    props.modelValue.map((service, i) => (i === index ? { ...service, favorite: on } : service)),
  )
}
</script>

<template>
  <div class="favorites-picker">
    <p v-if="!modelValue.length" class="note">
      No services yet. Add some on the earlier steps — or later in Settings — and pick favorites then.
    </p>
    <template v-else>
      <section v-for="group in groups" :key="group.key" class="block">
        <h3 v-if="group.title" class="block-title" translate="no">{{ group.title }}</h3>
        <ion-list :inset="true" class="group">
          <ion-item v-for="{ service, index } in group.rows" :key="index">
            <!-- The second line is the toggle's own helper-text: Ionic renders it
                 under the label, wrapped, and links it with aria-describedby. -->
            <ion-toggle
              :checked="!!service.favorite"
              justify="space-between"
              :helper-text="host(service.url) || undefined"
              @ion-change="set(index, $event.detail.checked)"
            >
              {{ service.name || 'Unnamed' }}
            </ion-toggle>
          </ion-item>
        </ion-list>
      </section>
      <p class="count" role="status">
        {{ favorites ? `${favorites} ${favorites === 1 ? 'favorite' : 'favorites'}` : 'No favorites' }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.favorites-picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.block-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-inline: 16px;
}
.group {
  margin: 0;
}
/* Helper text is a documented shadow part; a URL host has no spaces to wrap at. */
ion-toggle::part(helper-text) {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
.count {
  font-size: 0.8125rem;
  color: var(--color-muted);
  padding-inline: 16px;
}
</style>
