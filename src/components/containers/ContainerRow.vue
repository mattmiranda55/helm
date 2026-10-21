<script setup>
/**
 * One container in a list. Healthy ones show usage; anything else shows its state.
 *
 * An ion-item with `button` renders a real <button> (focusable, Enter/Space
 * work) with the platform's press highlight; `detail` adds the disclosure
 * chevron that says "tap for more" — it opens the container's sheet. Lives
 * inside the page's ion-list, which draws the separators.
 *
 * Inside it, Ionic's item vocabulary: an ion-label whose heading and <p> it
 * styles as a title and a secondary line, and an ion-note in the end slot for
 * metadata (the usage).
 */
import { IonItem, IonLabel, IonNote } from '@ionic/vue'
import { computed } from 'vue'
import StatusText from '@/components/ui/StatusText.vue'
import { bytes } from '@/lib/format'

const props = defineProps({
  container: { type: Object, required: true },
})

const emit = defineEmits(['select'])

const STATE = {
  restarting: { level: 'critical', label: 'Restarting' },
  dead: { level: 'critical', label: 'Dead' },
  paused: { level: 'warning', label: 'Paused' },
}
const state = computed(() => {
  const { status } = props.container
  if (status === 'running' || status === 'healthy') return null
  return STATE[status] ?? { level: 'muted', label: 'Stopped' }
})

const image = computed(() => String(props.container.image ?? '').replace(/^docker\.io\/(library\/)?/, ''))
</script>

<template>
  <ion-item button detail class="row" @click="emit('select', container.name)">
    <!-- The heading is for ion-label's title styling: inside the item's button
         it reads as part of the button's name, not as a heading of its own. -->
    <ion-label class="text">
      <h3 class="name" translate="no">{{ container.name }}</h3>
      <p v-if="image" class="image num" translate="no">{{ image }}</p>
    </ion-label>
    <StatusText v-if="state" slot="end" :level="state.level">{{ state.label }}</StatusText>
    <ion-note v-else slot="end" class="usage num">
      <span>{{ container.cpu.toFixed(1) }}% CPU</span>
      <span class="mem">{{ bytes(container.memory) }}</span>
    </ion-note>
  </ion-item>
</template>

<style scoped>
.row {
  --min-height: 60px;
  --padding-start: 14px;
  --inner-padding-end: 10px;
  --detail-icon-color: var(--color-muted);
  --detail-icon-opacity: 0.6;
  --background-hover: var(--color-sunken);
  --background-hover-opacity: 0.6;
  --color: var(--color-ink);
  font-size: 0.9375rem;
}
/* Let the label shrink so long names ellipsize instead of pushing the usage
 * off the row (ion-item gives the label flex: 1 but not min-width: 0). */
.text {
  min-width: 0;
}
/* Ionic sizes the label's h3 and p for iOS; these put them on helm's scale. */
.name {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 650;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.6875rem;
  line-height: 1.45;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage {
  --color: var(--color-ink-2);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 0.8125rem;
  flex-shrink: 0;
}
.mem {
  color: var(--color-muted);
}
</style>
