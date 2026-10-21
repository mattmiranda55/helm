<script setup>
/**
 * What to do when Glances isn't answering on this machine: why, then
 * copy-paste ways to install it as something that survives a reboot, and a
 * Retry.
 *
 * Props
 *   error      the probe's error message, shown as the reason
 *   engine     'podman' | 'docker' | null — which container one-liner to lead with
 *   localOnly  bind Glances to 127.0.0.1 (helm is the only thing that needs it)
 *   busy       a retry is running
 *
 * Emits
 *   retry      try the probe again
 */
import { IonButton, IonSpinner } from '@ionic/vue'
import { computed } from 'vue'
import CopyBlock from './CopyBlock.vue'

const props = defineProps({
  error: { type: String, default: null },
  engine: { type: String, default: null },
  localOnly: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['retry'])

const opts = computed(() => (props.localOnly ? '-w -B 127.0.0.1' : '-w'))

const docker = computed(
  () => `docker run -d --name glances --restart always \\
  --pid host --network host \\
  -e GLANCES_OPT="${opts.value}" \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  -v /etc/os-release:/etc/os-release:ro \\
  nicolargo/glances:latest`,
)

// Rootless podman: Glances reads containers through podman's
// Docker-compatible socket, mounted where it looks for Docker's. Restart
// policies only apply after a reboot with podman-restart and lingering on.
const podman = computed(
  () => `systemctl --user enable --now podman.socket podman-restart.service
loginctl enable-linger "$USER"
podman run -d --name glances --restart always \\
  --pid host --network host \\
  --security-opt label=disable \\
  -e GLANCES_OPT="${opts.value}" \\
  -v /run/user/$(id -u)/podman/podman.sock:/var/run/docker.sock:ro \\
  -v /etc/os-release:/etc/os-release:ro \\
  docker.io/nicolargo/glances:latest`,
)

const pipx = computed(
  () => `pipx install 'glances[web]'
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/glances.service <<'EOF'
[Unit]
Description=Glances

[Service]
ExecStart=%h/.local/bin/glances ${opts.value}
Restart=on-failure

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now glances
loginctl enable-linger "$USER"`,
)

const options = computed(() => {
  const container =
    props.engine === 'podman'
      ? { title: 'With podman', text: podman.value, note: 'Runs rootless as you. The socket mount lets Glances see your containers.' }
      : {
          title: props.engine === 'docker' ? 'With Docker' : 'With Docker (or podman)',
          text: docker.value,
          note: 'The socket mount lets Glances see your containers; leave it out and helm shows none.',
        }
  const python = {
    title: 'With pipx',
    text: pipx.value,
    note: 'No containers needed. Installs Glances for your user and runs it as a user service that starts at boot.',
  }
  return props.engine ? [container, python] : [python, container]
})
</script>

<template>
  <section class="glances-help" aria-labelledby="glances-help-title">
    <div class="note">
      <h3 id="glances-help-title" class="title">Glances isn't answering</h3>
      <p v-if="error" class="reason num">{{ error }}</p>
      <p>
        helm reads every number from <a class="link" href="https://nicolargo.github.io/glances/" target="_blank" rel="noopener">Glances</a>
        in web-server mode, on port <span class="num">61208</span>. Install it on this machine one of these ways, then retry.
        Already running it somewhere else? Put its address in the Glances field and test that.
      </p>
    </div>

    <div v-for="option in options" :key="option.title" class="option">
      <CopyBlock :label="option.title" :text="option.text" />
      <p class="option-note">{{ option.note }}</p>
    </div>

    <p v-if="!localOnly" class="option-note">
      Glances has no password by default. Keep port 61208 on your LAN or tailnet, never the open internet.
    </p>

    <div>
      <ion-button fill="outline" size="small" :disabled="busy" @click="emit('retry')">
        <ion-spinner v-if="busy" slot="start" name="crescent" aria-hidden="true" />
        {{ busy ? 'Checking…' : 'Retry' }}
      </ion-button>
    </div>
  </section>
</template>

<style scoped>
.glances-help {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.note {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.title {
  font-weight: 700;
  color: var(--color-ink);
}
.reason {
  color: var(--color-critical);
  font-size: 0.8125rem;
  word-break: break-word;
}
.option {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.option-note {
  font-size: 0.8125rem;
  color: var(--color-muted);
  padding-inline: 4px;
  line-height: 1.4;
}
ion-button {
  margin: 0;
}
ion-spinner {
  width: 16px;
  height: 16px;
}
</style>
