<script setup>
/**
 * An app's icon from the server's cache, or its initials when there isn't one.
 * The initials also stand in while an icon loads, which on its very first view
 * means the server fetching it — so a tile is never blank.
 */
import { computed, shallowRef, watch } from 'vue'
import { iconUrl } from '@/lib/api'
import { iconSlug, initials } from '@/lib/services'

const props = defineProps({
  service: { type: Object, required: true },
  /** null | 'stopped' | 'critical' — a corner flag for an app that isn't up. */
  flag: { type: String, default: null },
})

const slug = computed(() => iconSlug(props.service))
const status = shallowRef('loading') // loading | loaded | failed
watch(slug, () => (status.value = 'loading'))
</script>

<template>
  <span class="badge">
    <span v-if="!slug || status !== 'loaded'" class="initials" translate="no">{{ initials(service) }}</span>
    <img
      v-if="slug && status !== 'failed'"
      :class="{ pending: status !== 'loaded' }"
      :src="iconUrl(slug)"
      alt=""
      width="64"
      height="64"
      decoding="async"
      @load="status = 'loaded'"
      @error="status = 'failed'"
    />
    <span
      v-if="flag"
      class="flag"
      :style="{ background: flag === 'critical' ? 'var(--color-critical)' : 'var(--color-muted)' }"
      :title="flag === 'critical' ? 'Crashing' : 'Not running'"
    />
  </span>
</template>

<style scoped>
.badge {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  max-width: 64px;
  aspect-ratio: 1;
  border-radius: 16px;
  background: var(--color-surface);
  transition: transform 0.1s;
}
.badge img {
  width: 60%;
  height: 60%;
  object-fit: contain;
}
.badge img.pending {
  position: absolute;
  opacity: 0;
}
.initials {
  font-weight: 700;
  font-size: 20px;
  color: var(--color-ink);
}
.flag {
  position: absolute;
  right: -2px;
  top: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--color-plane);
}
</style>
