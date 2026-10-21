<script setup>
/**
 * The root of the Settings modal's ion-nav (SettingsModal): Configuration
 * (rows that push the Machines, Apps, Terminal commands and Stacks editors,
 * which write helm's config file), then the token this device sends to helm.
 * Done closes the modal — through its dismiss, so unsaved edits still ask.
 *
 * The rows push with nav.push() from the item's click rather than wrapping
 * each ion-item in an <ion-nav-link>: the inset list's iOS separators are
 * drawn by selectors like `ion-item:only-child`, and an item that's alone
 * inside its own nav-link matches it, so every row lost its separator.
 * ion-nav-link is used where it wraps a button instead (Machines' Add).
 * https://ionicframework.com/docs/api/nav-link
 *
 * open('machines') opens Settings on a section: the root pushes it, without
 * animation, as soon as it's mounted, so Back still leads here.
 *
 * There is no server address to set: the app is always served by the server
 * it talks to, so every request is same origin. The token is settable here so
 * it never has to be typed into an address bar as ?token= — and so a
 * home-screen install, which can't be opened with such a link, can sign in.
 *
 * "Test connection" checks the token as typed, before anything is saved:
 * /api/health first (open, so it separates "can't reach it" from "reached it
 * but the token is wrong"), then /api/config, which is guarded and so proves
 * the token. Saving reloads the app so every module and socket starts over
 * with the new value.
 */
import {
  IonButton,
  IonIcon,
  IonInput,
  IonInputPasswordToggle,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
} from '@ionic/vue'
import {
  addCircleOutline,
  appsOutline,
  keyOutline,
  layersOutline,
  serverOutline,
  shareOutline,
  terminalOutline,
} from 'ionicons/icons'
import { computed, markRaw, onMounted, shallowRef, watch } from 'vue'
import AppsSettings from './AppsSettings.vue'
import CommandsSettings from './CommandsSettings.vue'
import { pushPage } from './editing'
import MachinesSettings from './MachinesSettings.vue'
import SettingsView from './SettingsView.vue'
import StacksSettings from './StacksSettings.vue'
import StatusText from '@/components/ui/StatusText.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { useConfirm } from '@/composables/useConfirm'
import { takeSettingsSection, useSettings } from '@/composables/useSettings'
import { saveToken, token as savedToken } from '@/lib/api'

const { confirm } = useConfirm()
const { close } = useSettings()

/** The pages a row (or open(section)) pushes. markRaw: see SettingsModal. */
const SECTIONS = {
  machines: markRaw(MachinesSettings),
  apps: markRaw(AppsSettings),
  commands: markRaw(CommandsSettings),
  stacks: markRaw(StacksSettings),
}

onMounted(() => {
  const section = SECTIONS[takeSettingsSection()]
  if (section) pushPage(section, undefined, { animated: false })
})

/** Counts for the Configuration rows; the editors refresh this config after a save. */
const { config, loaded } = useAppConfig()

/**
 * The Stacks row shows the folder from the shared app config, which
 * saveConfig() reloads after every Settings save — so coming Back from the
 * Stacks page already shows what was saved, with no request of its own.
 * (The same goes for the counts.)
 */
const stacksDir = computed(() => (loaded.value ? (config.value.stacks?.dir ?? null) : undefined))

const configRows = computed(() => [
  { section: 'machines', label: 'Machines', icon: serverOutline, note: loaded.value ? config.value.nodes.length : null },
  { section: 'apps', label: 'Apps', icon: appsOutline, note: loaded.value ? config.value.services.length : null },
  {
    section: 'commands',
    label: 'Terminal commands',
    icon: terminalOutline,
    note: loaded.value ? config.value.commands.length : null,
  },
  {
    section: 'stacks',
    label: 'Stacks',
    icon: layersOutline,
    note: stacksDir.value === undefined ? null : (stacksDir.value ?? 'Off'),
    mono: !!stacksDir.value,
  },
])

