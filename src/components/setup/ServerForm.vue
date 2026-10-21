<script setup>
/**
 * One machine (a Glances node): its name, ID, Glances URL, optional Glances
 * credentials, and a Test that asks the helm server to reach it — the server
 * is the one that will poll it, and the browser may not be able to.
 *
 * v-model (modelValue)
 *   { id, label, url, api, local?, username?, password?, hasPassword? }
 *   Emitted whole, as a new object, on every edit. Fields it doesn't edit
 *   (local, hasPassword, anything else) are carried through untouched.
 *   The ID follows the name (slugified) until the ID is edited by hand.
 *
 * Props
 *   probe       async ({ url, username?, password? }) => Probe — required.
 *               Setup passes (t) => probeGlancesForSetup(code, t); Settings
 *               passes probeGlances.
 *   result      a Probe already known for the current URL (e.g. Local.glances,
 *               or one saved by the parent); shown until the URL or
 *               credentials change
 *   takenIds    IDs the other nodes use, for the uniqueness check
 *   lockId      show the ID read-only (an existing node others refer to); its
 *               helper text says why, so the page needn't
 *   showErrors  show every validation error now, not only after a blur
 *
 * Emits
 *   update:modelValue  (node)
 *   probed             (Probe | null) — a fresh result, or null when an edit
 *                      made the last one stale. A successful probe also sets
 *                      `api` on the node to the version Glances answered with.
 *
 * Exposes
 *   test()    run the probe now (a Retry elsewhere on the page); resolves when done
 *   testing   a probe is in flight
 *   errors    the current validation errors ({ field: message })
 */
import {
  IonButton,
  IonInput,
  IonInputPasswordToggle,
  IonItem,
  IonList,
  IonSpinner,
  IonToggle,
} from '@ionic/vue'
import { computed, shallowRef, watch } from 'vue'
import { nodeErrors, slugify, cleanUrl } from './validate'
import StatusText from '@/components/ui/StatusText.vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  probe: { type: Function, required: true },
  result: { type: Object, default: null },
  takenIds: { type: Array, default: () => [] },
  lockId: { type: Boolean, default: false },
  showErrors: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'probed'])

const node = computed(() => props.modelValue)
const errors = computed(() => nodeErrors(node.value, props.takenIds))
const touched = shallowRef({})
const touch = (field) => (touched.value = { ...touched.value, [field]: true })

/** The ID stops following the name once someone types their own. */
const idEdited = shallowRef(!!props.modelValue.id && props.modelValue.id !== slugify(props.modelValue.label))

function update(patch) {
  emit('update:modelValue', { ...node.value, ...patch })
}

const label = computed({
  get: () => node.value.label ?? '',
  set: (value) => update(idEdited.value || props.lockId ? { label: value } : { label: value, id: slugify(value) }),
})
const id = computed({
  get: () => node.value.id ?? '',
  set: (value) => {
    const next = String(value ?? '').toLowerCase()
    idEdited.value = next !== '' && next !== slugify(node.value.label)
    update({ id: next })
  },
})
const url = computed({ get: () => node.value.url ?? '', set: (value) => update({ url: value }) })
const username = computed({ get: () => node.value.username ?? '', set: (value) => update({ username: value }) })
const password = computed({ get: () => node.value.password ?? '', set: (value) => update({ password: value }) })

/** The credentials rows show when asked for, or when there already are some. */
const needsLogin = shallowRef(!!(props.modelValue.username || props.modelValue.password || props.modelValue.hasPassword))
function setNeedsLogin(on) {
  needsLogin.value = on
  if (!on && (node.value.username || node.value.password)) update({ username: '', password: '' })
}

// ------------------------------------------------------------------ test

const current = shallowRef(props.result)
const testing = shallowRef(false)
watch(
  () => props.result,
  (value) => {
    current.value = value
  },
)

// A result only vouches for what it tested; editing the target drops it, and
// a test still in flight for the old target lands nowhere.
let run = 0
watch(
  () => [cleanUrl(node.value.url), node.value.username ?? '', node.value.password ?? '', needsLogin.value],
  (next, previous) => {
    if (previous && next.every((value, index) => value === previous[index])) return
    run++
    testing.value = false
    if (current.value) {
      current.value = null
      emit('probed', null)
    }
  },
)

const canTest = computed(() => !errors.value.url && !testing.value)

async function test() {
  if (!canTest.value) {
    touch('url')
    return
  }
  const mine = ++run
  testing.value = true
  const target = { url: cleanUrl(node.value.url) }
  if (needsLogin.value && node.value.username) target.username = node.value.username
  if (needsLogin.value && node.value.password) target.password = node.value.password
  let result
  try {
    result = await props.probe(target)
  } catch (cause) {
    result = { ok: false, error: cause?.message ?? String(cause) }
  }
  if (mine !== run) return
  testing.value = false
  current.value = result
  emit('probed', result)
  if (result?.ok && result.api && result.api !== node.value.api) update({ api: result.api })
}

