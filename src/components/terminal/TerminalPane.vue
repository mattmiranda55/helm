<script setup>
/**
 * PTY terminal.
 *
 * xterm is by far the heaviest thing this app ships, so it is imported
 * dynamically: the rest of the app paints without it, and the cost is paid only
 * if you open the terminal. The WebSocket is likewise opened on demand and torn
 * down on unmount, so a closed terminal holds no PTY on the server.
 *
 * Ionic page lifecycle hooks only reach the routed page, so TerminalPage owns
 * them and drives this through `active` and the exposed refit/focus/blur.
 */
import { IonButton, IonIcon } from '@ionic/vue'
import { arrowBack, arrowDown, arrowForward, arrowUp } from 'ionicons/icons'
import { nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { ptyUrl } from '@/lib/api'
import { markReached } from '@/lib/connection'

const props = defineProps({
  commands: { type: Array, default: () => [] },
  /** The page stays mounted after you leave its tab so the shell survives; this says whether it's on screen. */
  active: { type: Boolean, default: true },
})

const emit = defineEmits(['status'])

const root = useTemplateRef('root')
const host = useTemplateRef('host')
const status = shallowRef('idle') // idle | connecting | open | closed | error
const detail = shallowRef(null)
watch([status, detail], () => emit('status', { status: status.value, detail: detail.value }), { immediate: true })

/**
 * On-screen keys, for phone keyboards that have no Ctrl, Esc, Tab or arrows —
 * without them you cannot even interrupt a command. Ten across so the row fits
 * the screen width instead of scrolling.
 */
const KEYS = [
  { label: 'Esc', seq: '\x1b', title: 'Escape' },
  { label: 'Tab', seq: '\t', title: 'Tab (completion)' },
  { label: 'Ctrl', ctrl: true, title: 'Ctrl, then tap a letter' },
  { label: '^C', seq: '\x03', title: 'Ctrl+C (interrupt)', danger: true },
  { label: 'Up', icon: arrowUp, seq: '\x1b[A', title: 'Previous command' },
  { label: 'Down', icon: arrowDown, seq: '\x1b[B', title: 'Next command' },
  { label: 'Left', icon: arrowBack, seq: '\x1b[D', title: 'Left' },
  { label: 'Right', icon: arrowForward, seq: '\x1b[C', title: 'Right' },
  { label: '|', seq: '|', title: 'Pipe' },
  { label: '~', seq: '~', title: 'Home directory' },
]

/** Sticky Ctrl: tap it, then the next key becomes Ctrl+<key>. */
const ctrlActive = shallowRef(false)

function applyStickyCtrl(data) {
  if (!ctrlActive.value) return data
  ctrlActive.value = false
  if (data.length !== 1) return data
  if (data === ' ') return '\x00'
  const code = data.toUpperCase().charCodeAt(0)
  // @ (64) .. _ (95) are the characters Ctrl maps down into 0x00-0x1f.
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data
}

const term = shallowRef(null)
const fit = shallowRef(null)
let socket = null
let observer = null
let retry = null
let attempts = 0
let disposed = false

const encoder = new TextEncoder()

function press(key) {
  if (key.ctrl) {
    ctrlActive.value = !ctrlActive.value
    term.value?.focus()
    return
  }
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(encoder.encode(key.seq))
  ctrlActive.value = false
  term.value?.focus()
}

/** Types a saved command at the prompt without pressing Enter, so you read it first. */
function stage(command) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(encoder.encode(command))
  term.value?.focus()
}

/** Matches the app's tokens; the terminal is dark in both themes. */
const THEME = {
  background: '#15181b',
  foreground: '#dfe3e6',
  cursor: '#3987e5',
  cursorAccent: '#15181b',
  selectionBackground: 'rgba(57,135,229,0.30)',
  black: '#22272c',
  red: '#e05252',
  green: '#2bb32b',
  yellow: '#fab219',
  blue: '#3987e5',
  magenta: '#d55181',
  cyan: '#199e70',
  white: '#dfe3e6',
  brightBlack: '#8a929a',
  brightRed: '#ec8080',
  brightGreen: '#5fcf5f',
  brightYellow: '#ffd166',
  brightBlue: '#6da7ec',
  brightMagenta: '#e87ba4',
  brightCyan: '#3fbf92',
  brightWhite: '#ffffff',
}

/**
 * Smaller text on a phone so FitAddon gets enough columns for real output.
 * xterm takes pixels, so the size is scaled by the root font size: with
 * typography.css, 1rem follows the iPhone's text-size setting (Dynamic Font
 * Scaling), and the terminal should grow and shrink with the rest of helm.
 */
