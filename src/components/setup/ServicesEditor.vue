<script setup>
/**
 * The services (apps) on one machine. Two kinds of suggestion feed it:
 *
 *   - with a `url` (a container publishing a port on this machine): a toggle
 *     row; switched on, the service exists and its name and URL can be edited
 *     in place. Matched to services by `container`.
 *   - without a `url` (a container seen through Glances, whose address helm
 *     can't know): a quick-pick chip that adds a service with the name and
 *     container filled in, and focuses its URL.
 *
 * Everything else is a manual entry: name, URL, optional container, Remove.
 *
 * v-model (modelValue)
 *   [{ name, url, container?, node?, favorite?, ...anything else kept }]
 *   The services of THIS machine only; emitted whole as a new array.
 *
 * Props
 *   node          node id stamped as `node` on services it creates (null = none)
 *   suggestions   [{ name, container, url?, detail? }] — see above
 *   suggestionsTitle  heading over the toggle rows
 *   showErrors    show every validation error now, not only after a blur
 *
 * Emits
 *   update:modelValue  (services)
 *
 * Exposes
 *   valid    true when every service has a name and an http(s) URL
 */
import { IonButton, IonChip, IonIcon, IonInput, IonItem, IonLabel, IonList, IonToggle } from '@ionic/vue'
import { addOutline, trashOutline } from 'ionicons/icons'
import { computed, nextTick, shallowRef, useTemplateRef } from 'vue'
import { hasErrors, serviceErrors } from './validate'

