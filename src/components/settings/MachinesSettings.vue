<script setup>
/**
 * Settings → Machines: every server helm watches. Tap one to edit it (and its
 * apps); + adds one. When HELM_NODES sets the servers, they can be looked at
 * but not changed here.
 *
 * Loaded on mount (each push onto ion-nav is a new instance), and again
 * whenever a Settings save lands (onConfigSaved), so popping back from the
 * machine page shows what was just saved.
 *
 * "+" is an <ion-nav-link> around the toolbar button: the declarative push,
 * with the page to show as `component` and its props as `component-props`.
 * https://ionicframework.com/docs/api/nav-link
 */
import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNavLink, IonNote, IonSpinner } from '@ionic/vue'
import { addOutline } from 'ionicons/icons'
import { markRaw, onMounted, shallowRef } from 'vue'
import { describeError, isLocalNode, onConfigSaved, pushPage } from './editing'
import MachineSettings from './MachineSettings.vue'
import SettingsView from './SettingsView.vue'
import { fetchEditableConfig } from '@/lib/api'

/** markRaw: see SettingsModal. */
const machinePage = markRaw(MachineSettings)
const NEW = { id: 'new' }

const editable = shallowRef(null)
const loading = shallowRef(true)
const error = shallowRef(null)

let run = 0
async function load() {
  const mine = ++run
  loading.value = !editable.value
  error.value = null
  try {
    const value = await fetchEditableConfig()
    if (mine === run) editable.value = value
  } catch (cause) {
    if (mine === run) error.value = describeError(cause, 'load')
  } finally {
    if (mine === run) loading.value = false
  }
}
onMounted(load)
onConfigSaved(load)

const appCount = (id) => editable.value?.services.filter((s) => s.node === id).length ?? 0
</script>

<template>
  <SettingsView title="Machines" back-text="Settings">
    <template #end>
      <ion-nav-link
        v-if="editable && !editable.nodesFromEnv"
        router-direction="forward"
        :component="machinePage"
        :component-props="NEW"
      >
        <ion-button aria-label="Add a machine">
          <ion-icon slot="icon-only" :icon="addOutline" />
        </ion-button>
      </ion-nav-link>
    </template>

    <div class="page settings-sub">
      <p v-if="error" class="note error" role="alert">
        {{ error }}
        <ion-button size="small" fill="clear" @click="load">Try again</ion-button>
      </p>

      <p v-if="loading" class="loading"><ion-spinner name="crescent" aria-hidden="true" />Loading…</p>

      <template v-else-if="editable">
        <p v-if="editable.nodesFromEnv" class="note">
          This server’s machines are set by <span class="num">HELM_NODES</span> in its environment, so they can’t be
          changed here. Their apps still can — open one.
        </p>

        <section class="section">
          <ion-list v-if="editable.nodes.length" :inset="true" class="group">
            <!-- A row pushes with pushPage rather than an ion-nav-link wrapper,
                 which would break the inset list's separators (SettingsRoot). -->
            <ion-item
              v-for="node in editable.nodes"
              :key="node.id"
              :button="true"
              :detail="true"
              @click="pushPage(machinePage, { id: node.id })"
            >
              <!-- Item labels wrap by default (Ionic 8+), which breaks a URL at its
                   slashes; .ion-text-nowrap truncates each line instead. -->
              <ion-label class="ion-text-nowrap">
                <h3 translate="no">
                  {{ node.label }}<span v-if="isLocalNode(node)" class="badge">This server</span>
                </h3>
                <p class="num" translate="no">{{ node.url }}</p>
              </ion-label>
              <ion-note slot="end">{{ appCount(node.id) }} {{ appCount(node.id) === 1 ? 'app' : 'apps' }}</ion-note>
            </ion-item>
          </ion-list>
          <div v-else class="empty">
            <p class="note">No machines yet. Add the first one — it needs Glances running in web-server mode.</p>
            <div>
              <ion-nav-link
                v-if="!editable.nodesFromEnv"
                router-direction="forward"
                :component="machinePage"
                :component-props="NEW"
              >
                <ion-button>
                  <ion-icon slot="start" :icon="addOutline" aria-hidden="true" />Add a machine
                </ion-button>
              </ion-nav-link>
            </div>
          </div>
          <ion-note v-if="editable.nodes.length" class="footer">
            helm reaches each machine’s Glances from the server, not from this device.
          </ion-note>
        </section>
      </template>
    </div>
  </SettingsView>
</template>

<style scoped>
.settings-sub {
  max-width: 640px;
  gap: 24px;
}
.section,
.empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group {
  margin: 0;
}
.footer {
  display: block;
  padding-inline: 16px;
  font-size: 0.8125rem;
  line-height: 1.4;
}
.badge {
  margin-inline-start: 8px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--color-sunken);
  color: var(--color-muted);
  font-size: 0.7188rem;
  font-weight: 600;
  vertical-align: 1px;
}
.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline: 16px;
  font-size: 0.8438rem;
  color: var(--color-muted);
}
.loading ion-spinner {
  width: 16px;
  height: 16px;
}
.error {
  color: var(--color-critical);
}
.error ion-button,
.empty ion-button {
  margin: 0;
}
</style>
