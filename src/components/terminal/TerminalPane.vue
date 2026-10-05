<script setup>
/**
 * PTY terminal.
 *
 * xterm is by far the heaviest thing this app ships, so it is imported
 * dynamically: the rest of the app paints without it, and the cost is paid only
 * if you open the terminal. The WebSocket is likewise opened on demand and torn
 * down on unmount, so a closed terminal holds no PTY on the server.
 */
import { nextTick, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import { ptyUrl } from '@/lib/api'
import { markReached } from '@/lib/connection'

const props = defineProps({
  commands: { type: Array, default: () => [] },
  /** Kept mounted once opened so the shell survives page switches; this says whether it's on screen. */
  active: { type: Boolean, default: true },
})

const emit = defineEmits(['status'])

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
  { label: '↑', seq: '\x1b[A', title: 'Previous command' },
  { label: '↓', seq: '\x1b[B', title: 'Next command' },
  { label: '←', seq: '\x1b[D', title: 'Left' },
  { label: '→', seq: '\x1b[C', title: 'Right' },
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

/** Smaller text on a phone so FitAddon gets enough columns for real output. */
const fontSize = () => (window.innerWidth < 600 ? 11.5 : 13)

function sendResize() {
  if (socket?.readyState !== WebSocket.OPEN || !term.value) return
  socket.send(JSON.stringify({ type: 'resize', cols: term.value.cols, rows: term.value.rows }))
}

function refit() {
  if (!term.value) return
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

defineExpose({ reconnect })

watch(
  () => props.active,
  (active) => {
    if (!active) return
    boot()
    // A hidden page has no size, so xterm needs a nudge when it reappears.
    nextTick(refit)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(retry)
  observer?.disconnect()
  try {
    socket?.close()
  } catch {}
  term.value?.dispose()
})
</script>

<template>
  <div class="pane">
    <div ref="host" class="screen" />

    <!-- mousedown/touchstart are prevented so tapping a key never blurs the
         terminal — on a phone that would dismiss the keyboard every keystroke. -->
    <div class="keys" aria-label="Extra keys" @mousedown.prevent @touchstart.prevent>
      <button
        v-for="key in KEYS"
        :key="key.label"
        type="button"
        :title="key.title"
        :aria-pressed="key.ctrl ? ctrlActive : undefined"
        :class="{ danger: key.danger, on: key.ctrl && ctrlActive }"
        @click="press(key)"
      >
        {{ key.label }}
      </button>
    </div>

    <div v-if="commands.length" class="saved">
      <span class="saved-label">Saved commands. Tap one to type it, then press Enter.</span>
      <div class="saved-list" @mousedown.prevent>
        <button
          v-for="command in commands"
          :key="command.name"
          type="button"
          class="chip"
          :title="command.description || command.command"
          @click="stage(command.command)"
        >
          {{ command.name }}
        </button>
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
}
.keys {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
  padding-top: 8px;
}
.keys button {
  border: 1px solid var(--color-hairline);
  background: var(--color-surface);
  border-radius: 8px;
  padding: 9px 0;
  font-family: var(--font-mono);
  font-size: 12px;
  min-width: 0;
  color: var(--color-ink);
}
.keys button:active {
  transform: translateY(1px);
}
.keys .danger {
  color: var(--color-critical);
}
.keys .on {
  background: var(--color-ink);
  color: var(--color-plane);
  border-color: var(--color-ink);
}
.saved {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
}
.saved-label {
  font-size: 13px;
  color: var(--color-muted);
}
.saved-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* A real keyboard has all of these. */
@media (pointer: fine) and (min-width: 768px) {
  .keys {
    display: none;
  }
}
</style>
