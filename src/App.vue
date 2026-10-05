<script setup>
/**
 * App shell: header, the current page, and the phone tab bar.
 *
 * The terminal is the exception to "one page at a time": once opened it stays
 * mounted (hidden) so the shell keeps running while you look elsewhere, the
 * same way the old side pane kept it alive across tabs.
 */
import { computed, shallowRef, watch } from 'vue'
import AppHeader from '@/components/nav/AppHeader.vue'
import TabBar from '@/components/nav/TabBar.vue'
import TerminalPage from '@/components/terminal/TerminalPage.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useAppConfig } from '@/composables/useAppConfig'
import { route } from '@/lib/router'
import AppsPage from '@/pages/AppsPage.vue'
import ContainersPage from '@/pages/ContainersPage.vue'
import MachinePage from '@/pages/MachinePage.vue'
import MachinesPage from '@/pages/MachinesPage.vue'
import NotFoundPage from '@/pages/NotFoundPage.vue'

const { config, loaded, error } = useAppConfig()

const PAGES = {
  machines: MachinesPage,
  machine: MachinePage,
  apps: AppsPage,
  containers: ContainersPage,
  'not-found': NotFoundPage,
}

const onTerminal = computed(() => route.value.name === 'terminal')
const terminalOpened = shallowRef(onTerminal.value)
watch(onTerminal, (on) => {
  if (on) terminalOpened.value = true
})

const page = computed(() => PAGES[route.value.name] ?? null)
const pageKey = computed(() => (route.value.name === 'machine' ? 'machine' : route.value.name))

const TITLES = { machines: 'Machines', apps: 'Apps', containers: 'Containers', terminal: 'Terminal' }
watch(
  [() => route.value.name, () => route.value.params.id, () => config.value.nodes],
  ([name, id]) => {
    const machine = name === 'machine' && config.value.nodes.find((n) => n.id === id)
    const title = machine ? machine.label : TITLES[name]
    document.title = title ? `${title} · helm` : 'helm'
  },
  { immediate: true },
)
</script>

<template>
  <div class="shell">
    <AppHeader />

    <main id="main" class="main" :class="{ 'main-terminal': onTerminal }">
      <p v-if="error" class="note" style="color: var(--color-critical)">
        Couldn't load the server's config: {{ error }}
      </p>
      <p v-else-if="loaded && !config.nodes.length" class="note">
        No machines configured. Copy <code class="num">config.example.json</code> to
        <code class="num">config.json</code>, add your Glances hosts, and restart the server.
      </p>

      <component :is="page" v-if="page && !onTerminal" :key="pageKey" v-bind="route.params" />
      <TerminalPage v-if="terminalOpened" v-show="onTerminal" :active="onTerminal" />
    </main>

    <TabBar />
    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 16px 28px;
}
.main-terminal {
  overflow: hidden;
  padding-bottom: 12px;
}
@media (min-width: 768px) {
  .main {
    padding: 8px 32px 40px;
  }
  .main-terminal {
    padding-bottom: 24px;
  }
}
</style>
