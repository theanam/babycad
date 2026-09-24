/**
 * Saving and opening a build as a file on disk.
 *
 * A build is a file, the way a document in any other program is a file. There
 * is no library inside the app to keep it in, nothing is uploaded anywhere,
 * and nothing is hidden in browser storage that a cleared cache can take
 * away: Save writes a .babycad where you say, Open reads one back.
 *
 * Where the browser has the File System Access API — Chrome and Edge — a
 * saved build keeps hold of its file, so every Save after the first writes
 * straight back to it with no dialog, which is what Ctrl-S means everywhere
 * else. Where it doesn't, Firefox and Safari, Save falls back to a download
 * and Open to a file input; a download cannot overwrite in place, so there
 * every save lands a fresh copy in the downloads folder. The app says which
 * of the two it is doing rather than pretending they are the same.
 *
 * On a touch device there is a third way, and it is the good one: the share
 * sheet. A phone has no downloads folder anybody goes looking in, so Save
 * hands the build to the system instead — Save to Files, AirDrop, mail it to
 * yourself — and only falls back to a download where the device won't take it.
 * See io/share.
 */

import { fileFrom, shareFile } from './share'

const EXT = '.babycad'

const TYPES = [
  { description: 'BabyCAD build', accept: { 'application/json': [EXT] } },
]

/** Whether this browser can write back to a file it was given. */
export const canUseFileSystem = () =>
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'

export const baseName = (name) => String(name ?? '').replace(/\.babycad$/i, '')
const withExt = (name) => (name.toLowerCase().endsWith(EXT) ? name : name + EXT)

/** A handle from an earlier pick may need its permission asking for again. */
async function writable(handle) {
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission?.(opts)) === 'granted') return true
  return (await handle.requestPermission?.(opts)) === 'granted'
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Write a build out.
 *
 * `share` asks for the device's share sheet first, which is what Save means on
 * a touch device. It is tried ahead of everything else because on a phone the
 * alternatives are a picker that isn't there and a folder nobody opens — but
 * it is only ever an offer: a device that won't take a `.babycad` falls
 * straight through to the paths below, and nothing is lost.
 *
 * A shared build keeps no handle, because there is nothing to write back to:
 * the file has gone wherever it was sent, and the next Save offers it again.
 *
 * @returns `{ handle, name, downloaded, shared }` on success, or null if the
 *          person backed out of the dialog — which is not a failure and should
 *          not be reported as one.
 */
export async function saveToDisk({ handle, name, text, saveAs = false, share = false }) {
  const filename = withExt(name || 'build')

  if (share) {
    const result = await shareFile(
      fileFrom(new Blob([text], { type: 'application/json' }), filename, 'application/json'),
      { title: baseName(filename), text: 'A BabyCAD build' }
    )
    if (result === 'dismissed') return null
    if (result === 'shared') return { handle: null, name: baseName(filename), shared: true }
  }

  if (canUseFileSystem()) {
    let target = saveAs ? null : handle
    if (target && !(await writable(target))) target = null
    if (!target) {
      try {
        target = await window.showSaveFilePicker({
          suggestedName: filename,
          types: TYPES,
        })
      } catch (error) {
        if (error?.name === 'AbortError') return null
        throw error
      }
    }
    const stream = await target.createWritable()
    await stream.write(text)
    await stream.close()
    return { handle: target, name: baseName(target.name), downloaded: false }
  }

  download(text, filename)
  return { handle: null, name: baseName(filename), downloaded: true }
}

/** Read builds in. Several at once, since tabs can hold several. */
export async function openFromDisk() {
  if (canUseFileSystem()) {
    let handles
    try {
      handles = await window.showOpenFilePicker({ types: TYPES, multiple: true })
    } catch (error) {
      if (error?.name === 'AbortError') return []
      throw error
    }
    return Promise.all(
      handles.map(async (handle) => ({
        handle,
        name: baseName(handle.name),
        text: await (await handle.getFile()).text(),
      }))
    )
  }

  // No picker: a plain file input, which hands back contents and no handle,
  // so saving one of these has to ask where to put it.
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `${EXT},application/json,.json`
    input.multiple = true
    const done = async () => {
      const files = [...(input.files ?? [])]
      input.remove()
      resolve(
        await Promise.all(
          files.map(async (file) => ({ handle: null, name: baseName(file.name), text: await file.text() }))
        )
      )
    }
    input.addEventListener('change', done, { once: true })
    input.addEventListener('cancel', () => {
      input.remove()
      resolve([])
    }, { once: true })
    input.style.display = 'none'
    document.body.appendChild(input)
    input.click()
  })
}
