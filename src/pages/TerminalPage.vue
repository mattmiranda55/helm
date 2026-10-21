<script setup>
/**
 * The terminal page. Ionic tabs keep it mounted after the first visit, so the
 * shell keeps running while you look at other tabs; the page lifecycle, not
 * mounting, says whether it is on screen.
 *
 * `fill` makes HelmPage's ion-content non-scrolling (`scroll-y="false"`, the
 * documented switch: https://ionicframework.com/docs/api/content#prop-scroll-y)
 * with a full-height body, so xterm owns its own scrolling and sizes to the
 * space between the header and the tab bar. The `fixed` slot would also stay
 * put, but it is meant for overlays such as FABs and refreshers, and it sits
 * outside ion-content's header/footer offsets, so the page would have to
 * re-derive them.
 */
import { IonButton, onIonViewDidEnter } from '@ionic/vue'
import { computed, shallowRef, useTemplateRef } from 'vue'
import HelmPage from '@/components/layout/HelmPage.vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import StatusText from '@/components/ui/StatusText.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { usePageActive } from '@/composables/usePageActive'

const { config } = useAppConfig()
const active = usePageActive()
const pane = useTemplateRef('pane')
const connection = shallowRef({ status: 'idle', detail: null })

/**
 * Fit again once the enter transition has finished, when xterm can measure the
 * size it will actually have. (Ionic lifecycle hooks only fire on the routed
 * page, which is why this lives here and not in TerminalPane.) Focus too, but only with a real keyboard: on a
 * phone a programmatic focus that does open the keyboard (Android, right after
 * the tab tap) would cover half the screen on every visit.
 */
onIonViewDidEnter(() => {
  pane.value?.refit()
  if (window.matchMedia('(pointer: fine)').matches) pane.value?.focus()
})

const state = computed(() => {
  const { status, detail } = connection.value
  if (status === 'open') return { level: 'good', label: 'Connected' }
  if (status === 'connecting' || status === 'idle') return { level: 'muted', label: 'Connecting…' }
  return { level: 'critical', label: detail ?? 'Disconnected' }
})
</script>

<template>
  <HelmPage title="Terminal" fill>
    <div class="terminal-page">
      <div class="head">
        <p class="page-sub">A shell on the machine helm runs on.</p>
        <div class="status">
          <StatusText :level="state.level">{{ state.label }}</StatusText>
          <ion-button
            v-if="connection.status === 'closed'"
            fill="clear"
            size="small"
            class="reconnect"
            @click="pane?.reconnect()"
          >
            Reconnect
          </ion-button>
        </div>
      </div>

      <p v-if="!config.terminal.enabled" class="note">
        The terminal is turned off in this server's config (<code class="num">terminal.enabled</code>).
      </p>
      <TerminalPane v-else ref="pane" :commands="config.commands" :active="active" @status="connection = $event" />
    </div>
  </HelmPage>
</template>

<style scoped>
/* A flex child rather than height: 100%, so a shell notice above it (HelmPage)
   takes its space from the terminal instead of pushing it off the bottom. */
.terminal-page {
  width: 100%;
  max-width: 1180px;
  margin-inline: auto;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  flex-wrap: wrap;
  min-height: 28px;
}
.head .page-sub {
  margin-top: 0;
}
.status {
  display: flex;
  align-items: center;
  gap: 4px 8px;
}
/* Sits on the row's baseline instead of adding its own margin. */
.reconnect {
  margin: 0;
}
</style>
