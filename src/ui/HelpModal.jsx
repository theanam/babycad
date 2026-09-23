import { useEffect } from 'react'
import { angleStepFor, PLATE, SNAP, SNAP_DEFAULT, SNAP_STEPS } from '../constants'
import { FEEDBACK_EMAIL, FEEDBACK_MAILTO, ISSUES_URL, REPO_URL } from '../links'
import { BugIcon, CloseIcon, ExternalIcon, GithubIcon, MailIcon } from './icons'

const SHORTCUTS = [
  ['Ctrl / ⌘ + Z', 'Undo'],
  ['Shift + Ctrl / ⌘ + Z', 'Redo'],
  ['Ctrl / ⌘ + A', 'Pick every block'],
  ['Ctrl / ⌘ + S', 'Save this build to its file'],
  ['Ctrl / ⌘ + O', 'Open a build'],
  ['Ctrl / ⌘ + D', 'Copy what’s selected'],
  ['Delete or Backspace', 'Remove what’s selected'],
  ['Esc', 'Deselect'],
  ['Shift + click', 'Add a block to the selection'],
  ['Drag on empty space', 'Draw a box to pick several blocks'],
  ['Right-drag', 'Turn the view'],
  ['Middle-drag', 'Slide the view (or Shift + right-drag)'],
  ['L', 'Line up everything you’ve picked'],
  ['Hold Alt', 'Move without snapping to the grid'],
  ['Arrow keys', 'Nudge what’s picked across the plate'],
  ['Shift + arrows', 'Nudge it ten steps at a time'],
  ['Arrow keys in a field', 'Step that number'],
]

/**
 * How the thing works, in one sheet.
 *
 * Written to be read once by somebody who has never used a CAD program, in the
 * order they will meet things: the plate, then shapes, then the handles, then
 * the numbers. The parts that are genuinely surprising get their own line —
 * that Z is up, that resizing writes into the shape's own millimetres, that
 * everything lives in this browser and nowhere else.
 */
