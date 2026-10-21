<script setup>
/**
 * Compose stacks on this server: the folder they live in (one subfolder per
 * stack, each with a compose.yaml — the layout Dockge uses), the compose
 * command, and what a new stack's compose.yaml and .env start from.
 *
 * v-model (modelValue)
 *   { dir, command, template, envTemplate } — emitted whole as a new object
 *   dir          absolute path, or null for "don't manage stacks"
 *   command      argv, e.g. ['docker', 'compose']; [] means the default
 *   template     compose.yaml for a new stack, or null for the built-in default
 *   envTemplate  .env for a new stack, or null for the built-in default
 *   A template edited back to the default text becomes null again, so an
 *   untouched form never writes a copy of the default into the config file
 *   (and a better default in a later helm still reaches it).
 *
 * Props
 *   defaults    stackDefaults from the server: { template, envTemplate, command }
 *   dirs        stackDirs: [{ path, projects }] — existing folders that look
 *               like a stacks folder, offered as one-tap choices
 *   showErrors  show every validation error now, not only after a blur
 *
 * Emits
 *   update:modelValue  (stacks)
 *
 * Exposes
 *   valid   true when stacksErrors (./validate.js) has nothing to say
 */
import { IonButton, IonIcon, IonInput, IonItem, IonLabel, IonList, IonNote, IonToggle } from '@ionic/vue'
import { checkmark } from 'ionicons/icons'
import { computed, reactive, shallowRef, useId, watch } from 'vue'
import { hasErrors, sameTemplate, splitCommand, stacksErrors } from './validate'