const fontSize = () => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return ((window.innerWidth < 600 ? 11.5 : 13) * rem) / 16
}

function sendResize() {
  if (socket?.readyState !== WebSocket.OPEN || !term.value) return
  socket.send(JSON.stringify({ type: 'resize', cols: term.value.cols, rows: term.value.rows }))
}

function refit() {
  // A hidden page (Ionic sets display: none on a tab you left) has no size;
  // fitting it would shrink the PTY to nothing.
  if (!term.value || !host.value?.clientWidth) return
  const size = fontSize()
  if (term.value.options.fontSize !== size) term.value.options.fontSize = size
  try {
    fit.value?.fit()
  } catch {}
}

function connect() {
  if (disposed || !term.value) return
  status.value = 'connecting'
  detail.value = null

  socket = new WebSocket(ptyUrl())
  socket.binaryType = 'arraybuffer'

  socket.onopen = () => {
    markReached()
    attempts = 0
    status.value = 'open'
    sendResize()
    term.value.focus()
  }
  socket.onmessage = (event) => term.value?.write(new Uint8Array(event.data))
  socket.onerror = () => {
    detail.value = 'Connection failed'
  }
  socket.onclose = () => {
    if (disposed) return
    status.value = 'closed'
    term.value?.writeln('\r\n\x1b[38;5;244m[disconnected]\x1b[0m')
    // Back off rather than hammering a server that is restarting.
    attempts += 1
    if (attempts <= 5) {
      const delay = Math.min(1000 * 2 ** (attempts - 1), 15000)
      detail.value = `Reconnecting in ${Math.round(delay / 1000)}s`
      retry = setTimeout(connect, delay)
    } else {
      detail.value = 'Gave up reconnecting'
    }
  }
}

async function boot() {
  if (term.value) return
  const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
  await import('@xterm/xterm/css/xterm.css')
  // xterm measures the cell size once, at open — the face has to be loaded first.
  await Promise.all([document.fonts.load('13px "Space Mono"'), document.fonts.load('bold 13px "Space Mono"')]).catch(() => {})
  if (disposed) return

  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: fontSize(),
    lineHeight: 1.25,
    // The PTY is the source of truth for history; a huge buffer is just RAM.
    scrollback: 2000,
    theme: THEME,
    allowProposedApi: true,
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  await nextTick()
  terminal.open(host.value)
  fitAddon.fit()

  terminal.onData((data) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(encoder.encode(applyStickyCtrl(data)))
  })
  terminal.onResize(sendResize)

  // iOS will happily autocapitalize and autocorrect into the terminal, turning
  // `ls` into `Ls`. xterm's hidden input has to be told not to.
  const input = host.value?.querySelector('.xterm-helper-textarea')
  if (input) {
    input.setAttribute('autocapitalize', 'none')
    input.setAttribute('autocorrect', 'off')
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('spellcheck', 'false')
  }

  term.value = terminal
  fit.value = fitAddon

  observer = new ResizeObserver(refit)
  observer.observe(host.value)

  connect()
}

function reconnect() {
  clearTimeout(retry)
  attempts = 0
  try {
    socket?.close()
  } catch {}
  connect()
}

/**
 * The on-screen keyboard. Safari — a home-screen install included — doesn't
 * resize the page for it: the keyboard slides over the layout and only the
 * visual viewport shrinks. Ionic's keyboard handling (scroll assist,
 * --keyboard-offset) is for ion-input and ion-textarea; xterm's own textarea
 * gets none of it. So the pane measures how much of itself is hidden below the
 * visual viewport and pads its bottom by that much — the screen shrinks, the
 * ResizeObserver refits xterm to fewer rows (and tells the PTY), and the extra
 * keys sit right on top of the keyboard. Where the viewport does resize for the
 * keyboard (Android Chrome with resizes-content) the pane itself shrinks and
 * the overlap is zero.
 */
const keyboardInset = shallowRef(0)
/** Always leave the key row and a couple of lines, even on a phone in landscape. */
const MIN_PANE = 96
let insetFrame = 0

function measureInset() {
  insetFrame = 0
  const viewport = window.visualViewport
  if (!props.active || !viewport || !root.value) return
  const rect = root.value.getBoundingClientRect()
  if (!rect.height) return
  // Client rects are relative to the layout viewport; when Safari pans the
  // visual viewport up to reveal the cursor, offsetTop says by how much.
  const overlap = rect.bottom - (viewport.offsetTop + viewport.height)
  keyboardInset.value = overlap < 2 ? 0 : Math.round(Math.max(0, Math.min(overlap, rect.height - MIN_PANE)))
}

