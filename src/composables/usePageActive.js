import { onIonViewWillEnter, onIonViewWillLeave } from '@ionic/vue'
import { shallowRef } from 'vue'

/**
 * Whether this Ionic page is the one on screen, as a ref composables can watch
 * (useMetrics, useStacks pause on it). Ionic keeps pages mounted after you
 * navigate away (each tab keeps its stack), so onMounted/onUnmounted no longer
 * mean "visible"; Ionic's page lifecycle does.
 * https://ionicframework.com/docs/vue/lifecycle
 *
 * Call it at the top level of a *routed* page's setup (directly or through a
 * composable it calls). Ionic fires these hooks only on the component the
 * router maps — a child component's hooks never run, so its ref would stay
 * true forever.
 *
 * WillEnter/WillLeave rather than Did*: polling resumes as the page starts
 * sliding in, and stops as soon as it starts leaving.
 *
 * Starts true: a page is mounted because it is being entered, and waiting for
 * the enter event would delay the first fetch by the transition.
 */
export function usePageActive() {
  const active = shallowRef(true)
  onIonViewWillEnter(() => (active.value = true))
  onIonViewWillLeave(() => (active.value = false))
  return active
}
