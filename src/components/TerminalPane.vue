<script setup>
/**
 * PTY terminal.
 *
 * xterm is by far the heaviest thing this app ships, so it is imported
 * dynamically: the dashboard paints without it, and the cost is paid only if
 * you actually open the terminal. The WebSocket is likewise opened on demand
 * and torn down on unmount, so a closed terminal holds no PTY on the server.
 */
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ptyUrl } from '@/lib/api'

const props = defineProps({
  commands: { type: Array, default: () => [] },
  /**
   * The pane keeps us mounted once opened, so the shell session survives tab
   * switches; `active` only says whether we are currently the visible tab.
   */
  active: { type: Boolean, default: true },
})

const host = ref(null)
const status = ref('idle') // idle | connecting | open | closed | error
const detail = ref(null)
const showCommands = ref(false)

function toggleCommands() {
  showCommands.value = !showCommands.value
}

/**
 * On-screen keys.
 *
 * A phone keyboard has no Ctrl, no Esc, no Tab and no arrows, which makes a
 * terminal close to unusable — you cannot even interrupt a command. These send
 * the raw bytes a real keyboard would.
 */
const KEYS = [
  { label: 'Esc', seq: '\x1b', title: 'Escape' },
  { label: 'Tab', seq: '\t', title: 'Tab — completion' },
  { label: '^C', seq: '\x03', title: 'Ctrl+C — interrupt', accent: true },
  { label: '^Z', seq: '\x1a', title: 'Ctrl+Z — suspend' },
  { label: '^D', seq: '\x04', title: 'Ctrl+D — end of input' },
  { label: '^L', seq: '\x0c', title: 'Ctrl+L — clear screen' },
  { label: '↑', seq: '\x1b[A', title: 'Previous command' },
  { label: '↓', seq: '\x1b[B', title: 'Next command' },
  { label: '←', seq: '\x1b[D', title: 'Left' },
  { label: '→', seq: '\x1b[C', title: 'Right' },
  { label: 'Home', seq: '\x1b[H', title: 'Start of line' },
  { label: 'End', seq: '\x1b[F', title: 'End of line' },
  { label: '|', seq: '|', title: 'Pipe' },
  { label: '~', seq: '~', title: 'Home directory' },
  { label: '/', seq: '/', title: 'Slash' },
  { label: '-', seq: '-', title: 'Dash' },
]

/** Sticky Ctrl: tap it, then the next key becomes Ctrl+<key>. */
const ctrlActive = ref(false)

function applyStickyCtrl(data) {
  if (!ctrlActive.value) return data
  ctrlActive.value = false
  if (data.length !== 1) return data
  if (data === ' ') return '\x00'
  const code = data.toUpperCase().charCodeAt(0)
  // @ (64) .. _ (95) are the characters Ctrl maps down into 0x00-0x1f.
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data
}

function sendKey(seq) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(encoder.encode(seq))
  ctrlActive.value = false
  term.value?.focus()
}

/**
 * The key bar defaults on for touch pointers, where the on-screen keyboard has
 * no Ctrl/Esc/Tab/arrows — but it stays a toggle, so a wrong guess about the
 * device never leaves someone unable to interrupt a command.
 */
const touch = window.matchMedia('(pointer: coarse)')
const storedKeys = localStorage.getItem('tools.keys')
const keysOpen = ref(storedKeys ? storedKeys === 'on' : touch.matches)
touch.addEventListener('change', (event) => {
  if (!localStorage.getItem('tools.keys')) keysOpen.value = event.matches
})
function toggleKeys() {
  keysOpen.value = !keysOpen.value
  localStorage.setItem('tools.keys', keysOpen.value ? 'on' : 'off')
  nextTick(() => {
    try {
      fit.value?.fit()
    } catch {}
  })
}

function clear() {
  term.value?.clear()
}

/** The pane header renders the chrome, so it drives us from out here. */
defineExpose({ status, detail, keysOpen, toggleKeys, toggleCommands, clear, reconnect: () => reconnect() })


const term = shallowRef(null)
const fit = shallowRef(null)
let socket = null
let observer = null
let retry = null
let attempts = 0
let disposed = false

const encoder = new TextEncoder()

const THEME = {
  background: '#0d0d0d',
  foreground: '#c3c2b7',
  cursor: '#3987e5',
  cursorAccent: '#0d0d0d',
  selectionBackground: 'rgba(57,135,229,0.30)',
  black: '#141414',
  red: '#d03b3b',
  green: '#0ca30c',
  yellow: '#fab219',
  blue: '#3987e5',
  magenta: '#d55181',
  cyan: '#199e70',
  white: '#c3c2b7',
  brightBlack: '#898781',
  brightRed: '#e66767',
  brightGreen: '#1baf7a',
  brightYellow: '#c98500',
  brightBlue: '#6da7ec',
  brightMagenta: '#e87ba4',
  brightCyan: '#199e70',
  brightWhite: '#ffffff',
}