const props = defineProps({
  modelValue: { type: Array, required: true },
  node: { type: String, default: null },
  suggestions: { type: Array, default: () => [] },
  suggestionsTitle: { type: String, default: 'Containers with published ports' },
  showErrors: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const services = computed(() => props.modelValue)
const errors = computed(() => services.value.map(serviceErrors))
const valid = computed(() => errors.value.every((e) => !hasErrors(e)))
defineExpose({ valid })

const toggleable = computed(() => props.suggestions.filter((s) => s.url && s.container))
const pickable = computed(() => props.suggestions.filter((s) => !s.url && s.container))
const toggleContainers = computed(() => new Set(toggleable.value.map((s) => s.container)))

const indexOfContainer = (container) => services.value.findIndex((s) => s.container === container)

/** Manual entries: everything not driven by a toggle row, with its index in the model. */
const manual = computed(() =>
  services.value
    .map((service, index) => ({ service, index }))
    .filter(({ service }) => !service.container || !toggleContainers.value.has(service.container)),
)

const usedContainers = computed(() => new Set(services.value.map((s) => s.container).filter(Boolean)))
const picks = computed(() => pickable.value.filter((s) => !usedContainers.value.has(s.container)))

function commit(next) {
  emit('update:modelValue', next)
}

function patch(index, change) {
  commit(services.value.map((service, i) => (i === index ? { ...service, ...change } : service)))
}

function blank(extra = {}) {
  const service = { name: '', url: '', container: '', ...extra }
  if (props.node) service.node = props.node
  return service
}

function toggle(suggestion, on) {
  const index = indexOfContainer(suggestion.container)
  if (on && index === -1) {
    commit([...services.value, blank({ name: suggestion.name, url: suggestion.url, container: suggestion.container })])
  } else if (!on && index !== -1) {
    commit(services.value.filter((_, i) => i !== index))
  }
}

const list = useTemplateRef('list')

/** Focus the URL field of the service at `index` once it has rendered. */
async function focusUrl(index) {
  await nextTick()
  const input = list.value?.querySelector(`[data-url="${index}"]`)
  input?.setFocus?.()
}

function add(extra) {
  const next = [...services.value]
  // Reuse a trailing entry nobody has typed into rather than stacking blanks.
  const last = manual.value.at(-1)
  const empty = last && !last.service.name && !last.service.url && !last.service.container
  if (empty) next[last.index] = { ...last.service, ...extra }
  else next.push(blank(extra))
  commit(next)
  focusUrl(empty ? last.index : next.length - 1)
}

function remove(index) {
  commit(services.value.filter((_, i) => i !== index))
}

const touched = shallowRef({})
const touch = (index, field) => (touched.value = { ...touched.value, [`${index}.${field}`]: true })
function fieldClass(index, field) {
  return {
    'ion-invalid': !!errors.value[index]?.[field],
    'ion-touched': props.showErrors || !!touched.value[`${index}.${field}`],
  }
}
</script>

<template>
  <div ref="list" class="services-editor">
    <section v-if="toggleable.length" class="block">
      <h3 class="block-title">{{ suggestionsTitle }}</h3>
      <ion-list :inset="true" class="group">
        <template v-for="suggestion in toggleable" :key="suggestion.container">
          <ion-item>
            <!-- Controlled (:checked + ionChange) rather than v-model: "on" is
                 derived from the list, and the event edits the list. The detail
                 line is the toggle's helper-text, announced with it. -->
            <ion-toggle
              :checked="indexOfContainer(suggestion.container) !== -1"
              justify="space-between"
              :helper-text="suggestion.detail || undefined"
              @ion-change="toggle(suggestion, $event.detail.checked)"
            >
              <span class="num" translate="no">{{ suggestion.container }}</span>
            </ion-toggle>
          </ion-item>
          <template v-if="indexOfContainer(suggestion.container) !== -1">
            <ion-item class="nested">
              <ion-input
                :value="services[indexOfContainer(suggestion.container)].name"
                label="Name"
                label-placement="fixed"
                autocapitalize="words"
                :class="fieldClass(indexOfContainer(suggestion.container), 'name')"
                :error-text="errors[indexOfContainer(suggestion.container)]?.name"
                @ion-input="patch(indexOfContainer(suggestion.container), { name: $event.detail.value ?? '' })"
                @ion-blur="touch(indexOfContainer(suggestion.container), 'name')"
              />
            </ion-item>
            <ion-item class="nested">
              <ion-input
                :value="services[indexOfContainer(suggestion.container)].url"
                label="URL"
                label-placement="fixed"
                type="url"
                inputmode="url"
                autocapitalize="off"
                :autocorrect="false"
                :spellcheck="false"
                class="mono"
                :data-url="indexOfContainer(suggestion.container)"
                :class="fieldClass(indexOfContainer(suggestion.container), 'url')"
                :error-text="errors[indexOfContainer(suggestion.container)]?.url"
                @ion-input="patch(indexOfContainer(suggestion.container), { url: $event.detail.value ?? '' })"
                @ion-blur="touch(indexOfContainer(suggestion.container), 'url')"
              />
            </ion-item>
          </template>
        </template>
      </ion-list>
    </section>

    <section class="block">
      <h3 v-if="toggleable.length || manual.length" class="block-title">
        {{ toggleable.length ? 'Other services' : 'Services' }}
      </h3>

      <ion-list v-for="{ service, index } in manual" :key="index" :inset="true" class="group entry">
        <ion-item>
          <ion-input
            :value="service.name"
            label="Name"
            label-placement="fixed"
            placeholder="Jellyfin"
            autocapitalize="words"
            :class="fieldClass(index, 'name')"
            :error-text="errors[index]?.name"
            @ion-input="patch(index, { name: $event.detail.value ?? '' })"
            @ion-blur="touch(index, 'name')"
          />
        </ion-item>
        <ion-item>
          <ion-input
            :value="service.url"
            label="URL"
            label-placement="fixed"
            type="url"
            inputmode="url"
            placeholder="http://192.168.1.20:8096"
            autocapitalize="off"
            :autocorrect="false"
            :spellcheck="false"
            class="mono"
            :data-url="index"
            :class="fieldClass(index, 'url')"
            :error-text="errors[index]?.url"
            @ion-input="patch(index, { url: $event.detail.value ?? '' })"
            @ion-blur="touch(index, 'url')"
          />
        </ion-item>
        <ion-item>
          <ion-input
            :value="service.container ?? ''"
            label="Container"
            label-placement="fixed"
            placeholder="Optional"
            autocapitalize="off"
            :autocorrect="false"
            :spellcheck="false"
            class="mono"
            helper-text="Its container name, so helm can show whether it's up"
            @ion-input="patch(index, { container: $event.detail.value ?? '' })"
          />
        </ion-item>
        <ion-item button :detail="false" class="remove" @click="remove(index)">
          <ion-icon slot="start" :icon="trashOutline" color="danger" aria-hidden="true" />
          <ion-label color="danger">Remove {{ service.name || 'this service' }}</ion-label>
        </ion-item>
      </ion-list>

      <div v-if="picks.length" class="picks">
        <p class="picks-title">Add one of its containers — then type the address you open it at:</p>
        <div class="chips">
          <!-- ion-chip has no button role or tab stop of its own, so a chip
               that acts gets both, and Enter/Space. -->
          <ion-chip
            v-for="pick in picks"
            :key="pick.container"
            :outline="true"
            role="button"
            tabindex="0"
            :title="pick.detail || undefined"
            @click="add({ name: pick.name, container: pick.container })"
            @keydown.enter.space.prevent="add({ name: pick.name, container: pick.container })"
          >
            <ion-icon :icon="addOutline" aria-hidden="true" />
            <ion-label class="num" translate="no">{{ pick.container }}</ion-label>
          </ion-chip>
        </div>
      </div>

      <div>
        <ion-button fill="clear" size="small" class="add" @click="add({})">
          <ion-icon slot="start" :icon="addOutline" aria-hidden="true" />Add a service
        </ion-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.services-editor {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
/* Image names run long without spaces; the helper-text part may break anywhere. */
ion-toggle::part(helper-text) {
  overflow-wrap: anywhere;
}
.nested {
  --padding-start: 32px;
}
/* ion-input is scoped with no part for the value alone; see ServerForm. */
.mono :deep(.native-input) {
  font-family: var(--font-mono);
  letter-spacing: -0.02em;
  font-size: 0.875rem;
}
.picks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-inline: 4px;
}
.picks-title {
  font-size: 0.8125rem;
  color: var(--color-muted);
}
.chips {
  display: flex;
  flex-wrap: wrap;
}
.add {
  margin: 0;
}
</style>
