/**
 * Handing a finished file to the device, rather than to a downloads folder.
 *
 * On a phone or a tablet there is no downloads folder worth the name and no
 * file picker to point at one. What there is, is the share sheet: Save to
 * Files, AirDrop it to the desktop, mail it to yourself, send it to the
 * printer app. That is where a build wants to go on a touch device, and
 * `navigator.share` is the only way to get it there from a web page.
 *
 * Three things about it are worth knowing before changing this file.
 *
 * **`canShare` is the gate, and it is per file.** Chrome keeps an allowlist of
 * file types it will share and `.babycad` is not on it, so on Android this
 * answers false and the caller falls back to a download. iOS, where the share
 * sheet actually matters, takes it. Asking with the real file — not with a
 * guess at the type — is what keeps that honest.
 *
 * **It needs a user gesture that is still warm.** Exporting an STL rebuilds
 * every cut solid with Manifold first, and on a big build that can outlast the
 * activation the tap granted. A share refused for that reason throws
 * `NotAllowedError`, which is not a failure worth reporting — it is a download
 * instead, silently, because the person asked for their file and a file is
 * what they should get.
 *
 * **Dismissing the sheet is not an error either.** It arrives as `AbortError`
 * and means somebody changed their mind.
 */

/** Whether this file, specifically, can go to the share sheet. */
export function canShareFile(file) {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** Build the `File` the share sheet wants out of bytes we already have. */
export const fileFrom = (blob, name, type) =>
  new File([blob], name, { type: type || blob.type || 'application/octet-stream' })

/**
 * Offer a file to the device's share sheet.
 *
 * @returns 'shared' when it went somewhere, 'dismissed' when the sheet was
 *          closed without choosing, or null when this device cannot share it
 *          (or would not, this time) and the caller should download instead.
 */
export async function shareFile(file, { title, text } = {}) {
  if (!canShareFile(file)) return null
  try {
    await navigator.share({ files: [file], title, text })
    return 'shared'
  } catch (error) {
    if (error?.name === 'AbortError') return 'dismissed'
    // NotAllowedError is a spent activation; anything else is a share sheet
    // that did not work. Either way a download still will.
    return null
  }
}