function scheduleInset() {
  if (!insetFrame) insetFrame = requestAnimationFrame(measureInset)
}

onMounted(() => {
  window.visualViewport?.addEventListener('resize', scheduleInset)
  // Safari pans the visual viewport (rather than resizing it) to keep the cursor in view.
  window.visualViewport?.addEventListener('scroll', scheduleInset)
})

function focus() {
  term.value?.focus()
}

function blur() {
  term.value?.blur()
}

defineExpose({ reconnect, refit, focus, blur })

watch(
  () => props.active,
  (active) => {
    if (!active) {
      // Leaving the tab: don't leave the keyboard up for a hidden textarea.
      blur()
      keyboardInset.value = 0
      return
    }
    boot()
    // A hidden page has no size, so xterm needs a nudge when it reappears.
    nextTick(() => {
      refit()
      measureInset()
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(retry)
  cancelAnimationFrame(insetFrame)
  window.visualViewport?.removeEventListener('resize', scheduleInset)
  window.visualViewport?.removeEventListener('scroll', scheduleInset)
  observer?.disconnect()
  try {
    socket?.close()
  } catch {}
  term.value?.dispose()
})
</script>

<template>
  <div ref="root" class="pane" :style="keyboardInset ? { paddingBottom: `${keyboardInset}px` } : undefined">
    <div ref="host" class="screen" />

    <!-- mousedown is prevented so tapping a key never moves focus off the
         terminal — on a phone that would dismiss the keyboard every keystroke.
         (Not touchstart: preventing that also cancels the tap's click on iOS.)
         ion-button's native <button> is in its shadow root, but mousedown is
         composed, so it bubbles out to here. The press itself is the click, so
         Ionic's activated state still shows, and press() hands focus back to
         xterm anyway. aria-label/aria-pressed set on ion-button are copied onto
         that inner <button>, where assistive tech reads them. -->
    <div class="keys" aria-label="Extra keys" @mousedown.prevent>
      <ion-button
        v-for="key in KEYS"
        :key="key.label"
        size="small"
        :fill="key.ctrl && ctrlActive ? 'solid' : 'outline'"
        :color="key.danger ? 'danger' : 'primary'"
        :title="key.title"
        :aria-label="key.icon ? key.title : undefined"
        :aria-pressed="key.ctrl ? String(ctrlActive) : undefined"
        @click="press(key)"
      >
        <ion-icon v-if="key.icon" slot="icon-only" :icon="key.icon" />
        <template v-else>{{ key.label }}</template>
      </ion-button>
    </div>

    <div v-if="commands.length" class="saved">
      <span class="saved-label">Saved commands. Tap one to type it, then press Enter.</span>
      <!-- Round ion-buttons rather than ion-chips: a chip is a display element
           (not focusable, no button semantics), and these are actions. -->
      <div class="saved-list" @mousedown.prevent>
        <ion-button
          v-for="command in commands"
          :key="command.name"
          size="small"
          shape="round"
          fill="outline"
          :title="command.description || command.command"
          @click="stage(command.command)"
        >
          {{ command.name }}
        </ion-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.screen {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--color-term);
  border-radius: var(--radius-row);
  padding: 10px 6px 6px 10px;
  /* Undo what Ionic's structure.css puts on every element and the body, so
     xterm renders and measures its cells as it would on a plain page and iOS
     still offers its long-press menu (Paste) on the terminal. */
  text-rendering: auto;
  overflow-wrap: normal;
  -webkit-touch-callout: default;
}
.screen :deep(*) {
  -webkit-touch-callout: default;
}
.keys {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
  padding-top: 8px;
  /* Quick taps on the keys should be keystrokes, not a double-tap zoom. */
  touch-action: manipulation;
}
/* Only what the ten-across grid needs: no outer margin, no minimum padding. */
.keys ion-button {
  margin: 0;
  min-width: 0;
  height: 34px;
  --padding-start: 0;
  --padding-end: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}
.saved {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
}
.saved-label {
  font-size: 0.8125rem;
  color: var(--color-muted);
}
.saved-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.saved-list ion-button {
  margin: 0;
}

/* A real keyboard has all of these. */
@media (pointer: fine) and (min-width: 768px) {
  .keys {
    display: none;
  }
}
</style>
