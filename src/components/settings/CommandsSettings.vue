<script setup>
/**
 * Settings → Terminal commands: the saved commands above the terminal, with
 * the wizard's CommandsEditor — suggested presets as toggles (container ones
 * for this server's engine, from /api/admin/local), plus your own.
 *
 * Loaded on mount: each push onto the Settings ion-nav is a new instance.
 */
import { IonButton, IonNote, IonSpinner } from '@ionic/vue'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import SettingsView from './SettingsView.vue'
import CommandsEditor from '@/components/setup/CommandsEditor.vue'
import { commandPresets } from '@/components/setup/presets'
import { commandErrors, hasErrors } from '@/components/setup/validate'
import { useToast } from '@/composables/useToast'
import { fetchEditableConfig, fetchLocal } from '@/lib/api'
import { clone, describeError, revealInvalid, saveConfig, useUnsavedGuard } from './editing'

const { show } = useToast()
const body = useTemplateRef('body')

const editable = shallowRef(null)
const loading = shallowRef(true)
const loadError = shallowRef(null)

const commands = shallowRef([])
const formKey = shallowRef(0)
const showErrors = shallowRef(false)
const saving = shallowRef(false)
const saveError = shallowRef(null)

const baseline = shallowRef(null)
const dirty = computed(() => baseline.value !== null && JSON.stringify(commands.value) !== baseline.value)
const { guarded } = useUnsavedGuard(dirty)

function reset(value) {
  commands.value = clone(value.commands)
  showErrors.value = false
  saveError.value = null
  baseline.value = JSON.stringify(commands.value)
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
  loadEngine()
}
onMounted(load)

/** podman, docker or null — which container presets to offer. Asked once per visit. */
const engine = shallowRef(null)
let engineRequest = null
function loadEngine() {
  engineRequest ??= fetchLocal()
    .then((value) => (engine.value = value.engine ?? null))
    .catch(() => (engineRequest = null))
}
const presets = computed(() => commandPresets(engine.value))

const blankCommand = (c) => !c.name?.trim() && !c.command?.trim() && !c.description?.trim()
const canSave = computed(() => !!editable.value && dirty.value && !saving.value)

async function save() {
  if (!canSave.value) return
  saveError.value = null
  commands.value = commands.value.filter((c) => !blankCommand(c))
  if (commands.value.some((c) => hasErrors(commandErrors(c)))) {
    showErrors.value = true
    saveError.value = 'Each command needs a name and something to run.'
    return revealInvalid(body.value)
  }
  saving.value = true
  try {
    await saveConfig({
      commands: commands.value.map((c) => ({
        name: c.name.trim(),
        description: c.description?.trim() || undefined,
        command: c.command.trim(),
      })),
    })
    baseline.value = JSON.stringify(commands.value)
    show('Saved')
  } catch (cause) {
    saveError.value = describeError(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsView title="Terminal Commands" back-text="Settings" :guarded="guarded">
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
        <section class="section">
          <CommandsEditor :key="formKey" v-model="commands" :presets="presets" :show-errors="showErrors" />
          <ion-note class="footer">
            Saved commands sit above the terminal. Tapping one types it; nothing runs until you press Enter.
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