function sendResize() {
  if (socket?.readyState !== WebSocket.OPEN || !term.value) return
  socket.send(JSON.stringify({ type: 'resize', cols: term.value.cols, rows: term.value.rows }))
}

function connect() {
  if (disposed || !term.value) return
  status.value = 'connecting'
  detail.value = null

  socket = new WebSocket(ptyUrl())
  socket.binaryType = 'arraybuffer'

  socket.onopen = () => {
    attempts = 0
    status.value = 'open'
    sendResize()
    term.value.focus()
  }
  socket.onmessage = (event) => term.value?.write(new Uint8Array(event.data))
  socket.onerror = () => {
    detail.value = 'connection failed'
  }
  socket.onclose = () => {
    if (disposed) return
    status.value = 'closed'
    term.value?.writeln('\r\n\x1b[38;5;244m[disconnected]\x1b[0m')
    // Back off rather than hammering a server that is restarting.
    attempts += 1
    if (attempts <= 5) {
      const delay = Math.min(1000 * 2 ** (attempts - 1), 15000)
      detail.value = `reconnecting in ${Math.round(delay / 1000)}s`
      retry = setTimeout(connect, delay)
    } else {
      detail.value = 'gave up — reconnect manually'
    }
  }
}

async function boot() {
  if (term.value) return
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ])
  await import('@xterm/xterm/css/xterm.css')
  if (disposed) return

  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.2,
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
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(encoder.encode(applyStickyCtrl(data)))
    }
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

  observer = new ResizeObserver(() => {
    try {
      fitAddon.fit()
    } catch {}
  })
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

function run(command) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(encoder.encode(`${command}\n`))
  showCommands.value = false
  term.value?.focus()
}

/** Puts the command on the prompt without running it — the escape hatch for
 *  anything destructive enough that you want to read it first. */
function stage(command) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(encoder.encode(command))
  showCommands.value = false
  term.value?.focus()
}

watch(
  () => props.active,
  (active) => {
    if (!active) return
    boot()
    // A hidden pane has no size, so xterm needs a nudge when it reappears.
    nextTick(() => {
      try {
        fit.value?.fit()
      } catch {}
    })
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
  <div class="flex min-h-0 flex-1 flex-col bg-sunken">
    <div
      v-if="showCommands && commands.length"
      class="max-h-56 shrink-0 overflow-y-auto border-b border-hairline bg-surface"
    >
      <div
        v-for="command in commands"
        :key="command.name"
        class="flex items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0 hover:bg-raised"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate font-mono text-[12px] text-ink">{{ command.name }}</div>
          <div class="truncate text-[11px] text-muted">{{ command.description }}</div>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 hover:bg-sunken hover:text-ink"
          title="Type it at the prompt without pressing enter"
          @click="stage(command.command)"
        >
          Stage
        </button>
        <button
          type="button"
          class="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-plane"
          style="background: var(--color-series-1)"
          @click="run(command.command)"
        >
          Run
        </button>
      </div>
    </div>

    <!-- Touch key bar. mousedown/touchstart are prevented so tapping a key
         never blurs the terminal — on a phone that would dismiss the keyboard
         between every keystroke. -->
    <div
      v-if="keysOpen"
      class="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline bg-surface px-2 py-1.5"
      @mousedown.prevent
      @touchstart.prevent
    >
      <button
        type="button"
        class="shrink-0 rounded-md border px-2.5 py-1.5 font-mono text-[12px] transition-colors"
        :class="
          ctrlActive
            ? 'border-transparent bg-[var(--color-series-1)] font-semibold text-plane'
            : 'border-hairline text-ink-2 hover:bg-raised hover:text-ink'
        "
        title="Ctrl — then tap a letter"
        @click="ctrlActive = !ctrlActive"
      >
        Ctrl
      </button>

      <button
        v-for="key in KEYS"
        :key="key.label"
        type="button"
        class="shrink-0 rounded-md border border-hairline px-2.5 py-1.5 font-mono text-[12px] transition-colors hover:bg-raised hover:text-ink"
        :class="key.accent ? 'text-[var(--color-critical)]' : 'text-ink-2'"
        :title="key.title"
        @click="sendKey(key.seq)"
      >
        {{ key.label }}
      </button>
    </div>

    <div ref="host" class="min-h-0 flex-1 overflow-hidden px-2 py-2" />
  </div>
</template>
