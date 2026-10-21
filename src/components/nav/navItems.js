import { appsOutline, cubeOutline, serverOutline, terminalOutline } from 'ionicons/icons'

/**
 * The four destinations of the tab bar. `tab` is the Ionic tab id; `to` is the
 * tab button's href, which is also the path prefix Ionic uses to decide which
 * tab a URL belongs to (so /machines/:id stays in Machines).
 * https://ionicframework.com/docs/api/tab-button
 */
export const NAV_ITEMS = [
  { tab: 'machines', to: '/machines', label: 'Machines', icon: serverOutline },
  { tab: 'apps', to: '/apps', label: 'Apps', icon: appsOutline },
  { tab: 'containers', to: '/containers', label: 'Containers', icon: cubeOutline },
  { tab: 'terminal', to: '/terminal', label: 'Terminal', icon: terminalOutline },
]
