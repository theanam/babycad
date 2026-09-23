/**
 * Somewhere for a crash to stop.
 *
 * React's rule is blunt: an error thrown while rendering unmounts the whole
 * tree unless a boundary catches it. Without one, a single block the app
 * cannot draw takes the toolbar, the tabs and the plate with it, and what is
 * left is a white page — no way back, and no way to save the afternoon's work.
 * That is what picking certain typefaces used to do.
 *
 * The cause of that one is fixed where it belongs, in the builder. This is the
 * net underneath: whatever goes wrong next, it should cost the part that went
 * wrong and not the build. So there are four of these, at four sizes:
 *
 *   one block          it vanishes and the rest of the scene carries on
 *   the 3D view        the panels stay, with a way to start the view again
 *   the panel rail     the plate stays, with the same
 *   the whole app      the last resort, which offers to save the work first
 *
 * A boundary only catches what happens during rendering. Anything thrown from
 * a click handler or a promise never unmounts anything, and those are handled
 * where they happen — see the try/catch around every file and export action.
 */
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Worth a real console entry: this is the only trace a crash leaves, and
    // somebody reporting it will be asked what it said.
    console.error(`BabyCAD — ${this.props.what ?? 'something'} stopped working:`, error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const retry = () => this.setState({ error: null })
    return this.props.fallback ? this.props.fallback(error, retry) : null
  }
}
