import { useEffect } from 'react'
import { EXAMPLES } from '../examples'
import { REPO_URL } from '../links'
import ExampleArt from './ExampleArt'
import { BlankIcon, GithubIcon, HelpIcon, OpenIcon } from './icons'

/** The three that exist to show the app off, and the rest, which are objects. */
const FEATURED = EXAMPLES.filter((e) => e.feature)
const THINGS = EXAMPLES.filter((e) => !e.feature)

/**
 * The first thing a new visitor sees: what this is, and three ways in.
 *
 * It takes over the screen rather than sitting in a modal over the yard,
 * because on a first visit there is nothing behind it worth looking at. That
 * is also why the backdrop does not dismiss it: with nothing to go back to,
 * clicking past it is a slip rather than an intention.
 *
 * A blank build is made by one thing only — the button that says so. Escape
 * puts the screen away, which on a first visit leaves it up, because with no
 * document open there is nothing behind it to reveal.
 */
export default function WelcomeScreen({ onBlank, onDismiss, onExample, onHelp, onOpenFile }) {
  useEffect(() => {
    // Escape puts the screen away; it does not start a build. Getting out of
    // the way of something and asking for a new document are different things,
    // and only the button on this page means the second one.
    const onKey = (e) => e.key === 'Escape' && onDismiss()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    // Deliberately nothing on the backdrop. It used to start a blank build on
    // `pointerdown` anywhere it showed, on the reasoning that the screen is an
    // overlay and a blank plate is what sits behind it. Two things were wrong
    // with that. `pointerdown` fires on the way *down*, so a press that was
    // going to become a drag — or the start of a scroll — committed before it
    // could be taken back. And this is a first-run screen rather than a sheet
    // over something: there is nothing visible behind it, so "dismiss" has no
    // meaning to read, and a stray click silently made a document instead.
    //
    // Escape still dismisses, which is the shortcut somebody presses on
    // purpose, and every other way out of here is a button.
    <div className="welcome" role="dialog" aria-label="Welcome to BabyCAD">
      <div className="welcome-sheet">
        <div className="welcome-head">
          <div className="brand-mark welcome-mark" aria-hidden="true">
            <i /><i /><i />
          </div>
          <h1>BabyCAD</h1>
          <p>
            A 3D building yard that runs entirely in this browser. Drop shapes on the plate, give
            them real millimetres, and take the result away as a model or a printable file.
            There&apos;s no account, no cloud, and your builds are ordinary files you keep
            wherever you like.
          </p>
        </div>

        {/* The two ways in sit side by side. Stacked, they pushed everything
            worth looking at below the fold on a laptop. */}
        <div className="welcome-ways">
          <button className="welcome-blank" onClick={onBlank}>
            <i aria-hidden="true">
              <BlankIcon size={26} stroke="#C8B6FF" />
            </i>
            <span>
              <b>Start with an empty plate</b>
              <em>Nothing on it, and millimetres from the first block.</em>
            </span>
          </button>

          <button className="welcome-blank welcome-open" onClick={onOpenFile}>
            <i aria-hidden="true">
              <OpenIcon size={24} stroke="#8A93A5" />
            </i>
            <span>
              <b>Open a build you have</b>
              <em>A .babycad file from your computer.</em>
            </span>
          </button>
        </div>

        <div className="welcome-or">or start from one of these</div>

        <div className="welcome-examples">
          {FEATURED.map((example) => (
            <button
              key={example.id}
              className="welcome-example"
              onClick={() => onExample(example.id)}
              title={`Open the ${example.name.toLowerCase()} — ${example.blurb}`}
            >
              <ExampleArt id={example.id} />
              <span className="welcome-example-meta">
                <b>{example.name}</b>
                <em>{example.blurb}</em>
                <i>shows off {example.teaches}</i>
              </span>
            </button>
          ))}
        </div>

        {/* Name and picture only. Nineteen cards each explaining themselves is
            a wall of text nobody reads; the blurb is a breath away on hover. */}
        <div className="welcome-or">things to print</div>

        <div className="welcome-things">
          {THINGS.map((example) => (
            <button
              key={example.id}
              className="welcome-thing"
              onClick={() => onExample(example.id)}
              title={`Open the ${example.name.toLowerCase()} — ${example.blurb}`}
            >
              <ExampleArt id={example.id} />
              <b>{example.name}</b>
            </button>
          ))}
        </div>

        <div className="welcome-foot">
          <button className="foot-btn" style={{ marginLeft: 0 }} onClick={onHelp}>
            <HelpIcon size={20} stroke="#C8B6FF" />
            How this works
          </button>
          <a
            className="foot-btn"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="BabyCAD on GitHub — source, issues and releases"
          >
            <GithubIcon size={18} fill="#8A93A5" />
            Source on GitHub
          </a>
        </div>
      </div>
    </div>
  )
}
