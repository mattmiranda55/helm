<script setup>
/**
 * Compose stacks — the operations half of what Dockge does.
 *
 * Stopped stacks are shown exactly like running ones: they are the archive of
 * things to come back to, not failures to be hidden. Deleting is the deliberate
 * way to get rid of something, and it takes the data with it.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import PanelCard from './PanelCard.vue'
import StackEditor from './StackEditor.vue'
import {
  createStack,
  deleteStack,
  fetchStackFiles,
  fetchStacks,
  saveStackFiles,
  stackAction,
  stackStreamUrl,
} from '@/lib/api'

const props = defineProps({
  template: { type: String, default: null },
  envTemplate: { type: String, default: null },
})

const stacks = ref([])
const loading = ref(true)
const error = ref(null)

const busy = ref(null) // stack name with a job running
const output = ref(null) // { name, lines: [], done }
const confirming = ref(null) // stack name pending delete
const editor = ref(null) // { name|null, compose, env, busy, error }

let socket = null
let timer = null

async function load() {
  try {
    stacks.value = await fetchStacks()
    error.value = null
  } catch (cause) {
    error.value = cause.message
  } finally {
    loading.value = false
  }
}

/** Follows a job's output until it finishes; the job itself outlives this. */
function stream(name) {
  socket?.close()
  output.value = { name, lines: [], done: false }
  socket = new WebSocket(stackStreamUrl(name))
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.type === 'snapshot') output.value = { name, lines: [...message.job.output], done: message.job.done }
    else if (message.type === 'output') output.value.lines.push(message.text)
    else if (message.type === 'done') {
      output.value.done = true
      busy.value = null
      load()
    }
  }
  socket.onclose = () => {
    if (output.value && !output.value.done) busy.value = null
  }
}

async function run(name, action) {
  error.value = null
  confirming.value = null
  busy.value = name
  try {
    await stackAction(name, action)
    stream(name)
  } catch (cause) {
    error.value = cause.message
    busy.value = null
  }
}

async function openEditor(name) {
  editor.value = { name, compose: '', env: '', busy: true, error: null }
  try {
    const files = await fetchStackFiles(name)
    editor.value = { name, compose: files.compose, env: files.env, busy: false, error: null }
  } catch (cause) {
    editor.value = { name, compose: '', env: '', busy: false, error: cause.message }
  }
}

async function persist(payload, deploy) {
  editor.value = { ...editor.value, busy: true, error: null }
  try {
    const creating = !editor.value.name
    const name = creating ? payload.name : editor.value.name
    if (creating) await createStack(payload.name, payload.compose, payload.env)
    else await saveStackFiles(name, payload.compose, payload.env)

    editor.value = null
    await load()
    if (deploy) await run(name, 'up')
  } catch (cause) {
    editor.value = { ...editor.value, busy: false, error: cause.message }
  }
}

async function remove(name) {
  confirming.value = null
  busy.value = name
  try {
    await deleteStack(name)
    if (output.value?.name === name) output.value = null
  } catch (cause) {
    error.value = cause.message
  } finally {
    busy.value = null
    await load()
  }
}

onMounted(() => {
  load()
  // podman ps is local and cheap; stale status on a control panel is worse.
  timer = setInterval(load, 15_000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  socket?.close()
})

const STATUS = {
  running: { label: 'running', color: 'var(--color-good)' },
  partial: { label: 'partial', color: 'var(--color-warning)' },
  stopped: { label: 'stopped', color: 'var(--color-muted)' },
}
const running = () => stacks.value.filter((s) => s.status === 'running').length
</script>

<template>
  <PanelCard
    title="Stacks"
    :subtitle="loading ? 'loading…' : `${running()} of ${stacks.length} running`"
    flush
  >
    <template #actions>
      <button
        type="button"
        class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
        @click="editor = { name: null, compose: '', env: '', busy: false, error: null }"
      >
        New
      </button>
      <button
        type="button"
        class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-raised hover:text-ink"
        @click="load"
      >
        Refresh
      </button>
    </template>

    <p
      v-if="error"
      class="border-b border-hairline px-4 py-2 text-[11px]"
      :style="{ color: 'var(--color-critical)' }"
    >
      {{ error }}
    </p>

    <ul>
      <li v-for="stack in stacks" :key="stack.name" class="border-t border-hairline px-4 py-2.5">
        <div class="flex items-start gap-2">
          <span class="min-w-0 flex-1 font-mono text-[12px] break-words text-ink">
            {{ stack.name }}
          </span>
          <span
            class="flex shrink-0 items-center gap-1.5 pt-0.5 text-[10px] whitespace-nowrap"
            :style="{ color: STATUS[stack.status].color }"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :style="{ background: STATUS[stack.status].color }"
            />
            {{ STATUS[stack.status].label }}
          </span>
        </div>

        <div class="truncate text-[10px] text-muted">
          <template v-if="stack.services.length">
            {{ stack.services.map((s) => `${s.name} (${s.status})`).join(' · ') }}
          </template>
          <template v-else>{{ stack.composeFile }} — no containers</template>
        </div>

        <!-- Delete is destructive and irreversible, so it swaps the row out
             rather than sitting next to the everyday buttons. -->
        <div v-if="confirming === stack.name" class="mt-2 flex items-center gap-2">
          <span class="min-w-0 flex-1 text-[11px] text-ink-2">
            Delete {{ stack.name }} and its data?
          </span>
          <button
            type="button"
            class="shrink-0 rounded-md border border-hairline px-2 py-1 text-[11px] text-muted"
            @click="confirming = null"
          >
            Cancel
          </button>
          <button
            type="button"
            class="shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium text-plane"
            :style="{ background: 'var(--color-critical)' }"
            @click="remove(stack.name)"
          >
            Delete
          </button>
        </div>

        <div v-else class="mt-2 flex flex-wrap items-center gap-2">
          <button
            v-for="action in ['up', 'restart', 'down']"
            :key="action"
            type="button"
            class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            :disabled="!!busy"
            @click="run(stack.name, action)"
          >
            {{ action }}
          </button>
          <button
            type="button"
            class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            :disabled="!!busy"
            @click="openEditor(stack.name)"
          >
            edit
          </button>
          <button
            type="button"
            class="rounded-md border border-hairline px-2 py-1 text-[11px] transition-colors hover:bg-raised disabled:opacity-40"
            :style="{ color: 'var(--color-critical)' }"
            :disabled="!!busy"
            @click="confirming = stack.name"
          >
            delete
          </button>
          <span v-if="busy === stack.name" class="ml-auto text-[10px] text-muted">working…</span>
        </div>

        <pre
          v-if="output?.name === stack.name && output.lines.length"
          class="mt-2 max-h-48 overflow-auto rounded-md bg-sunken p-2 font-mono text-[10px] whitespace-pre-wrap text-ink-2"
          >{{ output.lines.join('\n') }}</pre
        >
      </li>

      <li v-if="!loading && !stacks.length" class="px-4 py-6 text-center text-[11px] text-muted">
        No stacks found. Point <code class="font-mono text-ink-2">stacks.dir</code> at your compose
        directory.
      </li>
    </ul>

    <StackEditor
      v-if="editor"
      :name="editor.name"
      :compose="editor.compose"
      :env="editor.env"
      :busy="editor.busy"
      :error="editor.error"
      :template="props.template"
      :env-template="props.envTemplate"
      @close="editor = null"
      @save="persist($event, false)"
      @deploy="persist($event, true)"
    />
  </PanelCard>
</template>
