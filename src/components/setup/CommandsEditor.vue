<script setup>
/**
 * Saved terminal commands: suggested presets as toggles, plus your own.
 * A preset is "on" when a command with exactly its command line exists;
 * everything else is a custom entry (name, description, command, Remove).
 *
 * v-model (modelValue)
 *   [{ name, description?, command }] — emitted whole as a new array
 *
 * Props
 *   presets     [{ name, description, command }] — e.g. commandPresets(engine)
 *               from ./presets.js
 *   showErrors  show every validation error now, not only after a blur
 *
 * Emits
 *   update:modelValue  (commands)
 *
 * Exposes
 *   valid   true when every command has a name and a command line
 */
import { IonButton, IonIcon, IonInput, IonItem, IonLabel, IonList, IonToggle } from '@ionic/vue'
import { addOutline, trashOutline } from 'ionicons/icons'
import { computed, nextTick, shallowRef, useTemplateRef } from 'vue'
import { commandErrors, hasErrors } from './validate'

const props = defineProps({
  modelValue: { type: Array, required: true },
  presets: { type: Array, default: () => [] },
  showErrors: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const commands = computed(() => props.modelValue)
const errors = computed(() => commands.value.map(commandErrors))
const valid = computed(() => errors.value.every((e) => !hasErrors(e)))
defineExpose({ valid })

const presetLines = computed(() => new Set(props.presets.map((p) => p.command)))
const isOn = (preset) => commands.value.some((c) => c.command === preset.command)
const custom = computed(() =>
  commands.value
    .map((command, index) => ({ command, index }))
    .filter(({ command }) => !presetLines.value.has(command.command)),
)

const commit = (next) => emit('update:modelValue', next)

function toggle(preset, on) {
  if (on && !isOn(preset)) {
    commit([...commands.value, { name: preset.name, description: preset.description ?? '', command: preset.command }])
  } else if (!on) {
    commit(commands.value.filter((c) => c.command !== preset.command))
  }
}

function patch(index, change) {
  commit(commands.value.map((command, i) => (i === index ? { ...command, ...change } : command)))
}

const root = useTemplateRef('root')
async function add() {
  commit([...commands.value, { name: '', description: '', command: '' }])
  await nextTick()
  root.value?.querySelector(`[data-name="${commands.value.length - 1}"]`)?.setFocus?.()
}

const remove = (index) => commit(commands.value.filter((_, i) => i !== index))

const touched = shallowRef({})
const touch = (index, field) => (touched.value = { ...touched.value, [`${index}.${field}`]: true })
const fieldClass = (index, field) => ({
  'ion-invalid': !!errors.value[index]?.[field],
  'ion-touched': props.showErrors || !!touched.value[`${index}.${field}`],
})
</script>

<template>
  <div ref="root" class="commands-editor">
    <section v-if="presets.length" class="block">
      <h3 class="block-title">Suggested</h3>
      <ion-list :inset="true" class="group">
        <ion-item v-for="preset in presets" :key="preset.command">
          <!-- The command line is the toggle's helper-text: Ionic renders it under
               the label, wrapped, and links it with aria-describedby. -->
          <ion-toggle
            :checked="isOn(preset)"
            justify="space-between"
            :helper-text="preset.command"
            @ion-change="toggle(preset, $event.detail.checked)"
          >
            {{ preset.name }}
            <span v-if="preset.description" class="row-sub">{{ preset.description }}</span>
          </ion-toggle>
        </ion-item>
      </ion-list>
    </section>

    <section class="block">
      <h3 v-if="custom.length" class="block-title">Your commands</h3>
      <ion-list v-for="{ command, index } in custom" :key="index" :inset="true" class="group">
        <ion-item>
          <ion-input
            :value="command.name"
            label="Name"
            label-placement="fixed"
            placeholder="Update packages"
            :data-name="index"
            :class="fieldClass(index, 'name')"
            :error-text="errors[index]?.name"
            @ion-input="patch(index, { name: $event.detail.value ?? '' })"
            @ion-blur="touch(index, 'name')"
          />
        </ion-item>
        <ion-item>
          <ion-input
            :value="command.description ?? ''"
            label="Note"
            label-placement="fixed"
            placeholder="Optional"
            @ion-input="patch(index, { description: $event.detail.value ?? '' })"
          />
        </ion-item>
        <ion-item>
          <ion-input
            :value="command.command"
            label="Command"
            label-placement="fixed"
            placeholder="sudo apt update && sudo apt upgrade"
            autocapitalize="off"
            :autocorrect="false"
            :spellcheck="false"
            class="mono"
            :class="fieldClass(index, 'command')"
            :error-text="errors[index]?.command"
            @ion-input="patch(index, { command: $event.detail.value ?? '' })"
            @ion-blur="touch(index, 'command')"
          />
        </ion-item>
        <ion-item button :detail="false" @click="remove(index)">
          <ion-icon slot="start" :icon="trashOutline" color="danger" aria-hidden="true" />
          <ion-label color="danger">Remove {{ command.name || 'this command' }}</ion-label>
        </ion-item>
      </ion-list>
      <div>
        <ion-button fill="clear" size="small" class="add" @click="add">
          <ion-icon slot="start" :icon="addOutline" aria-hidden="true" />Add a command
        </ion-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.commands-editor {
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
/* ion-toggle's label is nowrap + ellipsis in its shadow root; the documented
   `label` part lets the description wrap under the name instead. */
ion-toggle::part(label) {
  white-space: normal;
}
.row-sub {
  display: block;
  margin-top: 2px;
  font-size: 0.7812rem;
  color: var(--color-muted);
}
/* The command, in the mono face; shell has no spaces where it matters. */
ion-toggle::part(helper-text) {
  font-family: var(--font-mono);
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
/* ion-input is scoped with no part for the value alone; see ServerForm. */
.mono :deep(.native-input) {
  font-family: var(--font-mono);
  letter-spacing: -0.02em;
  font-size: 0.875rem;
}
.add {
  margin: 0;
}
</style>
