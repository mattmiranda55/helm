<script setup>
/**
 * Settings → Stacks: where compose stacks live on this server, the compose
 * command, and the templates a new stack starts from — the wizard's
 * StacksForm, saved as the config's `stacks` section.
 *
 * The config (/api/admin/config) carries the current values plus the
 * built-in defaults (stackDefaults) the form resets to; /api/admin/local adds
 * the folders worth suggesting and whether this machine has an engine at all.
 * Saving refreshes the app's cached config (saveConfig → reloadAppConfig), so
 * the New stack sheet on Containers picks up a new template straight away.
 *
 * Loaded on mount: each push onto the Settings ion-nav is a new instance
 * (unlike a routed tab page, which stays mounted and needs onIonViewWillEnter).
 */
import { IonButton, IonNote, IonSpinner } from '@ionic/vue'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import SettingsView from './SettingsView.vue'
import StacksForm from '@/components/setup/StacksForm.vue'
import { hasErrors, outgoingStacks, stacksErrors } from '@/components/setup/validate'
import { useToast } from '@/composables/useToast'
import { fetchEditableConfig, fetchLocal } from '@/lib/api'
import { clone, describeError, revealInvalid, saveConfig, useUnsavedGuard } from './editing'

const { show } = useToast()
const body = useTemplateRef('body')

const editable = shallowRef(null)
const loading = shallowRef(true)
const loadError = shallowRef(null)

const stacks = shallowRef(null)
const formKey = shallowRef(0)
const showErrors = shallowRef(false)
const saving = shallowRef(false)
const saveError = shallowRef(null)

/** A server that predates stack settings sends no `stacks`; say so rather than show an empty form. */
const supported = computed(() => !!editable.value?.stacks)

const baseline = shallowRef(null)
const dirty = computed(() => baseline.value !== null && JSON.stringify(stacks.value) !== baseline.value)
const { guarded } = useUnsavedGuard(dirty)

function reset(value) {
  stacks.value = value.stacks ? clone(value.stacks) : null
  showErrors.value = false
  saveError.value = null
  baseline.value = JSON.stringify(stacks.value)
  // A fresh form: StacksForm keeps drafts of its text fields, and a reload
  // should start them over from the saved values.
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
  loadLocalInfo()
}
onMounted(load)

/** Suggested folders and the engine. Asked once per visit; a failure only loses the suggestions. */
const local = shallowRef(null)
let localRequest = null
function loadLocalInfo() {
  localRequest ??= fetchLocal()
    .then((value) => (local.value = value))
    .catch(() => (localRequest = null))
}
const dirs = computed(() => local.value?.stackDirs ?? [])
const noEngine = computed(() => !!local.value && !local.value.engine)

const canSave = computed(() => supported.value && dirty.value && !saving.value)

async function save() {
  if (!canSave.value) return
  saveError.value = null
  if (hasErrors(stacksErrors(stacks.value))) {
    showErrors.value = true
    saveError.value = 'Enter the stacks folder as a full path, or turn on Don’t manage stacks.'
    return revealInvalid(body.value)
  }
  saving.value = true
  try {
    // A 400 here is the server's own words ("…doesn't exist on this server"),
    // which describeError passes through as they are.
    await saveConfig({ stacks: outgoingStacks(stacks.value) })
    baseline.value = JSON.stringify(stacks.value)
    show('Saved')
  } catch (cause) {
    saveError.value = describeError(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsView title="Stacks" back-text="Settings" :guarded="guarded">
    <template #end>
      <ion-button v-if="supported" :strong="true" :disabled="!canSave" @click="save">
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

      <p v-else-if="editable && !supported" class="note">
        This helm server doesn’t offer stack settings yet. Update it, then come back.
      </p>

      <template v-else-if="editable && stacks">
        <p v-if="noEngine" class="note">
          helm found no podman or docker on this server, so stacks can’t run here even with a folder set.
        </p>
        <section class="section">
          <StacksForm
            :key="formKey"
            v-model="stacks"
            :defaults="editable.stackDefaults"
            :dirs="dirs"
            :show-errors="showErrors"
          />
          <ion-note class="footer">
            Stacks run on the machine helm is installed on. The folder must already exist there; helm never creates it.
          </ion-note>
        </section>
        <p v-if="saveError" class="note error" role="alert">{{ saveError }}</p>
      </template>
    </div>
  </SettingsView>
</template>

<style scoped>
.settings-sub {
  max-width: 640px;
  gap: 24px;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
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
</style>