export default function HelpModal({ onClose, onShowWelcome }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help" role="dialog" aria-label="How BabyCAD works">
        <div className="modal-head">
          <div className="modal-title">How this works</div>
          <div className="modal-tag">YOUR BUILDS ARE FILES ON YOUR COMPUTER</div>
          <button className="modal-close" onClick={onClose} title="Close" aria-label="Close">
            <CloseIcon stroke="#8A93A5" />
          </button>
        </div>

        <div className="help-body">
          <section>
            <h3>The plate</h3>
            <p>
              You build on a {PLATE} × {PLATE} mm plate. One grid square is {SNAP.move} mm, the
              heavier line every 20 mm marks out the footprint a freshly dropped shape takes up,
              and a new block lands on that grid. Every number in the app is millimetres, so an{' '}
              <strong>.stl</strong> exported from here arrives in a slicer at the size it says it
              is.
            </p>
            <p>
              Axes are named the CAD way: <strong>X</strong> across, <strong>Y</strong> away from
              you and <strong>Z</strong> straight up. A block&apos;s <strong>Z</strong> is how far
              its underside is above the plate, so anything resting on the plate reads 0. The
              little cube at the bottom left turns the view — drag it, or tap a face to look at
              the build straight on.
            </p>
          </section>

          <section>
            <h3>Looking around</h3>
            <ul className="help-list">
              <li>
                <b>Right-drag</b> to turn the view round the build.
              </li>
              <li>
                <b>Middle-drag</b> to slide the view sideways — or <b>Shift + right-drag</b>, if
                your mouse or trackpad has no middle button.
              </li>
              <li>
                <b>Scroll</b> to zoom. On a touchscreen, one finger turns, two fingers pinch and
                slide.
              </li>
            </ul>
          </section>

          <section>
            <h3>Putting blocks down</h3>
            <p>
              The rail down the left is the shapes. Tap one and it lands on the plate in front of
              the camera. The top group is the plain solids you size — a cube, a ball, a ramp. The
              bottom group are generators: a gear with real involute teeth, a screw with a metric
              thread, a coil, a knot, and words. Those you specify rather than size, and two gears
              with the same tooth size genuinely mesh.
            </p>
            <p>
              <b>Text</b> is a generator too. <b>Double-click the words on the plate</b> to change
              them where they stand, or type into <b>Words</b> in the rail; the letters are
              rebuilt as one solid, lying face up on the plate with their thickness going straight
              up — the way a nameplate is printed. <b>Letter height</b> and <b>Thickness</b> are the
              two sizes; how wide it comes out is up to the word. Dragging a corner sets the letter
              height, and dragging the top sets the thickness.
            </p>
          </section>

          <section>
            <h3>Moving it about</h3>
            <p>
              There are no tool modes — whichever handle on the box you grab is the operation.
            </p>
            <ul className="help-list">
              <li>
                <b>Drag the block itself</b> to slide it across the floor, or nudge it with the{' '}
              <b>arrow keys</b> — which go by where you are standing, so up is always away from
              you however the view is turned. Each press is one step of the snap grid, and Shift
              takes ten.
              </li>
              <li>
                <b>The four corners at the bottom</b> resize it, growing it up and away from the
                opposite corner so it never sinks through the plate.
              </li>
              <li>
                <b>The handle on top</b> changes its height only.
              </li>
              <li>
                <b>The ball on a stick</b> turns it. There is one per axis, each the colour of the
                axis it swings about.
              </li>
            </ul>
            <p>
              Dragging snaps to {SNAP_DEFAULT} mm to begin with, and turning to{' '}
              {angleStepFor(SNAP_DEFAULT)}°. The <strong>Snap</strong> switch&apos;s menu —
              right-click it, or press the arrow beside it — offers{' '}
              {SNAP_STEPS.map((s) => `${s.mm} mm / ${s.deg}°`).join(', ')}, or no snapping at all.
              Hold <strong>Alt</strong> to suspend it for as long as you need. Whichever grid you
              pick stays with that build — it is saved in the file, so a bracket that wants tenths
              of a millimetre opens on tenths of a millimetre.
            </p>
            <p>
              The plate pulls, too. Let go of a block within a few millimetres of the floor and it
              settles flat on it, rather than hovering a fraction above or sinking a fraction below
              — a gap too small to see and big enough to matter to a printer. It settles when you
              let go, never while you are still dragging, so the last millimetres of a lift are a
              movement rather than a tug of war. <strong>Snap to the plate</strong> at the bottom
              of the same menu turns it off on its own, for laying parts out deliberately just
              above the floor.
            </p>
            <p>
              Either way it is for dragging only: a number you type into the rail or onto the box
              is left exactly where you put it.
            </p>
            <p>
              While you drag, the measurement rides along beside the block — the size on the edge
              it belongs to, the angle or the position just above it — so you don&apos;t have to
              watch the rail out of the corner of your eye.
            </p>
          </section>

          <section>
            <h3>Holes</h3>
            <p>
              Any block can be a <strong>hole</strong> instead of a solid — the switch is at the
              top of the rail. A hole goes grey and see-through, and it cuts its shape out of every
              solid it overlaps, straight away. Push a tube through a cube and the cube has a
              tube-shaped hole in it while you are still pushing.
            </p>
            <p>
              <strong>Combine</strong> is how you finish: it puts the grey ghost away and leaves
              just the solid with the bite taken out of it. Nothing is destroyed doing that —{' '}
              <strong>Split apart</strong> brings the hole back, still cutting, still yours to move
              or resize. Holes never end up in an exported file; they are the tool, not the part.
            </p>
            <p>
              Combining also makes the parts one colour: whichever of them covers the most plate
              lends its colour to the rest. Six colours touching each other are six blocks; once
              they are one thing they should look like one, and the biggest piece is the one
              anybody would name if asked what colour it is. Holes get no say — they are drawn
              grey whatever colour they carry.
            </p>
            <p>
              Nothing is lost: <strong>Split apart</strong> hands every part its own colour back,
              and so does undo. The colours travel inside the build, so a thing combined today
              still comes apart into its own colours next week on another computer.
            </p>
            <p>
              Combining has levels. Combine something that is already combined and it goes in
              whole, as one part of the new thing, rather than being tipped back out into its
              pieces — so a wheel made of a tyre and a hub stays a wheel when you combine it onto
              a cart. <strong>Split apart</strong> takes the last step back off and leaves
              everything underneath as it was; split again to go one level deeper.
            </p>
          </section>

          <section>
            <h3>Lining things up</h3>
            <p>
              Pick more than one block — hold <strong>Shift</strong> while you click, drag a box
              across empty plate to catch everything it touches, or press{' '}
              <strong>Ctrl / ⌘ + A</strong> for the lot — and an <strong>Align</strong> switch
              appears over the scene. Turn it on and nine dots surround the selection: three along
              the front edge, three down the left, three going up the near corner.
            </p>
            <p>
              Each row is one axis. Tap an outer dot to bring that set of faces together, or the
              middle dot to centre everything on that axis. Hovering a dot draws a square where
              the faces are about to meet. Anything you&apos;ve <strong>combined</strong> travels
              as one piece, so it keeps its own arrangement.
            </p>
          </section>

          <section>
            <h3>Typefaces</h3>
            <p>
              Words come in a <b>Typeface</b> of your choosing. Two ship with the app and are
              always there; the rest are Google Fonts, fetched the first time you pick one, so
              that one takes a moment and needs a connection. The list leans on rounded and heavy
              faces on purpose — a hairline serif at 15 mm is a stroke a printer cannot lay down.
            </p>
            <p>
              A build remembers the name of the face, not the face itself. Open one on a computer
              that has never fetched it and the words wait in the standard face for a moment while
              it arrives.
            </p>

            <h3>Bringing a model in</h3>
            <p>
              <b>Import</b> in the top bar opens an <b>STL</b>, an <b>OBJ</b> or a <b>3MF</b> and
              drops it on the plate as a block like any other — move it, turn it, make it a hole,
              export it with the rest. Only the triangles come across: colours and materials are
              left behind, and the part takes a swatch here the way everything else does.
            </p>
            <p>
              It has no width or height to type, because a model is a bag of triangles with no
              opinion about which of them is its width — so resizing one stretches it rather than
              writing a number. The triangles are kept inside the build file, so a
              <b> .babycad</b> with an imported part opens the same on somebody else&apos;s
              computer, with no second file to go and find. That does make the file much bigger
              than a build of plain blocks.
            </p>

            <h3>Taking the edges off</h3>
            <p>
              A cube, a tube, a cone, a pipe and words all carry an <b>Edge</b>. Wind it up and
              the sharp edges come back — as a quarter <b>Round</b> or as a flat <b>Bevel</b>,
              whichever <b>Edge shape</b> says. Zero is a sharp edge, which is what everything
              starts as.
            </p>
            <p>
              It is measured in millimetres like everything else, and each shape quietly takes as
              much as it has room for: a 6 mm plate cannot lose 20 mm of edge, so it loses what it
              can. A tube or a pipe cut to part of a turn keeps its cut faces sharp — a cut face is
              sharp, and pretending otherwise would be describing something the cut did not do.
            </p>

            <h3>One size, not two</h3>
            <p>
              Resizing a block in the yard writes straight into the shape&apos;s own numbers. Drag
              a 20 mm cube twice as wide and its <strong>Width</strong> in the rail says 40 mm —
              the block and its numbers can never disagree, because there is only one of them.
            </p>
            <p>
              A handle only pulls what the shape can say. A tube&apos;s radius is its width and its
              depth at once, so pulling one side of a tube makes a fatter tube rather than an oval;
              any handle on a ball makes a bigger ball. <strong>Stretch</strong>, further down, is a
              plain multiplier for the few things that have no number to land in — resizing several
              different shapes at once, mostly — and normally reads 1.00.
            </p>
          </section>

          <section>
            <h3>Variables</h3>
            <p>
              Any number can be promoted to a named variable and then reused by other shapes, so
              one value drives the whole build. Open <strong>Variables</strong> in the top bar, or
              use the link button beside a number to make one from what&apos;s already there. Drag
              the variable and everything following it moves at once.
            </p>
            <p>
              A number that follows a variable can&apos;t be changed by dragging the block — the
              variable is where it lives now, and BabyCAD will say so rather than quietly let the
              two drift apart.
            </p>
          </section>

          <section>
            <h3>Files and tabs</h3>
            <p>
              A build is a file. <strong>Save</strong> writes a <strong>.babycad</strong> wherever
              you keep your things and <strong>Open</strong> reads one back — no account, no
              server, nothing uploaded, and nothing kept in the browser for a cleared cache to
              take away. <strong>Save as…</strong> is under the arrow beside Save.
              <em> Ctrl/⌘ + S</em> saves, <em>Ctrl/⌘ + O</em> opens.
            </p>
            <p>
              Several builds can be open at once, one per <strong>tab</strong> along the top. Each
              keeps its own undo history. A dot on a tab means it has changes that aren&apos;t in
              a file yet; double-click a tab&apos;s name to rename it. Your open tabs come back
              after a refresh, but that is a safety net, not a filing cabinet — the file is the
              thing that lasts.
            </p>
            <p>
              <strong>Export</strong> is for taking a build somewhere else:{' '}
              <strong>.glb</strong> keeps the colours for a 3D viewer, and <strong>.stl</strong>{' '}
              is the one for a printer.
            </p>
          </section>

          <section>
            <h3>Keyboard</h3>
            <dl className="help-keys">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys}>
                  <dt>{keys}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <div className="help-contact">
          <a className="help-link" href={ISSUES_URL} target="_blank" rel="noreferrer noopener">
            <BugIcon size={22} stroke="#FF7A6B" />
            <span>
              <b>Something broken?</b>
              <em>Open an issue on the tracker — that&apos;s where bugs get fixed.</em>
            </span>
            <ExternalIcon size={16} stroke="#59627A" />
          </a>

          <a className="help-link" href={FEEDBACK_MAILTO}>
            <MailIcon size={22} stroke="#C8B6FF" />
            <span>
              <b>Ideas, or just want to say something?</b>
              <em>{FEEDBACK_EMAIL}</em>
            </span>
          </a>

          <a className="help-link" href={REPO_URL} target="_blank" rel="noreferrer noopener">
            <GithubIcon size={20} fill="#C3CAD9" />
            <span>
              <b>The source</b>
              <em>github.com/theanam/babycad — all of it, including this sheet.</em>
            </span>
            <ExternalIcon size={16} stroke="#59627A" />
          </a>
        </div>

        <div className="modal-foot">
          <div className="note">
            New to it? The <strong>welcome screen</strong> has a few example builds worth taking
            apart.
          </div>
          <button className="foot-btn" onClick={onShowWelcome} title="Show the welcome screen">
            Show me the examples
          </button>
        </div>
      </div>
    </div>
  )
}
