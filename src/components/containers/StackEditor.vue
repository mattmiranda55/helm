<script setup>
/**
 * compose.yaml + .env editor, shown inside the stack sheet.
 *
 * Two plain textareas rather than a code editor: this has to work on a phone,
 * and a full editor buys little for a file you mostly paste into. Tab inserts
 * spaces because YAML is indentation-sensitive and iOS has no Tab key, and the
 * usual iOS input assistance is turned off — autocapitalise would happily turn
 * `services:` into `Services:`.
 *
 * The Save buttons aren't in here: they live in the stack sheet's footer,
 * which stays put while this scrolls, and call `submit()` (exposed below).
 * Submitting goes through the form so the browser still checks the name.
 */
import { IonInput, IonItem, IonList } from '@ionic/vue'
import { shallowRef, useTemplateRef, watch } from 'vue'

const props = defineProps({
  /** null = creating a new stack. */
  name: { type: String, default: null },
  compose: { type: String, default: '' },
  env: { type: String, default: '' },
  error: { type: String, default: null },
  /**
   * Templates for a new stack; `{{name}}` is substituted as you type. Always
   * the effective text from /api/config (the server's built-in default unless
   * Settings → Stacks has a custom one), so there is no fallback here.
   */
  template: { type: String, default: '' },
  envTemplate: { type: String, default: '' },
})

const emit = defineEmits(['save'])

const render = (source, name) => (source ?? '').replaceAll('{{name}}', name || 'app')

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

const form = useTemplateRef('form')
let deployNext = false

/** Save, and with `deploy` start the stack once saved. Return in the name field saves without starting. */
function submit(deploy = false) {
  deployNext = deploy
  form.value?.requestSubmit()
}

function onSubmit() {
  emit('save', { payload: payload(), deploy: deployNext })
  deployNext = false
}

defineExpose({ submit })
</script>

<template>
  <form ref="form" class="editor" @submit.prevent="onSubmit">
    <ion-list v-if="!name" inset class="name">
      <ion-item>
        <!-- Modern form syntax: the label belongs to the ion-input itself
             (https://ionicframework.com/docs/api/input#labels). It comes
             through the `label` slot rather than the `label` prop only so it
             can keep the text face while the typed name is mono. In Ionic 9
             autocorrect is a boolean (already false by default), so it is
             bound, never written as the string "off" — that would turn it on. -->
        <ion-input
          v-model="draftName"
          name="stack-name"
          placeholder="my-stack…"
          required
          autocapitalize="off"
          autocomplete="off"
          :autocorrect="false"
          :spellcheck="false"
          class="num"
        >
          <div slot="label" class="name-label">Name</div>
        </ion-input>
      </ion-item>
    </ion-list>

    <!-- Plain textareas, labelled by the <label> around them. These are native
         elements, so autocorrect takes the HTML (Safari) string "off" — the
         Ionic 9 boolean applies to ion-input/ion-searchbar only. -->
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
  font-size: 0.8125rem;
  color: var(--color-muted);
}
/* One-row inset list, like an iOS settings field, on the sheet's own padding. */
ion-list.name {
  margin: 0;
  border-radius: var(--radius-row);
}
/* The name is an identifier, so the input wears the mono face (.num); the
 * slotted label goes back to the text face. ion-input has no shadow parts and
 * its inner classes changed in Ionic 9, so style the host and the slot, not
 * `.native-input`. */
.name-label {
  font-family: var(--font-sans);
  letter-spacing: normal;
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
  font-size: 0.7812rem;
  line-height: 1.5;
}
.error {
  color: var(--color-critical);
  font-size: 0.75rem;
  white-space: pre-wrap;
}
.hint {
  color: var(--color-muted);
  font-size: 0.8125rem;
}
</style>
