import { onScopeDispose, readonly, ref, shallowRef, toValue, watch } from 'vue'
import {
  createStack,
  deleteStack,
  fetchStackFiles,
  fetchStacks,
  saveStackFiles,
  stackAction,
  stackStreamUrl,
} from '@/lib/api'

/**
 * Compose stacks on the machine helm runs on. Only active while `enabled` is
 * true (the selected machine is local and stacks are configured).
 *
 * up/down/restart start a job on the server that outlives this page; its
 * output is followed over a WebSocket while the stack's sheet is open.
 */
export function useStacks(enabled) {
  const stacks = shallowRef([])
  const error = shallowRef(null)
  const busy = shallowRef(null) // stack name with a job running
  const output = ref(null) // { name, lines: [], done }

  let socket = null
  let timer = null

  async function load() {
    try {
      stacks.value = await fetchStacks()
      error.value = null
    } catch (cause) {
      error.value = cause.message
    }
  }

  function follow(name) {
    socket?.close()
    output.value = { name, lines: [], done: false }
    socket = new WebSocket(stackStreamUrl(name))
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'snapshot') {
        output.value = { name, lines: [...message.job.output], done: message.job.done }
      } else if (message.type === 'output') {
        output.value.lines.push(message.text)
      } else if (message.type === 'done') {
        output.value.done = true
        busy.value = null
        load()
      }
    }
    socket.onclose = () => {
      if (output.value && !output.value.done) busy.value = null
    }
  }

  async function run(name, action) {
    error.value = null
    busy.value = name
    try {
      await stackAction(name, action)
      follow(name)
    } catch (cause) {
      error.value = cause.message
      busy.value = null
      throw cause
    }
  }

  const readFiles = (name) => fetchStackFiles(name)

  /** `name` null = create. Returns the stack's name. */
  async function save(name, { name: newName, compose, env }) {
    if (name) await saveStackFiles(name, compose, env)
    else await createStack(newName, compose, env)
    await load()
    return name ?? newName
  }

  async function remove(name) {
    await deleteStack(name)
    if (output.value?.name === name) output.value = null
    await load()
  }

  function stopFollowing() {
    socket?.close()
    socket = null
  }

  watch(
    () => toValue(enabled),
    (on) => {
      clearInterval(timer)
      if (!on) {
        stacks.value = []
        return
      }
      load()
      // podman ps is local and cheap; stale status on a control panel is worse.
      timer = setInterval(load, 15_000)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    clearInterval(timer)
    socket?.close()
  })

  return {
    stacks: readonly(stacks),
    error: readonly(error),
    busy: readonly(busy),
    output: readonly(output),
    load,
    run,
    readFiles,
    save,
    remove,
    stopFollowing,
  }
}
