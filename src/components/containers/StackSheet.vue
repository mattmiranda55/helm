<script setup>
/**
 * A compose stack: start/restart/stop all of it, follow the job's output,
 * edit its files, or delete it. `stack` null = creating a new one.
 */
import { computed, shallowRef, watch } from 'vue'
import StackEditor from './StackEditor.vue'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import { useArmed } from '@/composables/useArmed'
import { fetchStackFiles } from '@/lib/api'

const props = defineProps({
  open: { type: Boolean, default: false },
  creating: { type: Boolean, default: false },
  stack: { type: Object, default: null },
  /** { name, lines, done } — output of the job being followed */
  output: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: null },
  template: { type: String, default: null },
  envTemplate: { type: String, default: null },
})

const emit = defineEmits(['close', 'run', 'save', 'remove'])

const { armed, confirm, disarm } = useArmed()
const editing = shallowRef(false)
const files = shallowRef({ compose: '', env: '', loading: false, error: null })
const saveError = shallowRef(null)
const saving = shallowRef(false)

const title = computed(() => (props.creating ? 'New stack' : (props.stack?.name ?? '')))
const subtitle = computed(() => {
  if (props.creating || !props.stack) return 'Paste or write a compose file'
  const up = props.stack.services.filter((s) => s.status === 'running').length
  return `${up} of ${props.stack.services.length} containers up`
})
const jobLines = computed(() => (props.output && props.output.name === props.stack?.name ? props.output.lines : null))

async function startEditing() {
  editing.value = true
  saveError.value = null
  if (props.creating) return
  files.value = { compose: '', env: '', loading: true, error: null }
  try {
    const result = await fetchStackFiles(props.stack.name)
    files.value = { compose: result.compose, env: result.env, loading: false, error: null }
  } catch (cause) {
    files.value = { compose: '', env: '', loading: false, error: cause.message }
  }
}

watch(
  [() => props.open, () => props.stack?.name, () => props.creating],
  ([open]) => {
    disarm()
    saveError.value = null
    editing.value = false
    if (open && props.creating) startEditing()
  },
  { immediate: true },
)

function act(action) {
  if (action === 'down' && !confirm(`down:${props.stack.name}`)) return
  emit('run', action)
}

function remove() {
  if (!confirm(`delete:${props.stack.name}`)) return
  emit('remove')
}

/** The parent does the saving and calls back with an error message, or null. */
function save(event) {
  saving.value = true
  saveError.value = null
  emit('save', {
    ...event,
    done: (message) => {
      saving.value = false
      saveError.value = message
      if (!message && !props.creating) editing.value = false
    },
  })
}
</script>

<template>
  <BottomSheet :open="open" :title="title" :subtitle="subtitle" @close="emit('close')">
    <template v-if="!creating && stack">
      <div class="actions">
        <button type="button" class="btn btn-primary" :disabled="busy" @click="act('up')">Start all</button>
        <button type="button" class="btn" :disabled="busy" @click="act('restart')">Restart all</button>
        <button
          type="button"
          class="btn btn-danger"
          :class="{ 'btn-armed': armed === `down:${stack.name}` }"
          :disabled="busy"
          @click="act('down')"
        >
          {{ armed === `down:${stack.name}` ? 'Tap again to stop all' : 'Stop all' }}
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <section v-if="jobLines">
        <h3 class="label">{{ output.done ? 'Finished' : 'Working…' }}</h3>
        <pre class="output" translate="no">{{ jobLines.join('\n') || '…' }}</pre>
      </section>

      <ul v-if="stack.services.length" class="services">
        <li v-for="service in stack.services" :key="service.name">
          <span class="num" translate="no">{{ service.container ?? service.name }}</span>
          <span class="svc-state">{{ service.status }}</span>
        </li>
      </ul>
    </template>

    <StackEditor
      v-if="editing && !files.loading"
      :key="stack?.name ?? 'new'"
      :name="creating ? null : stack?.name"
      :compose="files.compose"
      :env="files.env"
      :busy="saving"
      :error="saveError ?? files.error"
      :template="template"
      :env-template="envTemplate"
      @save="save"
      @cancel="creating ? emit('close') : (editing = false)"
    />
    <p v-else-if="editing" class="note">Loading the compose file…</p>

    <div v-else-if="!creating && stack" class="secondary">
      <button type="button" class="btn" @click="startEditing">Edit compose file</button>
      <button
        type="button"
        class="text-link danger"
        :class="{ armed: armed === `delete:${stack.name}` }"
        :disabled="busy"
        @click="remove"
      >
        {{ armed === `delete:${stack.name}` ? 'Tap again to delete the stack and its data' : 'Delete stack' }}
      </button>
    </div>
  </BottomSheet>
</template>

<style scoped>
.actions,
.secondary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.secondary {
  justify-content: space-between;
}
.error {
  color: var(--color-critical);
  font-size: 14px;
}
.label {
  font-size: 14px;
  color: var(--color-muted);
  font-weight: 500;
  margin-bottom: 6px;
}
.output {
  background: var(--color-term);
  color: var(--color-term-ink);
  border-radius: 8px;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow-y: auto;
}
.services {
  display: flex;
  flex-direction: column;
}
.services li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--color-hairline);
  font-size: 13px;
}
.svc-state {
  color: var(--color-muted);
}
.danger {
  color: var(--color-critical);
}
.danger.armed {
  font-weight: 700;
}
</style>