const origin = location.origin
const secret = shallowRef(savedToken ?? '')

/** idle | testing | ok | error — with the words to show for it. */
const result = shallowRef({ state: 'idle', message: '' })

const changed = computed(() => secret.value.trim() !== (savedToken ?? ''))
const testing = computed(() => result.value.state === 'testing')

/**
 * Already on the home screen? Then there's nothing to install. navigator.standalone
 * is iOS Safari's own flag; the media query covers everything else.
 */
const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches

// A result only vouches for the value it tested: editing clears it, and a
// test still in flight for the old value lands nowhere.
let run = 0
watch(secret, () => {
  run++
  result.value = { state: 'idle', message: '' }
})

async function request(path, headers, timeoutMs = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(path, { headers, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

async function test() {
  if (testing.value) return
  const key = secret.value.trim()
  result.value = { state: 'testing', message: `Trying ${origin}…` }
  const mine = ++run
  const settle = (next) => {
    if (mine === run) result.value = next
  }

  try {
    const health = await request('/api/health', {})
    const body = await health.json().catch(() => null)
    if (!health.ok || body?.ok !== true) {
      settle({
        state: 'error',
        message: `${origin} answered, but not like a helm server (HTTP ${health.status}).`,
      })
      return
    }

    const config = await request('/api/config', key ? { 'X-Helm-Token': key } : {})
    if (config.status === 401) {
      settle({
        state: 'error',
        message: key ? 'Reached helm, but it refused this token.' : 'Reached helm, but this server requires a token.',
      })
      return
    }
    if (!config.ok) {
      const detail = await config.json().catch(() => ({}))
      settle({ state: 'error', message: `Reached helm, but it said: ${detail.error ?? `HTTP ${config.status}`}` })
      return
    }
    const { nodes = [] } = await config.json()
    settle({
      state: 'ok',
      message: `Connected. ${nodes.length} ${nodes.length === 1 ? 'machine' : 'machines'} configured.`,
    })
  } catch (cause) {
    // A refused connection and a dropped tailnet reach here as the same bare
    // TypeError — the browser won't say which.
    settle({
      state: 'error',
      message:
        cause?.name === 'AbortError'
          ? `No answer from ${origin} after 6 seconds.`
          : "Couldn't reach the server. Is this device on your tailnet?",
    })
  }
}

/**
 * Clearing a saved token is the one save that can lock you out: if the server
 * wants one, nothing loads until it's typed in again — so it asks first.
 */
async function save() {
  if (!changed.value) return
  const next = secret.value.trim()
  if (!next && savedToken) {
    const ok = await confirm({
      header: 'Remove the token?',
      message: "This device will stop sending it. If the server requires one, nothing will load until it's entered again.",
      action: 'Remove Token',
    })
    if (!ok) return
  }
  saveToken(next)
}

const levels = { testing: 'muted', ok: 'good', error: 'critical' }
</script>

<template>
  <SettingsView title="Settings">
    <template #end>
      <ion-button :strong="true" @click="close">Done</ion-button>
    </template>

    <div class="page settings">
      <section class="section">
        <h2 class="section-title">Configuration</h2>
        <ion-list :inset="true" class="group">
          <ion-item
            v-for="row in configRows"
            :key="row.section"
            :button="true"
            :detail="true"
            @click="pushPage(SECTIONS[row.section])"
          >
            <ion-icon slot="start" :icon="row.icon" aria-hidden="true" />
            <ion-label>{{ row.label }}</ion-label>
            <!-- Counts are numbers and a folder is an identifier, so both wear the
                 mono face; "Off" is a word and doesn't. -->
            <ion-note
              v-if="row.note != null"
              slot="end"
              class="row-note"
              :class="{ num: typeof row.note === 'number' || row.mono }"
              translate="no"
            >
              {{ row.note }}
            </ion-note>
          </ion-item>
        </ion-list>
        <ion-note class="footer">Saved to helm’s config file on the server, and used straight away.</ion-note>
      </section>

      <form class="section" novalidate @submit.prevent="test">
        <h2 class="section-title">Connection</h2>

        <ion-list :inset="true" class="group">
          <ion-item>
            <ion-label>Server</ion-label>
            <ion-note slot="end" class="num">{{ origin }}</ion-note>
          </ion-item>
          <ion-item>
            <!-- Ionic 9: autocorrect is a boolean prop, so the string "off" is
                 truthy and turned it ON. Bind false (or leave it out: false is
                 the default). -->
            <ion-input
              v-model="secret"
              label="Token"
              type="password"
              placeholder="None"
              autocomplete="off"
              autocapitalize="off"
              :autocorrect="false"
              :spellcheck="false"
              class="token"
            >
              <ion-input-password-toggle slot="end" color="medium" />
            </ion-input>
          </ion-item>
        </ion-list>
        <ion-note class="footer">
          Only needed if the server sets <span class="num">auth.token</span>. The server is always the one that served
          this page.
        </ion-note>

        <div class="actions">
          <ion-button type="submit" fill="outline" :disabled="testing">
            {{ testing ? 'Testing…' : 'Test connection' }}
          </ion-button>
          <ion-button :disabled="!changed" @click="save">Save</ion-button>
        </div>

        <p class="result" role="status" aria-live="polite">
          <StatusText v-if="result.state !== 'idle'" :level="levels[result.state]">{{ result.message }}</StatusText>
          <span v-else-if="changed" class="hint">Saving reloads helm with the new token.</span>
        </p>
      </form>

      <section v-if="!standalone" class="section">
        <h2 class="section-title">Add to Home Screen</h2>
        <ion-list :inset="true" class="group">
          <ion-item>
            <ion-icon slot="start" :icon="shareOutline" aria-hidden="true" />
            <ion-label class="ion-text-wrap">In Safari, tap Share.</ion-label>
          </ion-item>
          <ion-item>
            <ion-icon slot="start" :icon="addCircleOutline" aria-hidden="true" />
            <ion-label class="ion-text-wrap">Choose Add to Home Screen.</ion-label>
          </ion-item>
          <ion-item>
            <ion-icon slot="start" :icon="keyOutline" aria-hidden="true" />
            <ion-label class="ion-text-wrap">If the server uses a token, open Settings in the new app and enter it.</ion-label>
          </ion-item>
        </ion-list>
        <ion-note class="footer">
          helm then opens full screen, like an app. The home-screen copy keeps its own storage, apart from Safari's,
          and always starts at the home page — it can't be given a <span class="num">?token=</span> link, so the token
          has to be entered here.
        </ion-note>
      </section>
    </div>
  </SettingsView>
</template>

<style scoped>
.settings {
  max-width: 640px;
  gap: 32px;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section .section-title {
  margin-bottom: 0;
}
/* The page gutter already insets the group; Ionic's inset margin would double it. */
.group {
  margin: 0;
}
/* A long stacks path truncates instead of squeezing the row's label. */
.row-note {
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The value is an identifier, so it wears the mono face; the label doesn't.
   ion-input is scoped and has no part for the value alone, hence .native-input. */
.token :deep(.native-input) {
  font-family: var(--font-mono);
  letter-spacing: -0.02em;
}
/* iOS settings footers: small muted text under the group, aligned with its rows. */
.footer {
  display: block;
  padding-inline: 16px;
  font-size: 0.8125rem;
  line-height: 1.4;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 8px;
}
.actions ion-button {
  margin: 0;
}
.result {
  min-height: 20px;
}
/* Long messages wrap rather than push the page sideways. */
.result :deep(.status) {
  white-space: normal;
  align-items: baseline;
}
.hint {
  color: var(--color-muted);
  font-size: 0.8438rem;
}
</style>