const props = defineProps({
  modelValue: { type: Object, required: true },
  defaults: { type: Object, default: null },
  dirs: { type: Array, default: () => [] },
  showErrors: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const stacks = computed(() => props.modelValue)
const errors = computed(() => stacksErrors(stacks.value))
const valid = computed(() => !hasErrors(errors.value))
defineExpose({ valid })

const commit = (change) => emit('update:modelValue', { ...stacks.value, ...change })

// ---------------------------------------------------------------- folder

const off = computed(() => stacks.value.dir === null)
const chosen = computed(() => String(stacks.value.dir ?? '').trim().replace(/\/+$/, ''))

/** The folder typed before "Don't manage stacks" went on, so turning it off again restores it. */
let lastDir = ''
function setOff(on) {
  if (on) {
    lastDir = stacks.value.dir ?? ''
    commit({ dir: null })
  } else {
    commit({ dir: lastDir || props.dirs[0]?.path || '' })
  }
}

const touched = shallowRef(false)
const dirClass = computed(() => ({
  'ion-invalid': !!errors.value.dir,
  'ion-touched': props.showErrors || touched.value,
}))

const countLabel = (n) => (n ? `${n} ${n === 1 ? 'stack' : 'stacks'}` : 'Empty')

// ---------------------------------------------------------------- command

/**
 * The command is argv, shown as one line. The text is kept locally and only
 * its split form goes up: re-rendering the input from the joined array would
 * swallow the space you just typed between "docker" and "compose".
 */
const commandText = shallowRef('')
watch(
  () => stacks.value.command,
  (command) => {
    const parts = command ?? []
    if (splitCommand(commandText.value).join(' ') !== parts.join(' ')) commandText.value = parts.join(' ')
  },
  { immediate: true },
)
function onCommand(text) {
  commandText.value = text
  commit({ command: splitCommand(text) })
}
const defaultCommand = computed(() => (props.defaults?.command ?? []).join(' '))

// ---------------------------------------------------------------- templates

const ids = { template: useId(), envTemplate: useId() }
const FIELDS = [
  { key: 'template', label: 'New-stack template', file: 'compose.yaml', rows: 12 },
  { key: 'envTemplate', label: '.env template', file: '.env', rows: 4 },
]

/**
 * What each textarea shows. Local for the same reason as the command: the
 * model turns null when the text matches the default, and re-rendering from
 * the default then would eat a trailing space mid-edit (trailing whitespace
 * doesn't count as a change). The model only overwrites the draft when the
 * two disagree — a Reset, a reload, or the defaults arriving.
 */
const drafts = reactive({ template: '', envTemplate: '' })
const fallback = (key) => props.defaults?.[key] ?? ''

function sync(key) {
  const value = stacks.value[key]
  if (value == null) {
    if (!sameTemplate(drafts[key], fallback(key))) drafts[key] = fallback(key)
  } else if (drafts[key] !== value) {
    drafts[key] = value
  }
}
for (const { key } of FIELDS) {
  watch([() => stacks.value[key], () => props.defaults?.[key]], () => sync(key), { immediate: true })
}

function onTemplate(key, text) {
  drafts[key] = text
  commit({ [key]: sameTemplate(text, fallback(key)) ? null : text })
}

const isDefault = (key) => stacks.value[key] == null || sameTemplate(stacks.value[key], fallback(key))
const resetTemplate = (key) => commit({ [key]: null })

/**
 * Tab indents instead of moving focus — YAML is whitespace-significant and
 * iOS has no Tab key to spare. The same trick as StackEditor: edit the
 * value, then fire `input` so the handler sees it.
 */
function indent(event) {
  const el = event.target
  const { selectionStart: start, selectionEnd: end, value } = el
  el.value = `${value.slice(0, start)}  ${value.slice(end)}`
  el.selectionStart = el.selectionEnd = start + 2
  el.dispatchEvent(new Event('input'))
}
</script>

<template>
  <div class="stacks-form">
    <section class="block">
      <h3 class="block-title">Folder</h3>
      <ion-list v-if="!off" :inset="true" class="group">
        <ion-item>
          <!-- Modern form syntax: label, helper and error text all belong to the
               ion-input, which wires them to the field for VoiceOver. Ionic 9's
               autocorrect is a boolean, so it is bound false, never "off". -->
          <ion-input
            :value="stacks.dir ?? ''"
            label="Stacks folder"
            label-placement="stacked"
            placeholder="/opt/stacks"
            autocapitalize="off"
            autocomplete="off"
            :autocorrect="false"
            :spellcheck="false"
            class="mono"
            :class="dirClass"
            helper-text="Where each stack gets its own folder with a compose.yaml — Dockge’s is /opt/stacks"
            :error-text="errors.dir"
            @ion-input="commit({ dir: $event.detail.value ?? '' })"
            @ion-blur="touched = true"
          />
        </ion-item>
      </ion-list>

      <ion-list v-if="!off && dirs.length" :inset="true" class="group" aria-label="Folders found on this server">
        <!-- Tappable rows rather than radios: the input above stays the one
             source of truth, and a row is just a shortcut that fills it. -->
        <ion-item v-for="found in dirs" :key="found.path" button :detail="false" @click="commit({ dir: found.path })">
          <ion-label>
            <h3 class="num" translate="no">{{ found.path }}</h3>
            <p>{{ countLabel(found.projects) }}</p>
          </ion-label>
          <ion-icon v-if="chosen === found.path" slot="end" :icon="checkmark" color="primary" aria-label="Chosen" />
        </ion-item>
      </ion-list>

      <ion-list :inset="true" class="group">
        <ion-item>
          <ion-toggle
            :checked="off"
            justify="space-between"
            helper-text="New stack and Manage stack stay hidden until a folder is set."
            @ion-change="setOff($event.detail.checked)"
          >
            Don’t manage stacks
          </ion-toggle>
        </ion-item>
      </ion-list>
      <ion-note v-if="off && !dirs.length" class="footnote">
        helm didn’t find a stacks folder on this server. To manage stacks, create one — Dockge uses
        <span class="num">/opt/stacks</span> — then turn this off and enter it.
      </ion-note>
    </section>

    <template v-if="!off">
      <section class="block">
        <h3 class="block-title">Compose</h3>
        <ion-list :inset="true" class="group">
          <ion-item>
            <ion-input
              :value="commandText"
              label="Compose command"
              label-placement="stacked"
              :placeholder="defaultCommand || 'docker compose'"
              autocapitalize="off"
              autocomplete="off"
              :autocorrect="false"
              :spellcheck="false"
              class="mono"
              :helper-text="`Run directly, not through a shell. Empty uses ${defaultCommand || 'the default'}.`"
              @ion-input="onCommand($event.detail.value ?? '')"
            />
          </ion-item>
        </ion-list>
      </section>

      <!-- Plain textareas, not ion-textarea: this is YAML, and a native field
           takes Tab-to-indent and a monospace face without fighting a shadow
           root. Being native, autocorrect takes Safari's string "off" here —
           the Ionic 9 boolean only applies to Ionic's own inputs. -->
      <section v-for="field in FIELDS" :key="field.key" class="block">
        <div class="field-head">
          <label :for="ids[field.key]" class="block-title">{{ field.label }}</label>
          <ion-button fill="clear" size="small" :disabled="isDefault(field.key)" @click="resetTemplate(field.key)">
            Reset to default
          </ion-button>
        </div>
        <textarea
          :id="ids[field.key]"
          :value="drafts[field.key]"
          :rows="field.rows"
          :aria-describedby="`${ids[field.key]}-note`"
          autocapitalize="none"
          autocorrect="off"
          autocomplete="off"
          spellcheck="false"
          class="code"
          @input="onTemplate(field.key, $event.target.value)"
          @keydown.tab.prevent="indent"
        />
        <ion-note :id="`${ids[field.key]}-note`" class="footnote">
          The <span class="num">{{ field.file }}</span> a new stack starts with.
          <!-- v-pre: otherwise Vue would read {{name}} as an interpolation. -->
          <span v-pre class="num">{{name}}</span> becomes the stack’s name.
          {{ isDefault(field.key) ? 'This is helm’s default.' : 'Customised.' }}
        </ion-note>
      </section>
    </template>
  </div>
</template>

<style scoped>
.stacks-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
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
.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.field-head ion-button {
  margin: 0;
}
/* ion-toggle's label is nowrap + ellipsis in its shadow root; the documented
   `label` part lets it wrap on a narrow phone. */
ion-toggle::part(label) {
  white-space: normal;
}
/* ion-input is scoped with no part for the value alone; see ServerForm. */
.mono :deep(.native-input) {
  font-family: var(--font-mono);
  letter-spacing: -0.02em;
  font-size: 0.875rem;
}
.footnote {
  display: block;
  padding-inline: 16px;
  font-size: 0.8125rem;
  line-height: 1.45;
}
/* The same terminal-dark field as StackEditor, so a template looks like the
   file it becomes. */
.code {
  width: 100%;
  resize: vertical;
  background: var(--color-term);
  color: var(--color-term-ink);
  border: 0;
  border-radius: 8px;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 0.7812rem;
  line-height: 1.5;
}
</style>
