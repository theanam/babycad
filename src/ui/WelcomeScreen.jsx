import { useEffect } from 'react'
import { EXAMPLES } from '../examples'
import { REPO_URL } from '../links'
import ExampleArt from './ExampleArt'
import { BlankIcon, GithubIcon, HelpIcon, OpenIcon } from './icons'

/**
 * The first thing a new visitor sees: what this is, and three ways in.
 *
 * It takes over the screen rather than sitting in a modal over the yard,
 * because on a first visit there is nothing behind it worth looking at. It is
 * still dismissible — Escape, or the backdrop — and dismissing it is the same
 * as choosing a blank build, since that is what is already underneath.
 */
export default function WelcomeScreen({ onBlank, onExample, onHelp, onOpenFile }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onBlank()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBlank])

  return (
    <div
      className="welcome"
      role="dialog"
      aria-label="Welcome to BabyCAD"
      onPointerDown={(e) => e.target === e.currentTarget && onBlank()}
    >
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

        <button className="welcome-blank" onClick={onBlank}>
          <i aria-hidden="true">
            <BlankIcon size={26} stroke="#C8B6FF" />
          </i>
          <span>
            <b>Start with an empty plate</b>
            <em>200 × 200 mm, nothing on it. Pick a shape from the rail and go.</em>
          </span>
        </button>

        <button className="welcome-blank welcome-open" onClick={onOpenFile}>
          <i aria-hidden="true">
            <OpenIcon size={24} stroke="#8A93A5" />
          </i>
          <span>
            <b>Open a build you already have</b>
            <em>A .babycad file from your computer. Builds are files here — nothing is kept in the browser.</em>
          </span>
        </button>

        <div className="welcome-or">or open one of these</div>

        <div className="welcome-examples">
          {EXAMPLES.map((example) => (
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
