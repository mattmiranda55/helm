<script setup>
/**
 * Settings → Machines → one machine (or `new` to add one): its Glances
 * connection (the wizard's ServerForm) and its apps (ServicesEditor), saved
 * together with Save in the nav bar. Delete removes the machine and its apps.
 *
 * Pushed onto the Settings ion-nav with `id` (and `backText`) as props, from
 * Machines (a row, or + with id 'new') or from Apps. The edits are a local
 * copy of what /api/admin/config returned, loaded on mount: every push is a
 * fresh instance. Save and Delete pop back to the page underneath.
 *
 * Passwords never come back from the server, only `hasPassword`. ServerForm
 * sends '' for a password field left blank, which the server would read as
 * "clear it" — so a blank password is dropped before saving (the saved one is
 * kept) unless Remove Saved Password was tapped.
 *
 * An existing machine's ID is fixed: apps point at it by ID (`node`), and so
 * do links and the alert state.
 */
import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSpinner } from '@ionic/vue'
import { trashOutline } from 'ionicons/icons'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import SettingsView from './SettingsView.vue'
import ServerForm from '@/components/setup/ServerForm.vue'
import ServicesEditor from '@/components/setup/ServicesEditor.vue'
import { cleanUrl, hasErrors, nodeErrors, serviceErrors } from '@/components/setup/validate'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { fetchEditableConfig, fetchLocal, probeGlances } from '@/lib/api'
import {
  blankService,
  clone,
  describeError,
  isLocalNode,
  localSuggestions,
  outgoingNode,
  outgoingService,
  probeSuggestions,
  revealInvalid,
  leave,
  saveConfig,
  useUnsavedGuard,
} from './editing'

const props = defineProps({
  id: { type: String, required: true },
  /** The page underneath, for the Back button. */
  backText: { type: String, default: 'Machines' },
})

const NEW = 'new'
/** Where helm finds the Glances of the machine it runs on (as the wizard sets it). */
const LOCAL_GLANCES = 'http://127.0.0.1:61208'
const isNew = computed(() => props.id === NEW)

const { confirm } = useConfirm()
const { show } = useToast()
const body = useTemplateRef('body')

// ------------------------------------------------------------------ state

/** EditableConfig as loaded — the base every save is built on. */
const editable = shallowRef(null)
const loading = shallowRef(true)
const loadError = shallowRef(null)

/** The copy being edited. */
const node = shallowRef(null)
const services = shallowRef([])
const clearPassword = shallowRef(false)

/** Re-mounts the forms after a reload: they read some state once, at setup. */
const formKey = shallowRef(0)
const probe = shallowRef(null)
const showErrors = shallowRef(false)
const saving = shallowRef(false)
const deleting = shallowRef(false)
const saveError = shallowRef(null)

const saved = computed(() => (isNew.value ? null : (editable.value?.nodes.find((n) => n.id === props.id) ?? null)))
const missing = computed(() => !!editable.value && !isNew.value && !saved.value)
const locked = computed(() => !!editable.value?.nodesFromEnv)

/** What "unsaved" compares: an emptied password field is the same as an untouched one. */
function snapshot() {
  const { password, ...rest } = node.value ?? {}
  return JSON.stringify({ node: password ? node.value : rest, services: services.value, clear: clearPassword.value })
}
const baseline = shallowRef(null)
const dirty = computed(() => baseline.value !== null && snapshot() !== baseline.value)

const { guarded, allowLeave } = useUnsavedGuard(dirty)

// ------------------------------------------------------------------ loading

function reset(value) {
  const found = isNew.value ? null : value.nodes.find((n) => n.id === props.id)
  node.value = found ? clone(found) : { id: '', label: '', url: '', api: 4 }
  services.value = found ? clone(value.services.filter((s) => s.node === found.id)) : []
  clearPassword.value = false
  probe.value = null
  showErrors.value = false
  saveError.value = null
  baseline.value = snapshot()
  formKey.value++
  if (found) autoProbe(found)
}

let run = 0
async function load() {
  if (dirty.value || saving.value) return
  const mine = ++run
  loading.value = !editable.value
  loadError.value = null
  try {
    const value = await fetchEditableConfig()
    if (mine !== run || dirty.value) return
    editable.value = value
    reset(value)
  } catch (cause) {
    if (mine === run) loadError.value = describeError(cause, 'load')
  } finally {
    if (mine === run) loading.value = false
  }
  loadLocal()
}
onMounted(load)

/** This machine's containers and Glances, for suggestions. Once per visit is plenty. */
const local = shallowRef(null)
let localRequest = null
function loadLocal() {
  localRequest ??= fetchLocal()
    .then((value) => {
      local.value = value
    })
    .catch(() => {
      localRequest = null
    })
  return localRequest
}

/**
 * Test a saved machine on arrival, so its status and containers show without
 * a tap. Not for one with a saved password: the probe only uses what is typed
 * here, so it would just fail.
 */
