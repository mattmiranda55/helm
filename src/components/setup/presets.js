/**
 * Suggested terminal commands. Tapping one in the terminal only types it —
 * nothing runs until Enter — so even reboot is safe to offer, just not on by
 * default. `on` marks the ones a fresh setup starts with.
 *
 * `engine` is 'podman', 'docker' or null (Local.engine); the container
 * commands are left out when there is no engine.
 */
export function commandPresets(engine) {
  const presets = []
  if (engine) {
    presets.push(
      {
        name: 'Containers',
        description: 'Every container, its status and ports',
        command: `${engine} ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'`,
        on: true,
      },
      {
        name: 'Container usage',
        description: 'CPU and memory per container, once',
        command: `${engine} stats --no-stream`,
        on: false,
      },
    )
  }
  presets.push(
    { name: 'Disk space', description: 'Free space on every filesystem', command: 'df -h', on: true },
    { name: 'Memory', description: 'RAM and swap in use', command: 'free -h', on: true },
    { name: 'Uptime', description: 'How long it has been up, and the load', command: 'uptime', on: true },
    { name: 'System log', description: 'Follow the journal as it happens', command: 'journalctl -f', on: true },
    { name: 'Failed services', description: 'systemd units that have failed', command: 'systemctl --failed', on: false },
    { name: 'helm log', description: "Follow helm's own service log", command: 'journalctl -u helm -f', on: false },
    { name: 'Reboot', description: 'Restart this machine', command: 'sudo systemctl reboot', on: false },
  )
  return presets
}

/** The presets a fresh setup starts with, as config commands. */
export const defaultCommands = (engine) =>
  commandPresets(engine)
    .filter((preset) => preset.on)
    .map(({ name, description, command }) => ({ name, description, command }))
