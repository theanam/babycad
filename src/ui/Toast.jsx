import { create } from 'zustand'

let seq = 0

const useToastStore = create((set) => ({
  items: [],
  push(message, tone = 'info', ms = 2600) {
    const id = ++seq
    set((s) => ({ items: [...s.items, { id, message, tone }] }))
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), ms)
  },
}))

/** Fire a confirmation from anywhere: toast('Saved'). */
export const toast = (message, tone) => useToastStore.getState().push(message, tone)

export default function Toasts() {
  const items = useToastStore((s) => s.items)
  if (!items.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={t.tone === 'warn' ? 'toast warn' : 'toast'}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