async function autoProbe(found) {
  if (found.hasPassword || found.username) return
  const target = cleanUrl(found.url)
  let result
  try {
    // This machine's own Glances is probed by /api/admin/local anyway; reuse
    // that rather than asking Glances twice at once.
    result = target === LOCAL_GLANCES ? (await loadLocal(), local.value?.glances) : await probeGlances({ url: target })
  } catch {
    return
  }
  // Only if nothing it vouches for has changed in the meantime.
  const unchanged = node.value && cleanUrl(node.value.url) === target && !node.value.username && !node.value.password
  if (result && unchanged && !probe.value) probe.value = result
}

// ------------------------------------------------------------------ form

const isLocal = computed(() => !!node.value && isLocalNode(node.value))
const takenIds = computed(() => {
  const ids = (editable.value?.nodes ?? []).filter((n) => n.id !== props.id).map((n) => n.id)
  // 'new' is what this page is opened with to add one, so no machine can be called that.
  return isNew.value ? [...ids, NEW] : ids
})
/** This server: its containers (with addresses for published ports); others: what their Glances lists. */
const suggestions = computed(() =>
  isLocal.value && local.value?.containers?.length ? localSuggestions(local.value) : probeSuggestions(probe.value),
)
const serverForm = useTemplateRef('serverForm')

const label = computed(() => node.value?.label?.trim() || (isNew.value ? 'New machine' : props.id))
const title = computed(() => (isNew.value ? 'Add Machine' : missing.value ? 'No such machine' : (saved.value?.label ?? props.id)))

function removePassword() {
  clearPassword.value = true
  node.value = { ...node.value, password: '', hasPassword: false }
}
function keepPassword() {
  clearPassword.value = false
  const { password, ...rest } = node.value
  node.value = { ...rest, hasPassword: true }
}

// ------------------------------------------------------------------ save

const busy = computed(() => saving.value || deleting.value)
const canSave = computed(() => !!editable.value && !missing.value && !busy.value && (dirty.value || isNew.value))

/** The full lists with this machine's entry and apps swapped for the edited ones. */
function buildPatch() {
  const config = editable.value
  const id = locked.value ? props.id : node.value.id
  const mine = services.value.filter((s) => !blankService(s)).map((s) => outgoingService(s, id))

  const nextServices = []
  let placed = false
  for (const service of config.services) {
    if (!isNew.value && service.node === props.id) {
      if (!placed) nextServices.push(...mine)
      placed = true
    } else nextServices.push(service)
  }
  if (!placed) nextServices.push(...mine)

  if (locked.value) return { services: nextServices }

  // Blank means "keep the saved one"; only an explicit remove clears it.
  const typed = node.value.password ? node.value.password : undefined
  const password = typed ?? (clearPassword.value ? '' : undefined)
  const edited = outgoingNode(node.value, password)
  const nodes = config.nodes.map((n) => (n.id === props.id ? edited : outgoingNode(n)))
  if (isNew.value) nodes.push(edited)
  return { nodes, services: nextServices }
}

