<script setup>
/**
 * In-app link: a real <a href> (so Cmd/middle-click and long-press work) that
 * navigates without a page load on a plain click.
 */
import { computed } from 'vue'
import { navigate, route } from '@/lib/router'

const props = defineProps({
  to: { type: String, required: true },
  /** Route names that count as "this page" for aria-current. */
  activeFor: { type: Array, default: null },
})

const current = computed(() =>
  props.activeFor ? props.activeFor.includes(route.value.name) : route.value.path === props.to,
)

function onClick(event) {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(props.to)
}
</script>

<template>
  <a :href="to" :aria-current="current ? 'page' : undefined" @click="onClick"><slot /></a>
</template>
