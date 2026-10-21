<script setup>
/**
 * First-run setup, shown instead of the app until the server has a config
 * (the router sends every route here; see src/router/index.ts).
 *
 *   code      the one-time setup code install.sh printed — every setup call carries it
 *   scope     just this server, or this server and others
 *   server    this machine: name, ID, its Glances (with install help if missing)
 *   services  apps on this machine, suggested from containers publishing ports
 *   others    more machines, each with its Glances URL and apps (only for "and others")
 *   favorites which apps to pin to the top of Machines
 *   commands  saved terminal commands
 *   stacks    the compose-stacks folder, command and new-stack templates
 *             (optional; only when this server has a container engine)
 *   token     generate an access token, or not
 *   review    summary, then Finish writes the config
 *   (done)    the new token, shown once, before it is saved on this device
 *
 * Progress lives in sessionStorage (wizardStore.js) so a reload mid-way
 * picks up where it was. The forms are the reusable components in
 * src/components/setup/; this page only sequences them.
 */
import {
  IonButton,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonProgressBar,
  IonRadio,
  IonRadioGroup,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { addOutline, chevronBack, trashOutline } from 'ionicons/icons'
import { computed, nextTick, onMounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'
import CommandsEditor from '@/components/setup/CommandsEditor.vue'
import CopyBlock from '@/components/setup/CopyBlock.vue'
import FavoritesPicker from '@/components/setup/FavoritesPicker.vue'
import GlancesHelp from '@/components/setup/GlancesHelp.vue'
import ServerForm from '@/components/setup/ServerForm.vue'
import ServicesEditor from '@/components/setup/ServicesEditor.vue'
import StacksForm from '@/components/setup/StacksForm.vue'
import { commandPresets, defaultCommands } from '@/components/setup/presets'
import {
  cleanUrl,
  commandErrors,
  hasErrors,
  localKey,
  nodeErrors,
  outgoingStacks,
  serviceErrors,
  slugify,
  stacksErrors,
  titleCase,
  urlOnThisHost,
} from '@/components/setup/validate'
import { clearWizard, loadWizard, saveWizard } from '@/components/setup/wizardStore'
import StatusText from '@/components/ui/StatusText.vue'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { completeSetup, fetchSetupLocal, probeGlancesForSetup, saveToken, verifySetupCode } from '@/lib/api'

const LOCAL_GLANCES = 'http://127.0.0.1:61208'
/** The name this browser reached helm at; suggested app URLs use it. */
const browserHost = location.hostname

const { confirm } = useConfirm()
const { show } = useToast()

const state = reactive(
  loadWizard() ?? {
    step: 'code',
    code: '',
    scope: null,
    /** [{ key, node, services, probe }] — the first is always this machine. */
    servers: [],
    commands: null,
    /**
     * { dir, command, template, envTemplate } once this server's engine is
     * known, else absent. Wizard state saved before the Stacks step existed
     * has no such key; ensureHere() adds it, so an old session still loads.
     */
    stacks: null,
    token: 'generate',
    /** { token } once finished, until the token has been shown and saved. */
    done: null,
  },
)
watch(state, (value) => saveWizard(value), { deep: true })

// ---------------------------------------------------------------- steps

const STEPS = {
  code: { title: 'Welcome to helm', intro: 'First, prove you’re the one who installed it.' },
  scope: { title: 'What will helm watch?', intro: 'You can add or remove machines later in Settings.' },
  server: { title: 'This server', intro: 'The machine helm is running on.' },
  services: {
    title: 'Apps on this server',
    intro: 'helm links to them and shows whether their containers are up. Check each address — it’s the one you open the app at.',
  },
  others: {
    title: 'Other servers',
    intro: 'Each needs Glances running in web-server mode. helm connects to it from this server, not from your browser.',
  },
  favorites: { title: 'Favorites', intro: 'Pinned to the top of the Machines page, one tap away.' },
  commands: { title: 'Terminal commands', intro: 'Saved commands sit above the terminal. Tapping one types it; nothing runs until you press Enter.' },
  stacks: {
    title: 'Compose stacks',
    intro: 'helm can create, edit and run compose stacks kept in one folder on this server — the same layout Dockge uses.',
  },
  token: { title: 'Access token', intro: 'Decide who can open helm.' },
  review: { title: 'Ready to go', intro: 'Check everything, then finish. All of it can be changed later in Settings.' },
  done: { title: 'helm is set up', intro: 'One last thing: save your access token.' },
}
const SKIPPABLE = new Set(['favorites', 'commands', 'stacks'])

const steps = computed(() => [
  'code',
  'scope',
  'server',
  'services',
  ...(state.scope === 'multi' ? ['others'] : []),
  'favorites',
  'commands',
  // Decided by the saved state rather than by `local`, which is refetched
  // after a reload: the step list (and with it the step number) must not
  // shift while that request is in flight.
  ...(state.stacks ? ['stacks'] : []),
  'token',
  'review',
])
const step = computed(() => (state.done ? 'done' : state.step))
const index = computed(() => steps.value.indexOf(step.value))
const progress = computed(() => (step.value === 'done' ? 1 : Math.max(index.value, 0) / (steps.value.length - 1)))
const meta = computed(() => STEPS[step.value])

/** Validation errors stay quiet until a Next has been refused on that step. */
const showErrors = shallowRef(false)
const content = useTemplateRef('content')
const heading = useTemplateRef('heading')

async function go(next) {
  state.step = next
  showErrors.value = false
  await nextTick()
  await content.value?.$el?.scrollToTop?.(200)
  heading.value?.focus({ preventScroll: true })
}

function back() {
  if (index.value > 0) go(steps.value[index.value - 1])
}

async function refuse(message) {
  showErrors.value = true
  show(message)
  await nextTick()
  document.querySelector('.setup .ion-invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// ---------------------------------------------------------------- this machine

const local = shallowRef(null)
const localState = shallowRef({ loading: false, error: null })
const alreadySetUp = shallowRef(false)

const servers = computed(() => (state.scope === 'multi' ? state.servers : state.servers.slice(0, 1)))
const here = computed(() => state.servers[0] ?? null)
const others = computed(() => state.servers.slice(1))
const engine = computed(() => local.value?.engine ?? null)

function blankServer(node = {}) {
  return { key: localKey(), node: { id: '', label: '', url: '', api: 4, ...node }, services: [], probe: null }
}

/** Make sure this machine's entry exists, filled from what the server could see. */
function ensureHere() {
  const found = local.value
  if (!state.servers.length) {
    const label = titleCase(found?.hostname?.split('.')[0]) || 'This server'
    const server = blankServer({ id: slugify(label) || 'server', label, url: LOCAL_GLANCES, api: found?.glances?.api ?? 4, local: true })
    server.probe = found?.glances ?? null
    state.servers.push(server)
  } else if (found && !state.servers[0].probe && cleanUrl(state.servers[0].node.url) === LOCAL_GLANCES) {
    state.servers[0].probe = found.glances ?? null
  }
  state.commands ??= defaultCommands(engine.value)
  // Stacks run on this machine only (Glances is read-only), so the step is
  // offered only when helm found an engine here to run compose with.
  if (state.stacks == null && engine.value && found?.stackDefaults) state.stacks = initialStacks(found)
}

/**
 * Start from the built-in defaults and the most likely folder: the first
 * found one already holding stacks, else the first found at all (Dockge's
 * /opt/stacks comes first). None found → off; the form explains how to add one.
 */
function initialStacks(found) {
  const dirs = found.stackDirs ?? []
  const dir = (dirs.find((d) => d.projects > 0) ?? dirs[0])?.path ?? null
  return { dir, command: [...(found.stackDefaults.command ?? [])], template: null, envTemplate: null }
}

async function loadLocal() {
  if (localState.value.loading) return
  localState.value = { loading: true, error: null }
  try {
    local.value = await fetchSetupLocal(state.code)
    localState.value = { loading: false, error: null }
    ensureHere()
  } catch (cause) {
    localState.value = { loading: false, error: cause.message }
    if (cause.status === 409) alreadySetUp.value = true
    else if (cause.status === 403 && state.step !== 'code') {
      codeError.value = 'That setup code is no longer accepted. Enter it again.'
      go('code')
    }
  }
}

const localSuggestions = computed(() =>
  (local.value?.containers ?? []).map((container) => {
    const ports = container.ports ?? []
    const bits = [container.image, container.status !== 'running' ? container.status : null]
    if (!ports.length) return { name: container.name, container: container.name, detail: bits.filter(Boolean).join(' · ') }
    bits.unshift(ports.length > 1 ? `ports ${ports.join(', ')}` : `port ${ports[0]}`)
    return {
      name: container.name,
      container: container.name,
      url: urlOnThisHost(ports[0]),
      detail: bits.filter(Boolean).join(' · '),
    }
  }),
)

const remoteSuggestions = (server) =>
  server.probe?.ok
    ? (server.probe.containers ?? []).map((c) => ({ name: c.name, container: c.name, detail: c.image ?? '' }))
    : []

const probe = (target) => probeGlancesForSetup(state.code, target)
const takenIds = (server) => state.servers.filter((s) => s !== server).map((s) => s.node.id)

const hereForm = useTemplateRef('hereForm')
const retrying = computed(() => !!hereForm.value?.testing)

// ---------------------------------------------------------------- code

const codeError = shallowRef(null)
const verifying = shallowRef(false)

async function submitCode() {
  const code = state.code.trim()
  if (!code) {
    codeError.value = 'Enter the setup code.'
    return
  }
  verifying.value = true
  codeError.value = null
  try {
    await verifySetupCode(code)
    state.code = code
    loadLocal()
    go('scope')
  } catch (cause) {
    if (cause.status === 409) alreadySetUp.value = true
    else if (cause.status === 429) codeError.value = 'Too many wrong codes. Wait a few minutes, then try again.'
    else if (cause.status === 403 && /origin/i.test(cause.message))
      codeError.value = `helm refused this page’s address (${location.origin}). Open it at the server’s own address.`
    else if (cause.status === 403) codeError.value = 'That code isn’t right. Check it and try again.'
    else if (cause.status === 401) codeError.value = 'This server already requires an access token (set by HELM_TOKEN).'
    else codeError.value = `Couldn’t check the code: ${cause.message}`
  } finally {
    verifying.value = false
  }
}

// ---------------------------------------------------------------- others

async function goToOthers() {
  if (state.scope === 'multi' && !others.value.length) state.servers.push(blankServer())
}

function addServer() {
  state.servers.push(blankServer())
  nextTick(() => {
    const forms = document.querySelectorAll('.setup .other-server')
    forms[forms.length - 1]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}

async function removeServer(server) {
  const name = server.node.label || 'this server'
  const apps = server.services.length
  const ok = await confirm({
    header: `Remove ${name}?`,
    message: apps ? `Its ${apps} ${apps === 1 ? 'app goes' : 'apps go'} with it.` : 'You can add it again later in Settings.',
    action: 'Remove Server',
  })
  if (ok) state.servers.splice(state.servers.indexOf(server), 1)
}

// ---------------------------------------------------------------- favorites

/** Every app across the machines in play, flat, with its node stamped from the current id. */
const allServices = computed({
  get: () => servers.value.flatMap((s) => s.services.map((service) => ({ ...service, node: s.node.id }))),
  set: (list) => {
    let i = 0
    for (const server of servers.value) {
      server.services = server.services.map((service) => ({ ...service, favorite: !!list[i++]?.favorite }))
    }
  },
})
const nodeLabels = computed(() => servers.value.map((s) => ({ id: s.node.id, label: s.node.label })))
const presets = computed(() => commandPresets(engine.value))

// ---------------------------------------------------------------- stacks

const stackDefaults = computed(() => local.value?.stackDefaults ?? null)
const stackDirs = computed(() => local.value?.stackDirs ?? [])
const stacksValid = () => !state.stacks || !hasErrors(stacksErrors(state.stacks))

// ---------------------------------------------------------------- validation

const blankService = (s) => !s.name?.trim() && !s.url?.trim() && !s.container?.trim()
const blankCommand = (c) => !c.name?.trim() && !c.command?.trim() && !c.description?.trim()

/** Entries added and never typed into don't count against Next. */
function prune(list) {
  for (const server of list) server.services = server.services.filter((s) => !blankService(s))
}

const serverValid = (server) => !hasErrors(nodeErrors(server.node, takenIds(server)))
const servicesValid = (server) => server.services.every((s) => !hasErrors(serviceErrors(s)))
const commandsValid = () => (state.commands ?? []).every((c) => !hasErrors(commandErrors(c)))

async function confirmUnreachable(list) {
  const silent = list.filter((s) => !s.probe?.ok)
  if (!silent.length) return true
  const one = silent.length === 1
  return confirm({
    header: one ? `${silent[0].node.label || 'This server'} isn’t answering` : `${silent.length} servers aren’t answering`,
    message: `helm will show ${one ? 'it' : 'them'} as offline until Glances answers. Continue anyway?`,
    action: 'Continue',
    destructive: false,
  })
}

// ---------------------------------------------------------------- next

const finishing = shallowRef(false)
const finishError = shallowRef(null)

const busy = computed(() => verifying.value || finishing.value)

async function next() {
  if (busy.value) return
  const current = step.value
  const following = steps.value[index.value + 1]

  if (current === 'code') return submitCode()
  if (current === 'scope') {
    if (!state.scope) return show('Choose one to continue')
    ensureHere()
    return go(following)
  }
  if (current === 'server') {
    if (!here.value || !serverValid(here.value)) return refuse('Fix the highlighted fields')
    if (!here.value.probe) await hereForm.value?.test()
    if (!(await confirmUnreachable([here.value]))) return
    return go(following)
  }
  if (current === 'services') {
    prune([here.value])
    if (!servicesValid(here.value)) return refuse('Each app needs a name and an http(s) address')
    if (following === 'others') await goToOthers()
    return go(following)
  }
  if (current === 'others') {
    prune(others.value)
    if (!others.value.every((s) => serverValid(s) && servicesValid(s))) return refuse('Fix the highlighted fields')
    if (!(await confirmUnreachable(others.value))) return
    return go(following)
  }
  if (current === 'commands') {
    state.commands = state.commands.filter((c) => !blankCommand(c))
    if (!commandsValid()) return refuse('Each command needs a name and something to run')
    return go(following)
  }
  if (current === 'stacks') {
    if (!stacksValid()) return refuse('Enter the stacks folder, or turn on Don’t manage stacks')
    return go(following)
  }
  if (current === 'review') return finish()
  return go(following)
}

function skip() {
  if (step.value === 'favorites') allServices.value = allServices.value.map((s) => ({ ...s, favorite: false }))
  if (step.value === 'commands') state.commands = []
  // Skipping means "not now": stacks off, everything else back to the defaults.
  if (step.value === 'stacks') {
    state.stacks = { dir: null, command: [...(stackDefaults.value?.command ?? [])], template: null, envTemplate: null }
  }
  go(steps.value[index.value + 1])
}

// ---------------------------------------------------------------- finish

function buildConfig() {
  const text = (value) => String(value ?? '').trim() || undefined
  const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
  return {
    nodes: servers.value.map(({ node }) =>
      compact({
        id: node.id,
        label: node.label.trim(),
        url: cleanUrl(node.url),
        api: node.api ?? 4,
        local: node.local === true ? true : undefined,
        username: text(node.username),
        password: node.password || undefined,
      }),
    ),
    services: servers.value.flatMap((server) =>
      server.services.map((service) =>
        compact({
          name: service.name.trim(),
          url: service.url.trim(),
          description: text(service.description),
          container: text(service.container),
          node: server.node.id,
          favorite: service.favorite === true ? true : undefined,
        }),
      ),
    ),
    commands: (state.commands ?? []).map((command) =>
      compact({ name: command.name.trim(), description: text(command.description), command: command.command.trim() }),
    ),
    // Left out entirely when there's nothing to say (no step, or off with
    // every default): the server then writes no stacks section at all.
    stacks: stacksChosen() ? outgoingStacks(state.stacks) : undefined,
  }
}

/** Whether the Stacks step changed anything from "off, all defaults". */
function stacksChosen() {
  if (!state.stacks) return false
  const out = outgoingStacks(state.stacks)
  const sameCommand = !out.command || out.command.join(' ') === (stackDefaults.value?.command ?? []).join(' ')
  return out.dir !== null || out.template !== null || out.envTemplate !== null || !sameCommand
}

/** Where to find the first invalid thing, if any step slipped through (e.g. after a reload). */
function firstInvalidStep() {
  if (!servers.value.length || !serverValid(servers.value[0])) return 'server'
  if (!servicesValid(servers.value[0])) return 'services'
  if (servers.value.slice(1).some((s) => !serverValid(s) || !servicesValid(s))) return 'others'
  if (!commandsValid()) return 'commands'
  if (!stacksValid()) return 'stacks'
  return null
}

async function finish() {
  const invalid = firstInvalidStep()
  if (invalid) {
    await go(invalid)
    return refuse('Something here needs fixing first')
  }
  finishing.value = true
  finishError.value = null
  try {
    const result = await completeSetup(state.code, buildConfig(), state.token === 'generate' ? 'generate' : null)
    if (result?.token) {
      state.done = { token: result.token }
      await nextTick()
      await content.value?.$el?.scrollToTop?.(0)
    } else {
      openHelm()
    }
  } catch (cause) {
    if (cause.status === 409) alreadySetUp.value = true
    else if (cause.status === 403 && !/origin/i.test(cause.message)) {
      codeError.value = 'The setup code was refused. Enter it again, then finish.'
      go('code')
    } else finishError.value = cause.message
  } finally {
    finishing.value = false
  }
}

function openHelm() {
  const token = state.done?.token
  clearWizard()
  if (token) saveToken(token)
  else location.replace('/machines')
}

// ---------------------------------------------------------------- review

function probeLine(server) {
  if (!server.probe) return { level: 'muted', text: 'Not tested' }
  if (!server.probe.ok) return { level: 'critical', text: 'Not answering' }
  return { level: 'good', text: server.probe.os || 'Answering' }
}

// onMounted rather than onIonViewWillEnter: nothing navigates away and back to
// this page (finishing leaves with a full reload), so it only ever enters once.
onMounted(() => {
  if (!state.done && state.step !== 'code' && state.code) loadLocal()
})
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Set up helm</ion-title>
        <!-- Toolbar slots take any element; ion-buttons is only for buttons. -->
        <ion-note v-if="step !== 'code' && step !== 'done'" slot="end" class="step-count num">
          {{ index + 1 }}/{{ steps.length }}
        </ion-note>
      </ion-toolbar>
      <ion-progress-bar :value="progress" :aria-label="`Setup progress, step ${index + 1} of ${steps.length}`" />
    </ion-header>

    <ion-content ref="content">
      <!-- The footer's Next is outside this form (ion-footer sits outside ion-content),
           so it names the form by id; see the footer. -->
      <form id="setup-form" class="setup" novalidate @submit.prevent="next">
        <header class="intro">
          <h1 ref="heading" class="page-title" tabindex="-1">{{ meta.title }}</h1>
          <p class="page-sub">{{ meta.intro }}</p>
        </header>

        <!-- Shared: the server says setup already happened (another tab, or a reload after Finish). -->
        <div v-if="alreadySetUp" class="note done-note">
          <p>helm is already set up on this server.</p>
          <ion-button size="small" @click="openHelm">Open helm</ion-button>
        </div>

        <!-- ------------------------------------------------------ code -->
        <template v-if="step === 'code'">
          <section class="section">
            <ion-list :inset="true" class="group">
              <ion-item>
                <ion-input
                  v-model="state.code"
                  label="Setup code"
                  label-placement="fixed"
                  placeholder="ABCD-EFGH"
                  autocomplete="one-time-code"
                  autocapitalize="characters"
                  :autocorrect="false"
                  :spellcheck="false"
                  :autofocus="true"
                  class="mono code-input"
                  :class="{ 'ion-invalid ion-touched': !!codeError }"
                  :error-text="codeError ?? undefined"
                  @ion-input="codeError = null"
                />
              </ion-item>
            </ion-list>
            <ion-note class="footnote">
              helm made this one-time code when it was installed. It stops working once setup is done.
            </ion-note>
          </section>

          <section class="section">
            <h2 class="section-title">Where to find it</h2>
            <!-- Each sentence is one <p>: the <li> stacks its children (flex column),
                 so bare text and an inline <span> would each become a row. -->
            <ol class="where">
              <li><p>At the end of what <span class="num">install.sh</span> printed.</p></li>
              <li>
                <p>In helm’s log:</p>
                <CopyBlock text="journalctl -u helm | grep -i setup" />
              </li>
              <li>
                <p>In the <span class="num">setup-code</span> file next to helm’s config:</p>
                <CopyBlock text="sudo cat /etc/helm/setup-code" />
              </li>
            </ol>
          </section>
        </template>

        <!-- ------------------------------------------------------ scope -->
        <section v-else-if="step === 'scope'" class="section">
          <ion-list :inset="true" class="group">
            <ion-radio-group v-model="state.scope">
              <ion-item>
                <ion-radio value="single" justify="space-between" class="choice">
                  <span class="choice-title">Just this server</span>
                  <span class="choice-sub">The machine helm is installed on: its health, containers, apps and a terminal.</span>
                </ion-radio>
              </ion-item>
              <ion-item>
                <ion-radio value="multi" justify="space-between" class="choice">
                  <span class="choice-title">This server and others</span>
                  <span class="choice-sub">Also watch other machines running Glances, on your network or tailnet.</span>
                </ion-radio>
              </ion-item>
            </ion-radio-group>
          </ion-list>
          <p v-if="localState.loading" class="looking">
            <ion-spinner name="crescent" aria-hidden="true" />Looking around this server…
          </p>
        </section>

        <!-- ------------------------------------------------------ this server -->
        <template v-else-if="step === 'server'">
          <p v-if="localState.error && !alreadySetUp" class="note">
            Couldn’t look around this server: {{ localState.error }}
            <ion-button size="small" fill="clear" @click="loadLocal">Try again</ion-button>
          </p>
          <section v-if="here" class="section">
            <ServerForm
              ref="hereForm"
              v-model="here.node"
              :probe="probe"
              :result="here.probe"
              :taken-ids="takenIds(here)"
              :show-errors="showErrors"
              @probed="here.probe = $event"
            />
            <ion-note class="footnote">
              <template v-if="local?.engine">
                Containers are managed with <span class="num">{{ local.engine }}</span>
                ({{ local.containers.length }} found).
              </template>
              The Glances address is how helm, on this machine, reaches it — usually
              <span class="num">{{ LOCAL_GLANCES }}</span>.
            </ion-note>
          </section>
          <p v-else class="looking"><ion-spinner name="crescent" aria-hidden="true" />Looking around this server…</p>

          <GlancesHelp
            v-if="here?.probe && !here.probe.ok"
            :error="here.probe.error"
            :engine="engine"
            :local-only="state.scope === 'single'"
            :busy="retrying"
            @retry="hereForm?.test()"
          />
        </template>

        <!-- ------------------------------------------------------ services -->
        <section v-else-if="step === 'services' && here" class="section">
          <ServicesEditor
            v-model="here.services"
            :node="here.node.id"
            :suggestions="localSuggestions"
            :show-errors="showErrors"
          />
          <ion-note class="footnote">
            Suggested addresses use <span class="num">{{ browserHost }}</span>, the name this browser reached helm
            at. Nothing here? That’s fine — apps can be added later.
          </ion-note>
        </section>

        <!-- ------------------------------------------------------ others -->
        <template v-else-if="step === 'others'">
          <section v-for="(server, i) in others" :key="server.key" class="section other-server">
            <div class="server-head">
              <h2 class="section-title" translate="no">{{ server.node.label || `Server ${i + 2}` }}</h2>
              <ion-button fill="clear" size="small" color="danger" @click="removeServer(server)">
                <ion-icon slot="start" :icon="trashOutline" aria-hidden="true" />Remove
              </ion-button>
            </div>
            <ServerForm
              v-model="server.node"
              :probe="probe"
              :result="server.probe"
              :taken-ids="takenIds(server)"
              :show-errors="showErrors"
              @probed="server.probe = $event"
            />
            <h3 class="sub-title">Apps on {{ server.node.label || 'this server' }}</h3>
            <ServicesEditor
              v-model="server.services"
              :node="server.node.id"
              :suggestions="remoteSuggestions(server)"
              :show-errors="showErrors"
            />
            <ion-note v-if="!server.probe?.ok" class="footnote">
              Test the connection and helm will offer this server’s containers to pick from.
            </ion-note>
          </section>
          <p v-if="!others.length" class="note">
            No other servers yet. Add one, or go back and choose “Just this server”.
          </p>
          <div>
            <ion-button fill="outline" @click="addServer">
              <ion-icon slot="start" :icon="addOutline" aria-hidden="true" />Add a server
            </ion-button>
          </div>
        </template>

        <!-- ------------------------------------------------------ favorites -->
        <section v-else-if="step === 'favorites'" class="section">
          <FavoritesPicker v-model="allServices" :nodes="nodeLabels" />
        </section>

        <!-- ------------------------------------------------------ commands -->
        <section v-else-if="step === 'commands' && state.commands" class="section">
          <CommandsEditor v-model="state.commands" :presets="presets" :show-errors="showErrors" />
        </section>

        <!-- ------------------------------------------------------ stacks -->
        <template v-else-if="step === 'stacks' && state.stacks">
          <section v-if="stackDefaults" class="section">
            <StacksForm v-model="state.stacks" :defaults="stackDefaults" :dirs="stackDirs" :show-errors="showErrors" />
            <ion-note class="footnote">
              Optional, and all of it can be changed later in Settings. The folder must already exist on this server.
            </ion-note>
          </section>
          <p v-else-if="localState.error && !alreadySetUp" class="note">
            Couldn’t look around this server: {{ localState.error }}
            <ion-button size="small" fill="clear" @click="loadLocal">Try again</ion-button>
          </p>
          <p v-else class="looking"><ion-spinner name="crescent" aria-hidden="true" />Looking around this server…</p>
        </template>

        <!-- ------------------------------------------------------ token -->
        <template v-else-if="step === 'token'">
          <p class="note">
            helm’s terminal is a full shell on this machine, running as the user helm runs as. Anyone who can open helm
            can use it. With a token, a device has to know it before helm answers at all.
          </p>
          <section class="section">
            <ion-list :inset="true" class="group">
              <ion-radio-group v-model="state.token">
                <ion-item>
                  <ion-radio value="generate" justify="space-between" class="choice">
                    <span class="choice-title">Generate a token (recommended)</span>
                    <span class="choice-sub">
                      Shown once when you finish and saved on this device. Other devices enter it in Settings.
                    </span>
                  </ion-radio>
                </ion-item>
                <ion-item>
                  <ion-radio value="none" justify="space-between" class="choice">
                    <span class="choice-title">No token</span>
                    <span class="choice-sub">
                      Anyone who can reach this address gets the terminal. Only if helm is reachable by you alone,
                      such as on a private tailnet.
                    </span>
                  </ion-radio>
                </ion-item>
              </ion-radio-group>
            </ion-list>
          </section>
        </template>

        <!-- ------------------------------------------------------ review -->
        <template v-else-if="step === 'review'">
          <section class="section">
            <div class="review-head">
              <h2 class="section-title">
                Machines <span class="count">{{ servers.length }}</span>
              </h2>
              <ion-button fill="clear" size="small" @click="go('server')">Edit</ion-button>
            </div>
            <!-- Labels in an item wrap by default (Ionic 8+), and a URL breaks at
                 its slashes; .ion-text-nowrap truncates each line with an ellipsis
                 instead. The status is a line of its own rather than slot="end",
                 where a long OS name squeezed the label. -->
            <ion-list :inset="true" class="group">
              <ion-item v-for="server in servers" :key="server.key">
                <ion-label class="ion-text-nowrap">
                  <h3 translate="no">{{ server.node.label }}<span v-if="server.node.local" class="tag">this server</span></h3>
                  <p class="num" translate="no">{{ cleanUrl(server.node.url) }}</p>
                  <p><StatusText :level="probeLine(server).level">{{ probeLine(server).text }}</StatusText></p>
                </ion-label>
              </ion-item>
            </ion-list>
          </section>

          <section class="section">
            <div class="review-head">
              <h2 class="section-title">
                Apps <span class="count">{{ allServices.length }}</span>
              </h2>
              <ion-button fill="clear" size="small" @click="go('services')">Edit</ion-button>
            </div>
            <ion-list v-if="allServices.length" :inset="true" class="group">
              <ion-item v-for="(service, i) in allServices" :key="i">
                <ion-label class="ion-text-nowrap">
                  <h3>{{ service.name }}</h3>
                  <p class="num" translate="no">{{ service.url }}</p>
                </ion-label>
                <ion-note v-if="service.favorite" slot="end">Favorite</ion-note>
              </ion-item>
            </ion-list>
            <ion-note v-else class="footnote">None yet.</ion-note>
          </section>

          <section class="section">
            <div class="review-head">
              <h2 class="section-title">
                Terminal commands <span class="count">{{ state.commands?.length ?? 0 }}</span>
              </h2>
              <ion-button fill="clear" size="small" @click="go('commands')">Edit</ion-button>
            </div>
            <ion-note class="footnote">
              {{ state.commands?.length ? state.commands.map((c) => c.name).join(', ') : 'None.' }}
            </ion-note>
          </section>

          <section v-if="state.stacks" class="section">
            <div class="review-head">
              <h2 class="section-title">Compose stacks</h2>
              <ion-button fill="clear" size="small" @click="go('stacks')">Edit</ion-button>
            </div>
            <ion-note class="footnote">
              <template v-if="state.stacks.dir">
                <span class="num" translate="no">{{ state.stacks.dir.trim() }}</span> ·
                {{ state.stacks.template || state.stacks.envTemplate ? 'your own templates' : 'helm’s default templates' }}
              </template>
              <template v-else>Off.</template>
            </ion-note>
          </section>

          <section class="section">
            <div class="review-head">
              <h2 class="section-title">Access</h2>
              <ion-button fill="clear" size="small" @click="go('token')">Edit</ion-button>
            </div>
            <ion-note class="footnote">
              {{ state.token === 'generate' ? 'A new access token, shown once when you finish.' : 'No token — anyone who can reach helm can use it.' }}
            </ion-note>
          </section>

          <p v-if="finishError" class="note error" role="alert">Couldn’t finish: {{ finishError }}</p>
        </template>

        <!-- ------------------------------------------------------ done -->
        <template v-else-if="step === 'done'">
          <section class="section">
            <CopyBlock :text="state.done.token" label="Access token" secret />
            <ion-note class="footnote">
              This is the only time it’s shown. Keep it in your password manager. This device saves it when you open
              helm; on any other device, open helm, go to Settings and enter it there.
            </ion-note>
          </section>
        </template>
      </form>
    </ion-content>

    <ion-footer>
      <ion-toolbar>
        <div class="nav">
          <ion-button v-if="index > 0 && step !== 'done'" fill="clear" :disabled="busy" @click="back">
            <ion-icon slot="start" :icon="chevronBack" aria-hidden="true" />Back
          </ion-button>
          <span class="spacer" />
          <ion-button v-if="SKIPPABLE.has(step)" fill="clear" @click="skip">Skip</ion-button>
          <!-- Keys keep Vue from patching one ion-button into the other (and
               carrying type="submit" over). type="submit" + form: Ionic renders a
               hidden native submit button inside #setup-form, so Enter in any
               field submits the step, and a tap submits it too — no @click. -->
          <ion-button v-if="step === 'done'" key="open" @click="openHelm">Open helm</ion-button>
          <ion-button v-else key="next" type="submit" form="setup-form" :disabled="busy || alreadySetUp">
            <ion-spinner v-if="busy" slot="start" name="crescent" aria-hidden="true" />
            {{ step === 'review' ? (finishing ? 'Finishing…' : 'Finish setup') : step === 'code' && verifying ? 'Checking…' : 'Next' }}
          </ion-button>
        </div>
      </ion-toolbar>
    </ion-footer>
  </ion-page>
</template>

<style scoped>
.setup {
  max-width: 640px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
@media (min-width: 768px) {
  .setup {
    padding: 36px 32px 56px;
  }
}
.intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.intro h1:focus {
  outline: none;
}
.step-count {
  padding-inline: 12px;
  font-size: 0.8125rem;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.section .section-title {
  margin-bottom: 0;
}
.group {
  margin: 0;
}
.footnote {
  display: block;
  padding-inline: 16px;
  font-size: 0.8125rem;
  line-height: 1.45;
}
/* ion-input is scoped, not shadow DOM, and has no part or variable for the
   value's font alone (font-family on the host would set the label too), so
   the value is reached through .native-input, the class Ionic styles itself. */
.mono :deep(.native-input) {
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
}
.code-input :deep(.native-input) {
  text-transform: uppercase;
  font-size: 1.0625rem;
}
.where {
  list-style: decimal;
  padding-inline-start: 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 0.875rem;
  color: var(--color-ink-2);
}
.where li {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.where li::marker {
  color: var(--color-muted);
}
/* ion-radio's label is nowrap + ellipsis inside its shadow root, and it has no
   helper-text prop, so a two-line choice styles the documented `label` part.
   (.ion-text-wrap on the host doesn't reach it: the shadow rule sets nowrap
   on the wrapper itself rather than inheriting it.) */
.choice::part(label) {
  white-space: normal;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-block: 6px;
}
.choice-title {
  font-weight: 700;
  font-size: 1rem;
}
.choice-sub {
  font-size: 0.8438rem;
  color: var(--color-muted);
  line-height: 1.4;
}
.looking {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8438rem;
  color: var(--color-muted);
  padding-inline: 16px;
}
.looking ion-spinner,
.nav ion-spinner {
  width: 16px;
  height: 16px;
}
.server-head,
.review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.server-head ion-button,
.review-head ion-button {
  margin: 0;
}
.other-server + .other-server {
  border-top: 1px solid var(--color-hairline);
  padding-top: 24px;
}
.sub-title {
  font-size: 0.9375rem;
  font-weight: 700;
  margin-top: 8px;
}
.tag {
  margin-inline-start: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-muted);
}
.error {
  color: var(--color-critical);
}
.done-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.done-note ion-button {
  margin: 0;
}
.nav {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 640px;
  margin: 0 auto;
  padding-inline: 8px;
}
.nav .spacer {
  flex: 1;
}
.nav ion-button {
  margin: 0;
}
</style>