async function save() {
  if (!canSave.value) return
  saveError.value = null
  services.value = services.value.filter((s) => !blankService(s))
  const nodeBad = !locked.value && hasErrors(nodeErrors(node.value, takenIds.value))
  const appsBad = services.value.some((s) => hasErrors(serviceErrors(s)))
  if (nodeBad || appsBad) {
    showErrors.value = true
    saveError.value = nodeBad ? 'Fix the highlighted fields.' : 'Each app needs a name and an http(s) address.'
    return revealInvalid(body.value)
  }

  // A new or moved machine: make sure it answers, or that this is on purpose.
  const urlChanged = !locked.value && (isNew.value || cleanUrl(node.value.url) !== cleanUrl(saved.value?.url))
  if (urlChanged) {
    if (!probe.value) await serverForm.value?.test()
    if (!probe.value?.ok) {
      const ok = await confirm({
        header: `${label.value} isn’t answering`,
        message: 'helm will show it as offline until Glances answers. Save anyway?',
        action: 'Save Anyway',
        destructive: false,
      })
      if (!ok) return
    }
  }

  saving.value = true
  try {
    await saveConfig(buildPatch())
    baseline.value = snapshot()
    show(isNew.value ? `Added ${label.value}` : 'Saved')
    leave()
  } catch (cause) {
    saveError.value = describeError(cause)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!saved.value || busy.value) return
  const name = saved.value.label
  const apps = editable.value.services.filter((s) => s.node === props.id).length
  const ok = await confirm({
    header: `Delete ${name}?`,
    message: apps
      ? `helm stops watching it, and its ${apps} ${apps === 1 ? 'app is' : 'apps are'} removed too. You can add it again later.`
      : 'helm stops watching it. You can add it again later.',
    action: 'Delete Machine',
  })
  if (!ok) return
  deleting.value = true
  saveError.value = null
  try {
    await saveConfig({
      nodes: editable.value.nodes.filter((n) => n.id !== props.id).map((n) => outgoingNode(n)),
      services: editable.value.services.filter((s) => s.node !== props.id),
    })
    allowLeave()
    show(`Deleted ${name}`)
    leave()
  } catch (cause) {
    saveError.value = describeError(cause)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <SettingsView :title="title" :literal-title="!isNew" :back-text="backText" :large-title="false" :guarded="guarded">
    <template #end>
      <ion-button v-if="editable && !missing" :strong="true" :disabled="!canSave" @click="save">
        <ion-spinner v-if="saving" slot="start" name="crescent" aria-hidden="true" />
        {{ saving ? 'Saving…' : isNew ? 'Add' : 'Save' }}
      </ion-button>
    </template>

    <div ref="body" class="page settings-sub">
      <p v-if="loadError" class="note error" role="alert">
        {{ loadError }}
        <ion-button size="small" fill="clear" @click="load">Try again</ion-button>
      </p>

      <p v-if="loading" class="loading"><ion-spinner name="crescent" aria-hidden="true" />Loading…</p>

      <p v-else-if="missing" class="note">
        There’s no machine with the ID <span class="num">{{ id }}</span> any more.
      </p>

      <p v-else-if="isNew && locked" class="note">
        This server’s machines are set by <span class="num">HELM_NODES</span> in its environment. Add one there, then
        restart helm.
      </p>

      <template v-else-if="editable && node">
        <!-- ------------------------------------------------ connection -->
        <section class="section">
          <h2 class="section-title">Machine</h2>
          <template v-if="locked">
            <ion-list :inset="true" class="group">
              <ion-item>
                <ion-label>Name</ion-label>
                <ion-note slot="end" translate="no">{{ node.label }}</ion-note>
              </ion-item>
              <ion-item>
                <ion-label>ID</ion-label>
                <ion-note slot="end" class="num" translate="no">{{ node.id }}</ion-note>
              </ion-item>
              <ion-item>
                <ion-label>Glances</ion-label>
                <ion-note slot="end" class="num" translate="no">{{ node.url }}</ion-note>
              </ion-item>
            </ion-list>
            <ion-note class="footer">
              Set by <span class="num">HELM_NODES</span> in this server’s environment, so it can’t be changed here.
              Its apps can.
            </ion-note>
          </template>
          <template v-else>
            <ServerForm
              :key="`server-${formKey}`"
              ref="serverForm"
              v-model="node"
              :probe="probeGlances"
              :result="probe"
              :taken-ids="takenIds"
              :lock-id="!isNew"
              :show-errors="showErrors"
              @probed="probe = $event"
            />
            <!-- Why the ID is fixed is ServerForm's helper text under the field
                 (lock-id), where a screen reader hears it with the input. -->
            <ion-note v-if="saved?.hasPassword && !clearPassword" class="footer">
              Test uses only what’s typed here, so type the password to test with it.
            </ion-note>

            <ion-list v-if="saved?.hasPassword && !clearPassword" :inset="true" class="group">
              <ion-item button :detail="false" @click="removePassword">
                <ion-label color="danger">Remove Saved Password</ion-label>
              </ion-item>
            </ion-list>
            <p v-else-if="clearPassword" class="note pending">
              The saved password will be removed when you save.
              <ion-button size="small" fill="clear" @click="keepPassword">Keep It</ion-button>
            </p>
          </template>
        </section>

        <!-- ------------------------------------------------ apps -->
        <section class="section">
          <h2 class="section-title">
            Apps on <span translate="no">{{ label }}</span>
          </h2>
          <ServicesEditor
            :key="`services-${formKey}`"
            v-model="services"
            :node="node.id || null"
            :suggestions="suggestions"
            :show-errors="showErrors"
          />
          <ion-note v-if="!isLocal && !probe?.ok" class="footer">
            Test the connection and helm will offer this machine’s containers to pick from.
          </ion-note>
        </section>

        <p v-if="saveError" class="note error" role="alert">{{ saveError }}</p>

        <!-- ------------------------------------------------ delete -->
        <section v-if="saved && !locked" class="section">
          <ion-list :inset="true" class="group">
            <ion-item button :detail="false" :disabled="busy" @click="remove">
              <ion-icon slot="start" :icon="trashOutline" color="danger" aria-hidden="true" />
              <ion-label color="danger">{{ deleting ? 'Deleting…' : 'Delete Machine' }}</ion-label>
            </ion-item>
          </ion-list>
        </section>
      </template>
    </div>
  </SettingsView>
</template>

<style scoped>
.settings-sub {
  max-width: 640px;
  gap: 28px;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.section .section-title {
  margin-bottom: 0;
  padding-inline: 4px;
}
.group {
  margin: 0;
}
.footer {
  display: block;
  padding-inline: 16px;
  font-size: 0.8125rem;
  line-height: 1.4;
}
.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline: 16px;
  font-size: 0.8438rem;
  color: var(--color-muted);
}
.loading ion-spinner,
ion-button ion-spinner {
  width: 16px;
  height: 16px;
}
.error {
  color: var(--color-critical);
}
.note ion-button {
  margin: 0;
}
.pending {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 8px;
}
</style>
