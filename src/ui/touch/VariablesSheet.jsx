import { useState } from 'react'
import Sheet from './Sheet'
import VariablesPanel from '../VariablesPanel'

/**
 * Variables, in a sheet, and deliberately not a modal one.
 *
 * The panel's own note says why it takes over the rail rather than opening
 * over the scene: a variable is only worth dragging if you can watch the build
 * answer. That reasoning survives the move to a handheld exactly — so this is
 * an attached sheet, and it comes up peeking so there is still a build to
 * watch above it.
 *
 * The panel keeps its own header and its own Done, so the sheet contributes
 * nothing but the grab bar.
 */
export default function VariablesSheet({ onClose }) {
  const [detent, setDetent] = useState('mid')
  return (
    <Sheet
      flush
      detent={detent}
      onDetent={setDetent}
      label="Variables"
      className="variables-sheet"
    >
      <VariablesPanel onClose={onClose} />
    </Sheet>
  )
}
