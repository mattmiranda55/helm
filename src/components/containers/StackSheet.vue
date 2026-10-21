<script setup>
/**
 * A compose stack: start/restart/stop all of it, follow the job's output,
 * edit its files, or delete it. `stack` null = creating a new one.
 *
 * Stop all and Delete ask first with the native action sheet, on top of this
 * sheet; Start all and Restart all don't, as on a container. The footer holds
 * whichever set of primary actions applies — the stack's, or the editor's
 * Save — so they stay in reach while the body scrolls.
 */
import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSpinner } from '@ionic/vue'
import { createOutline, trashOutline } from 'ionicons/icons'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import StackEditor from './StackEditor.vue'
import BottomSheet from '@/components/ui/BottomSheet.vue'
import { useConfirm } from '@/composables/useConfirm'
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

/**
 * Which stack the sheet is about. Held while it closes: the modal keeps
 * rendering through its dismiss animation, after the parent has already let
 * go of the stack, and the sheet should slide away as it was rather than turn
 * into an empty "New stack" on the way out.
 */
const shown = shallowRef({ creating: props.creating, stack: props.stack })
watch(
  () => [props.open, props.creating, props.stack],
  ([open, creating, stack]) => {
    if (open) shown.value = { creating, stack }
  },
)
const creating = computed(() => shown.value.creating)
const stack = computed(() => shown.value.stack)

const { confirm } = useConfirm()
const editor = useTemplateRef('editor')
const editing = shallowRef(false)
const files = shallowRef({ compose: '', env: '', loading: false, error: null })
const saveError = shallowRef(null)
const saving = shallowRef(false)

const title = computed(() => (creating.value ? 'New stack' : (stack.value?.name ?? '')))
const subtitle = computed(() => {
  if (creating.value || !stack.value) return 'Paste or write a compose file'
  const up = stack.value.services.filter((s) => s.status === 'running').length
  return `${up} of ${stack.value.services.length} containers up`
})
const jobLines = computed(() => (props.output && props.output.name === stack.value?.name ? props.output.lines : null))

async function startEditing() {
  editing.value = true
  saveError.value = null
  if (creating.value) return
  files.value = { compose: '', env: '', loading: true, error: null }
  try {
    const result = await fetchStackFiles(stack.value.name)
    files.value = { compose: result.compose, env: result.env, loading: false, error: null }
  } catch (cause) {
    files.value = { compose: '', env: '', loading: false, error: cause.message }
  }
}

// Reset on opening (or switching stack, e.g. a new one once it's created), not
// on closing — the sheet should not swap views while it is sliding away.
watch(
  [() => props.open, () => stack.value?.name, creating],
  ([open]) => {
    if (!open) return
    saveError.value = null
    editing.value = false
    if (creating.value) startEditing()
  },
  { immediate: true },
)

/**
 * After a confirmation, only go ahead if the sheet is still about the same
 * stack — it can close or move on while the action sheet is up.
 */
const stillShowing = (name) => props.open && stack.value?.name === name && !props.busy

async function act(action) {
  const name = stack.value.name
  if (action === 'down') {
    const ok = await confirm({
      header: `Stop all of ${name}?`,
      message: 'compose down stops and removes its containers. The compose file and volumes stay, so Start all brings it back.',
      action: 'Stop all',
    })
    if (!ok || !stillShowing(name)) return
  }
  emit('run', action)
}

async function remove() {
  const name = stack.value.name
  const ok = await confirm({
    header: `Delete ${name}?`,
    message: "This takes it down and removes its containers, named volumes and folder, compose file included. It can't be undone.",
    action: 'Delete stack',
  })
  if (ok && stillShowing(name)) emit('remove')
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
      if (!message && !creating.value) editing.value = false
    },
  })
}
</script>

<template>
  <BottomSheet :open="open" :title="title" :subtitle="subtitle" @close="emit('close')">
    <template v-if="!creating && stack">
      <p v-if="error" class="error">{{ error }}</p>

      <section v-if="jobLines">
        <h3 class="label">
          <ion-spinner v-if="!output.done" name="crescent" class="spinner" aria-hidden="true" />
          {{ output.done ? 'Finished' : 'Working…' }}
        </h3>
        <pre class="output" translate="no">{{ jobLines.join('\n') || '…' }}</pre>
      </section>

      <ion-list v-if="stack.services.length" inset lines="full" class="services">
        <ion-item v-for="service in stack.services" :key="service.name">
          <ion-label class="num" translate="no">{{ service.container ?? service.name }}</ion-label>
          <ion-note slot="end">{{ service.status }}</ion-note>
        </ion-item>
      </ion-list>
    </template>

    <StackEditor
      v-if="editing && !files.loading"
      ref="editor"
      :key="stack?.name ?? 'new'"
      :name="creating ? null : stack?.name"
      :compose="files.compose"
      :env="files.env"
      :error="saveError ?? files.error"
      :template="template"
      :env-template="envTemplate"
      @save="save"
    />
    <p v-else-if="editing" class="note loading">
      <ion-spinner name="crescent" class="spinner" aria-hidden="true" />Loading the compose file…
    </p>

    <div v-else-if="!creating && stack" class="secondary">
      <ion-button fill="outline" size="small" @click="startEditing">
        <ion-icon slot="start" :icon="createOutline" aria-hidden="true" />Edit compose file
      </ion-button>
      <ion-button fill="clear" size="small" color="danger" class="delete" :disabled="busy" @click="remove">
        <ion-icon slot="start" :icon="trashOutline" aria-hidden="true" />Delete stack
      </ion-button>
    </div>

    <template v-if="editing && !files.loading" #footer>
      <div class="actions">
        <ion-button fill="clear" class="cancel" @click="creating ? emit('close') : (editing = false)">Cancel</ion-button>
        <ion-button fill="outline" class="action" :disabled="saving" @click="editor?.submit(false)">Save file</ion-button>
        <ion-button class="action" :disabled="saving" @click="editor?.submit(true)">
          <ion-spinner v-if="saving" slot="start" name="crescent" class="spinner" aria-hidden="true" />
          {{ saving ? 'Saving…' : 'Save and start' }}
        </ion-button>
      </div>
    </template>
    <template v-else-if="!editing && !creating && stack" #footer>
      <div class="actions">
        <ion-button class="action" :disabled="busy" @click="act('up')">Start all</ion-button>
        <ion-button class="action" fill="outline" :disabled="busy" @click="act('restart')">Restart all</ion-button>
        <ion-button class="action" fill="outline" color="danger" :disabled="busy" @click="act('down')">Stop all</ion-button>
      </div>
    </template>
  </BottomSheet>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.action {
  flex: 1 1 0;
  min-width: max-content;
  margin: 0;
}
.cancel {
  margin: 0;
}
.secondary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}
.secondary ion-button {
  margin: 0;
}
.error {
  color: var(--color-critical);
  font-size: 0.875rem;
}
.label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  color: var(--color-muted);
  font-weight: 500;
  margin-bottom: 6px;
}
.spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: currentColor;
}
ion-button .spinner {
  width: 16px;
  height: 16px;
  margin-inline-end: 6px;
}
.loading {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Grows rather than scrolling inside the sheet, like the container logs: the
 * sheet's drag gesture only knows about ion-content's scroll position. */
.output {
  background: var(--color-term);
  color: var(--color-term-ink);
  border-radius: 8px;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 0.7188rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* An inset card like the page's lists, on the sheet's padding. */
ion-list.services {
  margin: 0;
  border-radius: var(--radius-row);
}
.services ion-item {
  --min-height: 44px;
  font-size: 0.8125rem;
}
</style>
