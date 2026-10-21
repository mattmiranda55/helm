<script setup>
/**
 * Settings → Apps: every service, grouped by the machine it runs on. Pick
 * favorites at the top (the wizard's FavoritesPicker); add, edit and remove
 * apps per machine below (its ServicesEditor). One Save writes them all.
 *
 * Apps whose machine isn't configured (or that name none) sit under "Other".
 * Only this server's containers can be suggested here — for another
 * machine's, open it under Machines, where its Glances is asked.
 *
 * Loaded on mount (each push onto the Settings ion-nav is a new instance),
 * and again when a save lands while there are no unsaved edits here — e.g.
 * after adding the first machine from the link on this page.
 */
import { IonButton, IonNavLink, IonNote, IonSpinner } from '@ionic/vue'
import { computed, markRaw, onMounted, shallowRef, useTemplateRef } from 'vue'
import MachineSettings from './MachineSettings.vue'
import SettingsView from './SettingsView.vue'
import FavoritesPicker from '@/components/setup/FavoritesPicker.vue'
import ServicesEditor from '@/components/setup/ServicesEditor.vue'
import { hasErrors, serviceErrors } from '@/components/setup/validate'
import { useToast } from '@/composables/useToast'
import { fetchEditableConfig, fetchLocal } from '@/lib/api'
import {
  blankService,
  clone,
  describeError,
  isLocalNode,
  localSuggestions,
  onConfigSaved,
  outgoingService,
  probeSuggestions,
  revealInvalid,
  saveConfig,
  useUnsavedGuard,
} from './editing'

const { show } = useToast()
const body = useTemplateRef('body')
/** markRaw: see SettingsModal. */
const machinePage = markRaw(MachineSettings)

const editable = shallowRef(null)
const loading = shallowRef(true)
const loadError = shallowRef(null)

/** [{ key, nodeId, title, local, services }] — one per machine, then Other. */
const groups = shallowRef([])
const formKey = shallowRef(0)
const showErrors = shallowRef(false)
const saving = shallowRef(false)
const saveError = shallowRef(null)

const snapshot = () => JSON.stringify(groups.value.map((g) => g.services))
const baseline = shallowRef(null)
const dirty = computed(() => baseline.value !== null && snapshot() !== baseline.value)
const { guarded } = useUnsavedGuard(dirty)

function reset(value) {
  const known = new Set(value.nodes.map((n) => n.id))
  const next = value.nodes.map((node) => ({
    key: `node:${node.id}`,
    nodeId: node.id,
    title: node.label,
    local: isLocalNode(node),
    services: clone(value.services.filter((s) => s.node === node.id)),
  }))
  const other = clone(value.services.filter((s) => !s.node || !known.has(s.node)))
  if (other.length) next.push({ key: 'other', nodeId: null, title: 'Other', local: false, services: other })
  groups.value = next
  showErrors.value = false
  saveError.value = null
  baseline.value = snapshot()
  formKey.value++
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
onConfigSaved(load)

const local = shallowRef(null)
let localRequest = null
function loadLocal() {
  localRequest ??= fetchLocal()
    .then((value) => (local.value = value))
    .catch(() => (localRequest = null))
}
/** This server's containers; failing those, what its own Glances lists. */
function suggestionsFor(group) {
  if (!group.local || !local.value) return []
  return local.value.containers?.length ? localSuggestions(local.value) : probeSuggestions(local.value.glances)
}

function setServices(index, list) {
  groups.value = groups.value.map((group, i) => (i === index ? { ...group, services: list } : group))
}

// ------------------------------------------------------------------ favorites

const nodeLabels = computed(() => (editable.value?.nodes ?? []).map((n) => ({ id: n.id, label: n.label })))

/** Every app, flat, in group order — FavoritesPicker only flips `favorite`. */
const allServices = computed({
  get: () => groups.value.flatMap((g) => g.services.map((s) => (g.nodeId ? { ...s, node: g.nodeId } : s))),
  set: (list) => {
    let i = 0
    groups.value = groups.value.map((group) => ({
      ...group,
      services: group.services.map((service) => ({ ...service, favorite: !!list[i++]?.favorite })),
    }))
  },
})
const total = computed(() => allServices.value.filter((s) => !blankService(s)).length)

// ------------------------------------------------------------------ save

const canSave = computed(() => !!editable.value && dirty.value && !saving.value)

async function save() {
  if (!canSave.value) return
  saveError.value = null
  groups.value = groups.value.map((g) => ({ ...g, services: g.services.filter((s) => !blankService(s)) }))
  if (groups.value.some((g) => g.services.some((s) => hasErrors(serviceErrors(s))))) {
    showErrors.value = true
    saveError.value = 'Each app needs a name and an http(s) address.'
    return revealInvalid(body.value)
  }
  saving.value = true
  try {
    const services = groups.value.flatMap((g) => g.services.map((s) => outgoingService(s, g.nodeId ?? s.node ?? null)))
    await saveConfig({ services })
    baseline.value = snapshot()
    show('Saved')
  } catch (cause) {
    saveError.value = describeError(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsView title="Apps" back-text="Settings" :guarded="guarded">
    <template #end>
      <ion-button v-if="editable" :strong="true" :disabled="!canSave" @click="save">
        <ion-spinner v-if="saving" slot="start" name="crescent" aria-hidden="true" />
        {{ saving ? 'Saving…' : 'Save' }}
      </ion-button>
    </template>

    <div ref="body" class="page settings-sub">
      <p v-if="loadError" class="note error" role="alert">
        {{ loadError }}
        <ion-button size="small" fill="clear" @click="load">Try again</ion-button>
      </p>

      <p v-if="loading" class="loading"><ion-spinner name="crescent" aria-hidden="true" />Loading…</p>

      <template v-else-if="editable">
        <p v-if="!groups.length" class="note">
          No machines yet, so nowhere for apps to live. Add a machine first.
          <ion-nav-link
            router-direction="forward"
            :component="machinePage"
            :component-props="{ id: 'new', backText: 'Apps' }"
          >
            <ion-button size="small" fill="clear">Add a machine</ion-button>
          </ion-nav-link>
        </p>

        <template v-else>
          <section class="section">
            <h2 class="section-title">Favorites</h2>
            <FavoritesPicker v-if="total" v-model="allServices" :nodes="nodeLabels" />
            <ion-note class="footer">
              {{ total ? 'Pinned to the top of the Machines page, one tap away.' : 'Add some apps below, then pick favorites here.' }}
            </ion-note>
          </section>

          <section v-for="(group, index) in groups" :key="group.key" class="section">
            <h2 class="section-title">
              <span translate="no">{{ group.title }}</span>
              <span v-if="group.local" class="badge">This server</span>
            </h2>
            <ServicesEditor
              :key="`${group.key}-${formKey}`"
              :model-value="group.services"
              :node="group.nodeId"
              :suggestions="suggestionsFor(group)"
              :show-errors="showErrors"
              @update:model-value="setServices(index, $event)"
            />
            <ion-note v-if="!group.local && group.nodeId" class="footer">
              To pick from this machine’s containers, edit it under Machines.
            </ion-note>
          </section>
        </template>

        <p v-if="saveError" class="note error" role="alert">{{ saveError }}</p>
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
  align-items: center;
}
.footer {
  display: block;
  padding-inline: 16px;
  font-size: 0.8125rem;
  line-height: 1.4;
}
.badge {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--color-sunken);
  color: var(--color-muted);
  font-size: 0.7188rem;
  font-weight: 600;
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
</style>
