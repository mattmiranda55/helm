<script setup>
/**
 * A command or secret to copy: monospace, selectable, with a Copy button.
 *
 * Props
 *   text    what's shown and copied
 *   label   optional caption above it
 *   secret  shrink-wraps a single value (a token) instead of a block of shell
 */
import { IonButton, IonIcon } from '@ionic/vue'
import { checkmarkOutline, copyOutline } from 'ionicons/icons'
import { shallowRef } from 'vue'
import { copyText } from './clipboard'
import { useToast } from '@/composables/useToast'

const props = defineProps({
  text: { type: String, required: true },
  label: { type: String, default: null },
  secret: { type: Boolean, default: false },
})

const { show } = useToast()
const copied = shallowRef(false)
let timer = null

async function copy() {
  const ok = await copyText(props.text)
  if (!ok) {
    show('Couldn’t copy — select the text and copy it by hand')
    return
  }
  copied.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <figure class="copy-block">
    <figcaption v-if="label" class="caption">{{ label }}</figcaption>
    <div class="box" :class="{ secret }">
      <pre class="num code" translate="no">{{ text }}</pre>
      <ion-button
        size="small"
        fill="clear"
        class="copy"
        :aria-label="copied ? 'Copied' : `Copy${label ? ` ${label}` : ''}`"
        @click="copy"
      >
        <ion-icon slot="start" :icon="copied ? checkmarkOutline : copyOutline" aria-hidden="true" />
        {{ copied ? 'Copied' : 'Copy' }}
      </ion-button>
    </div>
  </figure>
</template>

<style scoped>
.copy-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.caption {
  font-size: 0.8125rem;
  color: var(--color-muted);
  padding-inline: 4px;
}
.box {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  background: var(--color-term);
  color: var(--color-term-ink);
  border-radius: var(--radius-row);
  padding: 10px 6px 10px 14px;
  min-width: 0;
}
.code {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding-top: 5px;
  font-size: 0.7812rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: all;
  -webkit-user-select: all;
}
.secret .code {
  font-size: 0.9375rem;
  word-break: break-all;
}
.copy {
  margin: 0;
  flex-shrink: 0;
  --color: var(--color-term-ink);
}
</style>
