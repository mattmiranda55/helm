/**
 * Whether the helm server itself is answering — what the header's "Live"
 * means. A machine that is down is a different thing and shows up under
 * "Needs attention" instead; that request still reached the server.
 */
import { shallowRef } from 'vue'

export const connection = shallowRef('connecting') // connecting | live | offline

export function markReached() {
  connection.value = 'live'
}

/** fetch() rejects with a TypeError only when the request never got an answer. */
export function markFailed(cause) {
  if (cause instanceof TypeError) connection.value = 'offline'
  else connection.value = 'live'
}