defineExpose({ test, errors, testing })

const summary = computed(() => {
  const result = current.value
  if (!result) return null
  if (!result.ok) return { level: 'critical', text: result.error || 'Glances did not answer' }
  const parts = [`Glances ${result.api ?? ''} on ${result.hostname ?? 'unknown host'}`.replace('  ', ' ')]
  if (result.os) parts.push(result.os)
  if (Array.isArray(result.containers)) {
    const n = result.containers.length
    parts.push(`${n} ${n === 1 ? 'container' : 'containers'}`)
  }
  return { level: 'good', text: parts.join(' · ') }
})

// --------------------------------------------------------- validation UI

const fieldClass = (field) => ({
  'ion-invalid': !!errors.value[field],
  'ion-touched': props.showErrors || !!touched.value[field],
})
</script>

<template>
  <div class="server-form">
    <ion-list :inset="true" class="group">
      <ion-item>
        <ion-input
          v-model="label"
          label="Name"
          label-placement="fixed"
          placeholder="Basement server"
          autocapitalize="words"
          :class="fieldClass('label')"
          :error-text="errors.label"
          @ion-blur="touch('label')"
        />
      </ion-item>
      <ion-item>
        <ion-input
          v-model="id"
          label="ID"
          label-placement="fixed"
          placeholder="basement-server"
          autocapitalize="off"
          :autocorrect="false"
          :spellcheck="false"
          :readonly="lockId"
          class="mono"
          :class="fieldClass('id')"
          :error-text="errors.id"
          :helper-text="
            lockId
              ? 'Can’t be changed: apps, links and alerts refer to it. For another ID, add the machine again.'
              : `Used in links: /machines/${id || '…'}`
          "
          @ion-blur="touch('id')"
        />
      </ion-item>
      <ion-item>
        <ion-input
          v-model="url"
          label="Glances"
          label-placement="fixed"
          type="url"
          inputmode="url"
          placeholder="http://192.168.1.20:61208"
          autocapitalize="off"
          :autocorrect="false"
          :spellcheck="false"
          class="mono"
          :class="fieldClass('url')"
          :error-text="errors.url"
          @ion-blur="touch('url')"
          @keydown.enter.prevent="test"
        />
      </ion-item>
      <ion-item>
        <ion-toggle :checked="needsLogin" @ion-change="setNeedsLogin($event.detail.checked)">
          Glances asks for a password
        </ion-toggle>
      </ion-item>
      <template v-if="needsLogin">
        <ion-item>
          <ion-input
            v-model="username"
            label="Username"
            label-placement="fixed"
            placeholder="glances"
            autocomplete="off"
            autocapitalize="off"
            :autocorrect="false"
            :spellcheck="false"
          />
        </ion-item>
        <ion-item>
          <ion-input
            v-model="password"
            label="Password"
            label-placement="fixed"
            type="password"
            autocomplete="new-password"
            :placeholder="modelValue.hasPassword ? 'Saved — leave blank to keep' : ''"
          >
            <ion-input-password-toggle slot="end" color="medium" />
          </ion-input>
        </ion-item>
      </template>
    </ion-list>

    <div class="test">
      <ion-button size="small" fill="outline" :disabled="!canTest" @click="test">
        <ion-spinner v-if="testing" slot="start" name="crescent" aria-hidden="true" />
        {{ testing ? 'Testing…' : current ? 'Test again' : 'Test connection' }}
      </ion-button>
      <p class="result" role="status" aria-live="polite">
        <StatusText v-if="testing" level="muted">Asking {{ url || 'Glances' }}…</StatusText>
        <StatusText v-else-if="summary" :level="summary.level">{{ summary.text }}</StatusText>
      </p>
    </div>
  </div>
</template>

<style scoped>
.server-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group {
  margin: 0;
}
/* ion-input is scoped and has no part for the value's font alone (a host
   font-family would set the label too), so this reaches the class Ionic
   styles itself. */
.mono :deep(.native-input) {
  font-family: var(--font-mono);
  letter-spacing: -0.02em;
  font-size: 0.875rem;
}
/* ion-toggle's label is nowrap + ellipsis in its shadow root; the documented
   `label` part lets it wrap on a narrow phone instead of truncating. */
ion-toggle::part(label) {
  white-space: normal;
}
.test {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding-inline: 4px;
}
.test ion-button {
  margin: 0;
}
.test ion-spinner {
  width: 16px;
  height: 16px;
}
.result {
  min-width: 0;
  flex: 1 1 200px;
}
.result :deep(.status) {
  white-space: normal;
  align-items: baseline;
}
</style>
