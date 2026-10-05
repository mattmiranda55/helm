<script setup>
/**
 * compose.yaml + .env editor, shown inside the stack sheet.
 *
 * Two plain textareas rather than a code editor: this has to work on a phone,
 * and a full editor buys little for a file you mostly paste into. Tab inserts
 * spaces because YAML is indentation-sensitive and iOS has no Tab key, and the
 * usual iOS input assistance is turned off — autocapitalise would happily turn
 * `services:` into `Services:`.
 */
import { shallowRef, watch } from 'vue'

const props = defineProps({
  /** null = creating a new stack. */
  name: { type: String, default: null },
  compose: { type: String, default: '' },
  env: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: null },
  /** Templates for a new stack; `{{name}}` is substituted as you type. */
  template: { type: String, default: null },
  envTemplate: { type: String, default: null },
})

const emit = defineEmits(['save', 'cancel'])

/** Only used when the server supplies no template of its own. */
const FALLBACK = `services:
  {{name}}:
    image:
    container_name: {{name}}
    restart: always
`

const render = (source, name) => (source ?? FALLBACK).replaceAll('{{name}}', name || 'app')

const draftName = shallowRef(props.name ?? '')
const draftCompose = shallowRef(props.compose || (props.name ? '' : render(props.template, '')))
const draftEnv = shallowRef(props.env || (props.name ? '' : render(props.envTemplate ?? '', '')))

watch(
  [() => props.compose, () => props.env],
  ([compose, env]) => {
    draftCompose.value = compose || (props.name ? '' : render(props.template, draftName.value))
    draftEnv.value = env || (props.name ? '' : render(props.envTemplate ?? '', draftName.value))
  },
)

/**
 * Re-render the template as the name is typed, but only while it is still
 * untouched — typing a name should fill in the paths for you, and should never
 * discard something you wrote.
 */
watch(draftName, (next, previous) => {
  if (props.name) return
  if (draftCompose.value === render(props.template, previous)) draftCompose.value = render(props.template, next)
  if (draftEnv.value === render(props.envTemplate ?? '', previous)) draftEnv.value = render(props.envTemplate ?? '', next)
})

/** Tab indents instead of moving focus — the file is whitespace-significant. */
function indent(event) {
  const el = event.target
  const { selectionStart: start, selectionEnd: end, value } = el
  el.value = `${value.slice(0, start)}  ${value.slice(end)}`
  el.selectionStart = el.selectionEnd = start + 2
  el.dispatchEvent(new Event('input'))
}

const payload = () => ({
  name: (draftName.value || '').trim(),
  compose: draftCompose.value,
  env: draftEnv.value,
})
</script>

<template>
  <form class="editor" @submit.prevent="emit('save', { payload: payload(), deploy: false })">
    <label v-if="!name" class="field">
      <span class="field-label">Name</span>
      <input
        v-model="draftName"
        name="stack-name"
        type="text"
        placeholder="my-stack…"
        required
        autocapitalize="none"
        autocorrect="off"
        autocomplete="off"
        spellcheck="false"
        class="input num"
      />
    </label>

    <label class="field">
      <span class="field-label num">compose.yaml</span>
      <textarea
        v-model="draftCompose"
        name="compose"
        rows="14"
        autocapitalize="none"
        autocorrect="off"
        autocomplete="off"
        spellcheck="false"
        class="code"
        @keydown.tab.prevent="indent"
      />
    </label>

    <label class="field">
      <span class="field-label num">.env</span>
      <textarea
        v-model="draftEnv"
        name="env"
        rows="5"
        autocapitalize="none"
        autocorrect="off"
        autocomplete="off"
        spellcheck="false"
        class="code"
        @keydown.tab.prevent="indent"
      />
    </label>

    <p v-if="error" class="error num">{{ error }}</p>

    <div class="actions">
      <button type="submit" class="btn" :disabled="busy">Save file</button>
      <button type="button" class="btn btn-primary" :disabled="busy" @click="emit('save', { payload: payload(), deploy: true })">
        {{ busy ? 'Saving…' : 'Save and start' }}
      </button>
      <button type="button" class="text-link" @click="emit('cancel')">Cancel</button>
    </div>
    <p class="hint">
      helm checks the file with <code class="num">compose config</code> before saving and keeps the
      previous version as a <code class="num">.bak</code> file.
    </p>
  </form>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 13px;
  color: var(--color-muted);
}
.input {
  border: 1px solid var(--color-hairline);
  background: var(--color-plane);
  border-radius: var(--radius-row);
  padding: 10px 12px;
  font-size: 16px;
}
.code {
  width: 100%;
  resize: vertical;
  background: var(--color-term);
  color: var(--color-term-ink);
  border: 0;
  border-radius: 8px;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.5;
}
.error {
  color: var(--color-critical);
  font-size: 12px;
  white-space: pre-wrap;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hint {
  color: var(--color-muted);
  font-size: 13px;
}
</style>
