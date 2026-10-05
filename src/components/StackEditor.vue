<script setup>
/**
 * Compose + .env editor.
 *
 * Two plain textareas rather than a code editor: this has to work on a phone,
 * and a full editor buys little for a file you mostly paste into. Tab inserts
 * spaces because YAML is indentation-sensitive and iOS has no Tab key, and the
 * usual iOS input assistance is turned off — autocapitalise would happily turn
 * `services:` into `Services:`.
 */
import { ref, watch } from 'vue'

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

const emit = defineEmits(['save', 'deploy', 'close'])

/** Only used when the server supplies no template of its own. */
const FALLBACK = `services:
  {{name}}:
    image:
    container_name: {{name}}
    restart: always
`

const render = (source, name) =>
  (source ?? FALLBACK).replaceAll('{{name}}', name || 'app')

const draftName = ref(props.name ?? '')
const draftCompose = ref(props.compose || (props.name ? '' : render(props.template, '')))
const draftEnv = ref(props.env || (props.name ? '' : render(props.envTemplate ?? '', '')))

watch(
  () => [props.compose, props.env],
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
  if (draftCompose.value === render(props.template, previous)) {
    draftCompose.value = render(props.template, next)
  }
  if (draftEnv.value === render(props.envTemplate ?? '', previous)) {
    draftEnv.value = render(props.envTemplate ?? '', next)
  }
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
  <Teleport to="body">
    <div class="safe-overlay fixed inset-0 z-50 flex flex-col bg-plane/95 backdrop-blur-sm">
      <div
        class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-sunken"
      >
        <header class="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5">
          <h3 class="truncate font-mono text-[13px] text-ink">
            {{ name ?? 'New stack' }}
          </h3>
          <button
            type="button"
            class="ml-auto shrink-0 rounded-md border border-hairline px-3 py-2 text-[12px] text-ink-2 hover:bg-raised hover:text-ink"
            @click="emit('close')"
          >
            Cancel
          </button>
          <button
            type="button"
            class="shrink-0 rounded-md border border-hairline px-3 py-2 text-[12px] text-ink-2 disabled:opacity-40"
            :disabled="busy"
            @click="emit('save', payload())"
          >
            Save
          </button>
          <button
            type="button"
            class="shrink-0 rounded-md px-3 py-2 text-[12px] font-medium text-plane disabled:opacity-40"
            style="background: var(--color-series-1)"
            :disabled="busy"
            @click="emit('deploy', payload())"
          >
            {{ busy ? 'Working…' : 'Save & up' }}
          </button>
        </header>

        <p
          v-if="error"
          class="shrink-0 border-b border-hairline px-4 py-2 font-mono text-[11px] whitespace-pre-wrap"
          :style="{ color: 'var(--color-critical)' }"
        >
          {{ error }}
        </p>

        <div class="min-h-0 flex-1 overflow-auto p-3">
          <label v-if="!name" class="mb-3 block">
            <span class="mb-1 block text-[10px] tracking-wide text-muted uppercase">Name</span>
            <input
              v-model="draftName"
              type="text"
              placeholder="my-stack"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              class="w-full rounded-md border border-hairline bg-plane px-3 py-2 font-mono text-[12px] text-ink placeholder:text-muted focus:border-[var(--color-series-1)] focus:outline-none"
            />
          </label>

          <label class="mb-3 block">
            <span class="mb-1 block text-[10px] tracking-wide text-muted uppercase">
              compose.yaml
            </span>
            <textarea
              v-model="draftCompose"
              rows="16"
              autocapitalize="none"
              autocorrect="off"
              autocomplete="off"
              spellcheck="false"
              class="w-full resize-y rounded-md border border-hairline bg-plane p-3 font-mono text-[12px] leading-relaxed text-ink focus:border-[var(--color-series-1)] focus:outline-none"
              @keydown.tab.prevent="indent"
            />
          </label>

          <label class="block">
            <span class="mb-1 block text-[10px] tracking-wide text-muted uppercase">.env</span>
            <textarea
              v-model="draftEnv"
              rows="6"
              autocapitalize="none"
              autocorrect="off"
              autocomplete="off"
              spellcheck="false"
              class="w-full resize-y rounded-md border border-hairline bg-plane p-3 font-mono text-[12px] leading-relaxed text-ink focus:border-[var(--color-series-1)] focus:outline-none"
              @keydown.tab.prevent="indent"
            />
          </label>
        </div>
      </div>
    </div>
  </Teleport>
</template>
