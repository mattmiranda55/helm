import { toastController } from '@ionic/vue'

let current = null

/**
 * One short confirmation at a time, e.g. "Restarted navidrome", just above the
 * tab bar.
 *
 * toastController, Ionic Vue's programmatic API for toasts (there is no
 * useIonToast in Vue): a toast is fired from inside a handler, not bound to a
 * piece of template state. positionAnchor pins it above the tab bar instead
 * of behind it; the id is TabsPage's, and the setup screen has no tab bar.
 * https://ionicframework.com/docs/api/toast#relative-positioning
 */
export function useToast() {
  async function show(text, ms = 2600) {
    const previous = current
    const toast = await toastController.create({
      message: text,
      duration: ms,
      position: 'bottom',
      positionAnchor: document.getElementById('tabbar') ? 'tabbar' : undefined,
      // Swipe down to dismiss. https://ionicframework.com/docs/api/toast#swipe-to-dismiss
      swipeGesture: 'vertical',
    })
    current = toast
    previous?.dismiss()
    await toast.present()
  }
  return { show }
}
