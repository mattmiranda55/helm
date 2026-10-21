import { actionSheetController } from '@ionic/vue'

/**
 * Ask before doing something destructive (stop, take down, delete), with the
 * native iOS action sheet: the action in red, Cancel apart from it. Works on
 * top of an open sheet modal.
 *
 *   if (await confirm({ header: 'Stop navidrome?', message: '…', action: 'Stop' })) …
 *
 * Resolves true only when the action itself was tapped; Cancel, the backdrop
 * and Escape all resolve false.
 *
 * actionSheetController rather than the docs' default, an inline
 * <ion-action-sheet is-open>: a confirmation is a question asked in the middle
 * of a handler, and the controller lets it be awaited from any component
 * without template state. In Ionic Vue the controllers are the programmatic
 * API (React's useIonActionSheet has no Vue equivalent).
 * https://ionicframework.com/docs/api/action-sheet#controller-action-sheets
 *
 * Roles: 'destructive' and 'cancel' are the two styled roles; a button with no
 * role gets the platform's default look. 'selected' marks the current choice
 * (ion-select's action-sheet interface; it renders bold), so it is not used
 * for "go ahead". A non-destructive action gets a custom 'confirm' role, which
 * only serves to be handed back by onDidDismiss.
 * https://ionicframework.com/docs/api/action-sheet#buttons
 * https://ionicframework.com/docs/api/action-sheet#collecting-role-information-on-dismiss
 */
export function useConfirm() {
  async function confirm({ header, message, action, destructive = true }) {
    const role = destructive ? 'destructive' : 'confirm'
    const sheet = await actionSheetController.create({
      header,
      subHeader: message,
      buttons: [
        { text: action, role },
        { text: 'Cancel', role: 'cancel' },
      ],
    })
    await sheet.present()
    const result = await sheet.onDidDismiss()
    return result.role === role
  }
  return { confirm }
}
