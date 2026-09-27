import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useScene } from '../../scene/sceneStore'
import { flattenSketch, ringsOfNode } from '../../shapes/sketch/flatten'
import { useUnion, warmUnion } from '../../shapes/sketch/union'
import { digestSketch, isEmptySketch, normalizeSketch } from '../../shapes/sketch/doc'
import {
  addNode,
  applyDimension,
  boundsOf,
  circleFrom,
  dimensionsOf,
  drawingLine,
  handlesOf,
  moveHandle,
  canClose,
  nodeAt,
  pathFrom,
  polyFrom,
  rectFrom,
  removeNode,
  replaceNode,
  translateNode,
  TOUCH_MM,
} from './nodes'
import { fitView, gridLines, PLATE_BOX, snapPoint, toDrawing, toScreen, zoomAt } from './view'
import {
  dropTrace,
  fitPhoto,
  keepTrace,
  movePhoto,
  photoHandles,
  PHOTO_TYPES,
  resizePhoto,
  tracedFor,
} from './trace'
import { CloseIcon, PhotoIcon, RedoIcon, ResetIcon, TrashIcon, UndoIcon } from '../icons'

/**
 * The drawing board: a flat sketch, in millimetres, that becomes a solid.
 *
 * A small app inside the app, and deliberately small. It draws boxes,
 * circles, runs of lines and bezier curves, it lets you type any measurement
 * on screen, and it has no constraints, no layers and no boolean operations —
 * this is for somebody who wants a bracket with two holes in it. See
 * `docs/sketches.md`.
 *
 * **SVG, not a canvas.** Hit-testing per element for free, lines that stay
 * crisp at any zoom, and — the one that decided it — measurements that can be
 * ordinary DOM inputs sitting over the picture, rather than a text field
 * rebuilt from scratch on a canvas.
 *
 * **What is drawn is what gets built.** Every outline comes out of
 * `flattenSketch`, the same call the builder makes, so the shaded area on
 * screen is the solid, the holes are the holes, and an outline that will be
 * left out is already showing as left out. There is no second renderer here
 * with its own opinion about where a curve goes.
 *
 * **Undo is local and the whole session is one command.** Every line drawn,
 * point nudged and number typed goes on a stack that lives and dies with this
 * overlay; Done writes the drawing to the block once. Pushing each stroke onto
 * the scene's history would mean twenty presses of Ctrl-Z to get back to
 * before you opened it, which is not what anybody means by undoing a drawing.
 */

/** How far a label sits off the thing it measures, in pixels. */
const LABEL_OFF = 22
/** Past this many outlines only the selected one is measured, or it is a wall of numbers. */
const LABEL_ALL_UNDER = 9
/** A click has to land this near a handle, in pixels, to be a grab at it. */
const HANDLE_PX = 11

const TOOLS = [
  {
    id: 'select',
    key: 'V',
    label: 'Pick',
    hint: 'Pick an outline, drag it, or drag a corner — drag bare board to move the view',
  },
  { id: 'line', key: 'L', label: 'Lines', hint: 'Click corner after corner — click the first one again to close it' },
  {
    id: 'pen',
    key: 'P',
    label: 'Pen',
    hint: 'Click for a corner, or drag to curve it — click the first point again to close it',
  },
  { id: 'rect', key: 'R', label: 'Box', hint: 'Drag out a box' },
  { id: 'circle', key: 'C', label: 'Circle', hint: 'Drag out from the middle' },
]

const round = (n) => Math.round(n * 100) / 100
const show = (n) => String(round(n))

export default function SketchEditor({
  doc: initial,
  sides = 32,
  existing = false,
  touch = false,
  traceKey = 'new',
  onDone,
  onCancel,
}) {
  const [doc, setDoc] = useState(() => normalizeSketch(initial))
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [tool, setTool] = useState('select')
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ cx: 0, cy: 0, scale: 4 })
  const [free, setFree] = useState(false)
  // The photograph being traced over, if there is one. It is a backdrop, not
  // part of the drawing — see `./trace` for why it is kept in memory and
  // never written into the build.
  const [photo, setPhoto] = useState(() => tracedFor(traceKey))

  const board = useRef(null)
  const drag = useRef(null)
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const fitted = useRef(false)

  const snapEnabled = useScene((s) => s.snapEnabled)
  const snapStep = useScene((s) => s.snapStep)
  const step = snapEnabled && !free ? snapStep : 0

  /* --------------------------------------------------------- the board -- */

  useEffect(() => {
    const el = board.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Frame whatever was handed in, once the board has a size to frame it
  // against. Only once: re-framing on every edit would swim about under a
  // drag, which is the thing a drawing board must never do.
  useEffect(() => {
    if (fitted.current || !size.w) return
    fitted.current = true
    setView(fitView(boundsOfDoc(doc, sides), size))
  }, [size, doc, sides])

  useEffect(() => {
    keepTrace(traceKey, photo)
  }, [traceKey, photo])

  const at = useCallback((e) => toDrawing(view, size, ...local(board.current, e)), [view, size])
  const place = useCallback((point) => (step ? snapPoint(point, step) : point), [step])

  /* ----------------------------------------------------------- history -- */

  const remember = useCallback(() => {
    setPast((p) => [...p.slice(-99), doc])
    setFuture([])
  }, [doc])

  /** Go to another version of the drawing, letting go of a selection that is
   *  not in it — undoing the line you just drew must not leave the board
   *  holding an index into a shape that no longer exists. */
  const goTo = useCallback((next) => {
    setDoc(next)
    setSelected((at) => (at != null && at < next.nodes.length ? at : null))
  }, [])

  /** An edit, with one step of undo behind it. */
  const edit = useCallback(
    (next) => {
      if (digestSketch(next) === digestSketch(doc)) return
      remember()
      setDoc(next)
    },
    [doc, remember]
  )

  // Written out rather than folded into the updaters: an updater has to be
  // pure — React calls it twice in development to prove it — and one that
  // also pushed onto the other stack would push twice.
  const undo = useCallback(() => {
    if (!past.length) return
    setFuture((f) => [doc, ...f])
    goTo(past[past.length - 1])
    setPast(past.slice(0, -1))
  }, [doc, past, goTo])

  const redo = useCallback(() => {
    if (!future.length) return
    setPast((p) => [...p, doc])
    goTo(future[0])
    setFuture(future.slice(1))
  }, [doc, future, goTo])

  /* ------------------------------------------------------------- tools -- */

  // Overlapping outlines are folded into one before they are extruded, and
  // the board draws what will be built — so the moment Manifold is up, what
  // is on screen has to be worked out again. See `shapes/sketch/union`.
  const unionGeneration = useUnion((s) => s.generation)
  useEffect(() => {
    warmUnion()
  }, [])
  const flat = useMemo(() => flattenSketch(doc, sides), [doc, sides, unionGeneration])
  // A selection is an index, and undo can take the outline it pointed at out
  // from under it. Everything below reads the node rather than the index, so
  // this one `?? null` is the whole of the guard.
  const node = selected == null ? null : (doc.nodes[selected] ?? null)

  const removeSelected = useCallback(() => {
    if (selected == null) return
    edit(removeNode(doc, selected))
    setSelected(null)
  }, [doc, edit, selected])

  const finishLine = useCallback(
    (pts) => {
      setDraft(null)
      if (pts.length < 2) return
      edit(addNode(doc, polyFrom(pts)))
      setSelected(doc.nodes.length)
    },
    [doc, edit]
  )

  const finishPen = useCallback(
    (anchors, closed) => {
      setDraft(null)
      const made = pathFrom(anchors, closed)
      if (!made) return
      edit(addNode(doc, made))
      setSelected(doc.nodes.length)
    },
    [doc, edit]
  )

  /**
   * Open a photograph to draw over.
   *
   * Sized to the view it is landing in rather than to any number of
   * millimetres, because a JPEG does not say how big the thing in it is —
   * that is what scaling it against something you can measure is for.
   */
  const openPhoto = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = PHOTO_TYPES
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        setPhoto({
          url,
          fade: 0.55,
          box: fitPhoto({ w: img.naturalWidth, h: img.naturalHeight }, view, size),
        })
        setTool('photo')
      }
      // A file the browser will not draw is not a photo, whatever it is
      // called. Nothing is kept and nothing is said beyond not happening.
      img.onerror = () => URL.revokeObjectURL(url)
      img.src = url
    }, { once: true })
    input.addEventListener('cancel', () => input.remove(), { once: true })
    input.click()
  }, [view, size])

  const removePhoto = useCallback(() => {
    dropTrace(traceKey)
    setPhoto(null)
    setTool((t) => (t === 'photo' ? 'select' : t))
  }, [traceKey])

  const pickTool = useCallback((id) => {
    setDraft(null)
    setTool(id)
    if (id !== 'select') setSelected(null)
  }, [])

  /* ---------------------------------------------------------- pointers -- */

  const onPointerDown = (e) => {
    board.current?.focus()
    pointers.current.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.current.size === 2) return startPinch()

    // Two fingers, the middle button and the right button all mean the same
    // thing here as they do on the plate: move the view, don't change the
    // drawing.
    if (e.button === 1 || e.button === 2) {
      drag.current = { kind: 'pan', from: [e.clientX, e.clientY], view }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const point = at(e)

    if (tool === 'line') {
      const pts = draft?.pts ?? []
      const next = place(point)
      // Back to where it started closes the ring, which is how every drawing
      // program says "that's the shape".
      if (pts.length > 2 && near(pts[0], next, HANDLE_PX / view.scale)) return finishLine(pts)
      setDraft({ tool: 'line', pts: [...pts, next], to: next })
      return
    }

    // Moving the photo is a mode of its own rather than a tool in the row:
    // it is not a thing you draw with, and the row is for things you draw
    // with. It comes and goes with the photo it moves.
    if (tool === 'photo' && photo) {
      const grab = photoHandles(photo.box).find((h) => near(h, point, HANDLE_PX / view.scale))
      drag.current = grab
        ? { kind: 'photoSize', id: grab.id }
        : { kind: 'photoMove', last: point }
      return
    }

    if (tool === 'pen') {
      const anchors = draft?.anchors ?? []
      const next = place(point)
      if (canClose(anchors) && near(anchors[0], next, HANDLE_PX / view.scale)) {
        return finishPen(anchors, true)
      }
      // The anchor lands on the press; the drag that may follow pulls its
      // handle out, which is what turns the segment into a curve. Let go
      // without moving and it stays a corner.
      const laid = [...anchors, { ...next, hx: 0, hy: 0 }]
      drag.current = { kind: 'pen', anchor: laid.length - 1 }
      setDraft({ tool: 'pen', anchors: laid, to: next })
      return
    }

    if (tool === 'rect' || tool === 'circle') {
      const from = place(point)
      drag.current = { kind: 'draw', from }
      setDraft({ tool, from, to: from })
      return
    }

    // Picking. A handle on the shape already picked wins over the shapes
    // underneath it: the dots are small, and having to move the shape out of
    // its own way to grab its corner would be absurd.
    if (node) {
      const grab = handlesOf(node).find((h) => near(h, point, HANDLE_PX / view.scale))
      if (grab) {
        remember()
        drag.current = { kind: 'handle', id: grab.id, index: selected, moved: false }
        return
      }
    }
    // At least a millimetre, and at least eight pixels: a thin outline has to
    // stay clickable when the board is zoomed right out.
    const hit = nodeAt(doc, point, Math.max(TOUCH_MM, 8 / view.scale), sides)
    setSelected(hit)
    if (hit != null) {
      remember()
      drag.current = { kind: 'body', index: hit, last: place(point), moved: false }
      return
    }
    // Nothing under the press: a click lets go of what was picked, and a drag
    // moves the view. Middle and right drag do that too, but neither is a
    // gesture a trackpad makes willingly, and a board you cannot push around
    // is a board you have to zoom out of to get anywhere.
    drag.current = { kind: 'pan', from: [e.clientX, e.clientY], view }
  }

  const onPointerMove = (e) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, [e.clientX, e.clientY])
    }
    if (pinch.current && pointers.current.size >= 2) return movePinch()

    const held = drag.current
    if (!held) {
      if (draft?.tool === 'line' || draft?.tool === 'pen') setDraft({ ...draft, to: place(at(e)) })
      return
    }

    if (held.kind === 'pan') {
      const dx = (e.clientX - held.from[0]) / view.scale
      const dy = (e.clientY - held.from[1]) / view.scale
      setView({ ...held.view, cx: held.view.cx - dx, cy: held.view.cy + dy })
      return
    }

    if (held.kind === 'photoSize' || held.kind === 'photoMove') {
      const to = place(at(e))
      setPhoto((p) => {
        if (!p) return p
        if (held.kind === 'photoSize') return { ...p, box: resizePhoto(p.box, held.id, to) }
        const box = movePhoto(p.box, to.x - held.last.x, to.y - held.last.y)
        held.last = to
        return { ...p, box }
      })
      return
    }

    if (held.kind === 'pen') {
      // The handle is not snapped. A grid is about where things sit; how far
      // a curve bulges is not a number anybody wants rounded to the nearest
      // half millimetre.
      const raw = at(e)
      setDraft((d) => {
        const anchor = d?.anchors?.[held.anchor]
        if (!anchor) return d
        const anchors = d.anchors.map((a, i) =>
          i === held.anchor ? { ...a, hx: raw.x - a.x, hy: raw.y - a.y } : a
        )
        return { ...d, anchors, to: { x: anchor.x, y: anchor.y } }
      })
      return
    }

    const point = place(at(e))
    if (held.kind === 'draw') {
      setDraft({ tool, from: held.from, to: point })
    } else if (held.kind === 'handle') {
      held.moved = true
      setDoc((d) =>
        d.nodes[held.index] ? replaceNode(d, held.index, moveHandle(d.nodes[held.index], held.id, point)) : d
      )
    } else if (held.kind === 'body') {
      const dx = point.x - held.last.x
      const dy = point.y - held.last.y
      if (!dx && !dy) return
      held.last = point
      held.moved = true
      setDoc((d) =>
        d.nodes[held.index] ? replaceNode(d, held.index, translateNode(d.nodes[held.index], dx, dy)) : d
      )
    }
  }

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const held = drag.current
    drag.current = null
    if (!held) return
    // The pen keeps its run going between clicks; there is nothing to settle
    // on release beyond letting go of the handle it was pulling.
    if (held.kind === 'pen' || held.kind === 'photoSize' || held.kind === 'photoMove') return

    if (held.kind === 'draw') {
      const made = held.from && draft?.to ? shapeFrom(tool, held.from, draft.to) : null
      setDraft(null)
      if (made) {
        edit(addNode(doc, made))
        setSelected(doc.nodes.length)
        setTool('select')
      }
      return
    }
    // A press that turned out not to be a drag put a step on the stack that
    // undoes nothing. Take it back off rather than make somebody press
    // Ctrl-Z twice to get anywhere.
    if ((held.kind === 'body' || held.kind === 'handle') && !held.moved) {
      setPast((p) => p.slice(0, -1))
    }
  }

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]
    pinch.current = { gap: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: middle(a, b), view }
    drag.current = null
    setDraft(null)
  }

  const movePinch = () => {
    const [a, b] = [...pointers.current.values()]
    const gap = Math.hypot(a[0] - b[0], a[1] - b[1])
    const mid = middle(a, b)
    const start = pinch.current
    const panned = {
      ...start.view,
      cx: start.view.cx - (mid[0] - start.mid[0]) / start.view.scale,
      cy: start.view.cy + (mid[1] - start.mid[1]) / start.view.scale,
    }
    setView(zoomAt(panned, size, screenOf(board.current, mid), start.gap ? gap / start.gap : 1))
  }

  /* -------------------------------------------------------- the keyboard -- */

  useEffect(() => {
    const down = (e) => {
      if (e.key === 'Alt') setFree(true)
      if (e.target instanceof HTMLInputElement) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        // One key, backing out one step at a time, most local first: the
        // shape being drawn, then the tool holding it, then the selection.
        // Pressing it twice from a half-drawn line puts the mouse back to
        // picking things — which is where you were before you reached for
        // the tool, and is what Escape means everywhere else in the app.
        if (draft) setDraft(null)
        else if (tool !== 'select') pickTool('select')
        else if (selected != null) setSelected(null)
      } else if (e.key === 'Enter') {
        if (draft?.tool === 'line') finishLine(draft.pts)
        else if (draft?.tool === 'pen') finishPen(draft.anchors, true)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
      } else if (!meta) {
        const found = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase())
        if (found) pickTool(found.id)
      }
    }
    const up = (e) => e.key === 'Alt' && setFree(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [draft, selected, tool, undo, redo, removeSelected, finishLine, finishPen, pickTool])

  /* --------------------------------------------------------- the picture -- */

  const px = (x, y) => toScreen(view, size, x, y)
  const grid = useMemo(() => gridLines(view, size, step || 5), [view, size, step])
  const plate = { a: px(PLATE_BOX.minX, PLATE_BOX.maxY), b: px(PLATE_BOX.maxX, PLATE_BOX.minY) }
  const box = boundsOfDoc(doc, sides)

  const labels = []
  const labelled = doc.nodes.length <= LABEL_ALL_UNDER ? doc.nodes.map((_, i) => i) : []
  if (node && !labelled.includes(selected)) labelled.push(selected)
  for (const i of labelled) {
    for (const d of dimensionsOf(doc.nodes[i], sides, i === selected)) {
      const p = px(d.x, d.y)
      labels.push({ ...d, index: i, left: p.x + d.ox * LABEL_OFF, top: p.y + d.oy * LABEL_OFF })
    }
  }

  /* The line being drawn says how long it is and what corner it is making,
     which are the two things being decided at that moment. A readout, not a
     field: the shape does not exist yet, so there is nothing to type into —
     and the moment the run is closed every segment gets a length you can. */
  const live = liveReadout(draft).map((d) => {
    const p = px(d.x, d.y)
    return { ...d, left: p.x + d.ox * LABEL_OFF, top: p.y + d.oy * LABEL_OFF }
  })

  const hint = draft?.tool === 'line'
    ? 'Click the first corner again to close it, or press Enter'
    : TOOLS.find((t) => t.id === tool)?.hint

  /* The tools go in the head with a mouse and along the bottom with a thumb,
     which is the same call the shape rail and the properties rail already
     make — the half of a handheld a thumb reaches is the bottom half. It is
     one strip either way; only where it is put changes. */
  const tools = (
    <div className="sketch-tools" role="group" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`sketch-tool${tool === t.id ? ' on' : ''}`}
          onClick={() => pickTool(t.id)}
          aria-pressed={tool === t.id}
          // What it does, not what it is called — the name is already on the
          // button. The hint at the corner of the board only ever describes
          // the tool already in hand, so this is the only way to find out
          // what another one is for without picking it up.
          title={`${t.hint} (${t.key})`}
        >
          <ToolMark id={t.id} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="scrim sketch-scrim">
      <div className="sketch" role="dialog" aria-label="Drawing board">
        <div className="sketch-head">
          <div className="modal-title">Drawing</div>
          {!touch && tools}
          <div className="sketch-acts">
            <button className="sketch-act" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
              <UndoIcon size={18} stroke="#8A93A5" />
            </button>
            <button
              className="sketch-act"
              onClick={redo}
              disabled={!future.length}
              title="Redo (Shift+Ctrl+Z)"
            >
              <RedoIcon size={18} stroke="#8A93A5" />
            </button>
            <button
              className="sketch-act"
              onClick={removeSelected}
              disabled={selected == null}
              title="Remove this outline (Delete)"
            >
              <TrashIcon size={18} stroke="#8A93A5" />
            </button>
            <button
              className={`sketch-act${photo ? ' on' : ''}`}
              onClick={openPhoto}
              title={photo ? 'Open a different photo to trace over' : 'Open a photo to trace over'}
            >
              <PhotoIcon size={18} stroke={photo ? '#C8B6FF' : '#8A93A5'} />
            </button>
            <button
              className="sketch-act"
              onClick={() => setView(fitView(boundsOfDoc(doc, sides), size))}
              title="Fit the drawing on screen"
            >
              <ResetIcon size={18} stroke="#8A93A5" />
            </button>
          </div>
          <button className="modal-close" onClick={onCancel} title="Close without keeping this" aria-label="Close">
            <CloseIcon stroke="#8A93A5" />
          </button>
        </div>

        {/* Only while there is a photo, and gone the moment there isn't:
            three controls that mean nothing without one. */}
        {photo && (
          <div className="sketch-trace">
            <PhotoIcon size={16} stroke="#8A93A5" />
            <button
              className={`sketch-tool small${tool === 'photo' ? ' on' : ''}`}
              onClick={() => setTool(tool === 'photo' ? 'select' : 'photo')}
              aria-pressed={tool === 'photo'}
              title="Drag the photo about, or drag a corner to size it"
            >
              Move &amp; size
            </button>
            <label className="sketch-fade" title="How much of the photo shows through">
              Fade
              <input
                className="param-slider"
                type="range"
                min="0.08"
                max="1"
                step="0.02"
                value={photo.fade}
                onChange={(e) => setPhoto((p) => ({ ...p, fade: Number(e.target.value) }))}
              />
            </label>
            <span className="sketch-trace-size">
              {show(photo.box.w)} × {show(photo.box.h)} mm
            </span>
            <button className="sketch-act" onClick={removePhoto} title="Take the photo away">
              <TrashIcon size={16} stroke="#8A93A5" />
            </button>
          </div>
        )}

        <div
          className={`sketch-board tool-${tool}`}
          ref={board}
          tabIndex={-1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => {
            const [x, y] = local(board.current, e)
            setView((v) => zoomAt(v, size, { x, y }, e.deltaY < 0 ? 1.12 : 1 / 1.12))
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg width={size.w} height={size.h} aria-hidden="true">
            <g className="sketch-grid">
              {grid.fine.x.map((x) => (
                <line key={`fx${x}`} x1={px(x, 0).x} y1={0} x2={px(x, 0).x} y2={size.h} />
              ))}
              {grid.fine.y.map((y) => (
                <line key={`fy${y}`} x1={0} y1={px(0, y).y} x2={size.w} y2={px(0, y).y} />
              ))}
            </g>
            <g className="sketch-grid coarse">
              {grid.coarse.x.map((x) => (
                <line key={`cx${x}`} x1={px(x, 0).x} y1={0} x2={px(x, 0).x} y2={size.h} />
              ))}
              {grid.coarse.y.map((y) => (
                <line key={`cy${y}`} x1={0} y1={px(0, y).y} x2={size.w} y2={px(0, y).y} />
              ))}
            </g>
            <rect
              className="sketch-plate"
              x={plate.a.x}
              y={plate.a.y}
              width={plate.b.x - plate.a.x}
              height={plate.b.y - plate.a.y}
            />
            <g className="sketch-axes">
              <line x1={0} y1={px(0, 0).y} x2={size.w} y2={px(0, 0).y} />
              <line x1={px(0, 0).x} y1={0} x2={px(0, 0).x} y2={size.h} />
            </g>

            {/* Over the grid and under the drawing: a backdrop is something
                you draw on top of, and the lines you are tracing have to be
                the clearest thing on the board. */}
            {photo && (
              <image
                href={photo.url}
                opacity={photo.fade}
                x={px(photo.box.x, photo.box.y + photo.box.h).x}
                y={px(photo.box.x, photo.box.y + photo.box.h).y}
                width={photo.box.w * view.scale}
                height={photo.box.h * view.scale}
                preserveAspectRatio="none"
              />
            )}

            {/* The solid itself, holes and all — the same islands the builder
                extrudes, so this is a picture of the part and not a sketch of
                one. */}
            {flat.islands.map((island, i) => (
              <path key={`i${i}`} className="sketch-solid" fillRule="evenodd" d={islandPath(island, px)} />
            ))}

            {flat.rings.map((ring, i) => (
              <path
                key={`r${i}`}
                className={`sketch-ring ${ring.state}${ring.node === selected ? ' picked' : ''}`}
                d={ringPath(ring.pts, px, ring.state !== 'open')}
              />
            ))}

            {draft && <path className="sketch-draft" d={draftPath(draft, px, sides)} />}
            {/* The handle being pulled, drawn through its anchor: a curve
                whose controls you cannot see is a curve you are guessing at. */}
            {penHandle(draft).map(({ key, a, b }) => (
              <g key={key} className="sketch-pull">
                <line x1={px(a.x, a.y).x} y1={px(a.x, a.y).y} x2={px(b.x, b.y).x} y2={px(b.x, b.y).y} />
                <circle cx={px(b.x, b.y).x} cy={px(b.x, b.y).y} r={3.5} />
              </g>
            ))}

            {tool === 'photo' &&
              photo &&
              photoHandles(photo.box).map((h) => {
                const p = px(h.x, h.y)
                return <circle key={h.id} className="sketch-handle" cx={p.x} cy={p.y} r={5} />
              })}

            {node &&
              handlesOf(node).map((h) => {
                const p = px(h.x, h.y)
                return <circle key={h.id} className="sketch-handle" cx={p.x} cy={p.y} r={5} />
              })}
          </svg>

          {/* The measurements sit inside the board, so a press on one would
              otherwise also be a press on whatever is behind it — picking a
              different outline out from under the number being typed. */}
          <div className="sketch-labels" onPointerDown={(e) => e.stopPropagation()}>
            {live.map((d) => (
              <span
                key={d.key}
                className="sketch-dim live"
                style={{ left: d.left, top: d.top }}
                title={d.unit === '°' ? 'The corner this makes with the last line' : 'How long this line is'}
              >
                {/* An angle to a tenth: two decimals of a degree is a number
                    nobody is aiming at, and it makes the label twitch. */}
                {d.unit === '°' ? `${Math.round(d.value * 10) / 10}°` : show(d.value)}
              </span>
            ))}
            {labels.map((d) => (
              <Dim
                key={`${d.index}.${d.key}`}
                dim={d}
                onCommit={(value) =>
                  edit(replaceNode(doc, d.index, applyDimension(doc.nodes[d.index], d.key, value, sides)))
                }
              />
            ))}
          </div>

          <div className="sketch-hint">{hint}</div>
        </div>

        {touch && tools}

        <div className="sketch-foot">
          <span className="sketch-size">
            {box ? `${show(box.width)} × ${show(box.height)} mm` : 'Nothing drawn yet'}
            {dropNote(flat.dropped)}
          </span>
          <span className="sketch-snap">{step ? `Snapping to ${step} mm` : 'No snapping'}</span>
          <button
            className="foot-btn"
            onClick={onCancel}
            title={existing ? 'Close, leaving the drawing as it was' : 'Close without putting anything down'}
          >
            Cancel
          </button>
          <button
            className="foot-btn primary"
            onClick={() => onDone(doc)}
            disabled={!existing && isEmptySketch(doc)}
            title={existing ? 'Keep this drawing' : 'Put this on the plate'}
          >
            {existing ? 'Done' : 'Put it on the plate'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- bits -- */

/**
 * One measurement, sitting over the picture.
 *
 * A button until it is pressed and an input afterwards, rather than an input
 * throughout: a board covered in boxes with borders reads as a form, and this
 * is a drawing with numbers on it.
 */
function Dim({ dim, onCommit }) {
  const [editing, setEditing] = useState(false)
  const style = { left: dim.left, top: dim.top }

  if (!editing) {
    return (
      <button
        className="sketch-dim"
        style={style}
        onClick={() => setEditing(true)}
        title={`${dim.label} — click to type it`}
      >
        {show(dim.value)}
      </button>
    )
  }
  return (
    <input
      className="sketch-dim editing"
      style={style}
      type="text"
      inputMode="decimal"
      autoFocus
      defaultValue={show(dim.value)}
      aria-label={dim.label}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.currentTarget.value = ''
          e.currentTarget.blur()
        }
        e.stopPropagation()
      }}
      onBlur={(e) => {
        const n = parseFloat(e.target.value)
        setEditing(false)
        if (Number.isFinite(n) && n !== dim.value) onCommit(n)
      }}
    />
  )
}

/** The little picture on a tool button. Drawn rather than an icon import,
 *  because each one is two shapes and they only exist here. */
function ToolMark({ id }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true }
  if (id === 'rect') return <svg {...common}><rect x="2.5" y="4.5" width="13" height="9" stroke="currentColor" strokeWidth="1.6" /></svg>
  if (id === 'circle') return <svg {...common}><circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.6" /></svg>
  if (id === 'line') return <svg {...common}><path d="M3 14 L7 5 L12 11 L15 6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>
  // The pen nib every vector editor has used for thirty years: the tip at the
  // top-left corner, the slit running back from it, and the vent hole. Drawn
  // on the 24 grid the rest of the app's icons use rather than this file's
  // 18, because that is the grid the shape was designed on.
  if (id === 'pen') return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3 L16.4 6.6 L18 12.6 L12.6 18 L6.6 16.4 Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path d="M3 3 L9.2 9.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="11.2" cy="11.2" r="2.1" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  )
  return <svg {...common}><path d="M4 2.5 L4 14 L7.2 11 L9.4 15.5 L11.6 14.4 L9.4 10.2 L13.5 9.8 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
}

const local = (el, e) => {
  const rect = el?.getBoundingClientRect()
  return [e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0)]
}
const screenOf = (el, [x, y]) => {
  const rect = el?.getBoundingClientRect()
  return { x: x - (rect?.left ?? 0), y: y - (rect?.top ?? 0) }
}
const middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const near = (a, b, within) => Math.hypot(a.x - b.x, a.y - b.y) <= within

function boundsOfDoc(doc, sides) {
  let box = null
  for (const node of doc.nodes) {
    const b = boundsOf(node, sides)
    if (!b) continue
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : { ...b }
  }
  if (!box) return null
  return { ...box, width: box.maxX - box.minX, height: box.maxY - box.minY }
}

/** Rings arrive in the extruder's plane, where y is the other way up. */
function ringPath(pts, px, close) {
  if (!pts.length) return ''
  let d = ''
  for (let i = 0; i < pts.length; i++) {
    const p = px(pts[i].x, -pts[i].y)
    d += `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  }
  return close ? `${d}Z` : d
}

const islandPath = (island, px) =>
  ringPath(island.contour, px, true) + island.holes.map((h) => ringPath(h, px, true)).join('')

/**
 * What the tool in hand is telling you, right now.
 *
 * Lines gets a length and the corner it is making. The pen gets the length of
 * the chord it is spanning and, when both ends of it are corners rather than
 * curves, the corner too — on a curved segment the straight-line angle
 * between the anchors is not the angle you can see, and a number that does
 * not match the picture is worse than no number.
 */
function liveReadout(draft) {
  if (draft?.tool === 'line') return drawingLine(draft.pts, draft.to)
  if (draft?.tool !== 'pen') return []
  const anchors = draft.anchors ?? []
  if (!anchors.length) return []
  const straight = anchors.slice(-2).every((a) => Math.hypot(a.hx, a.hy) < 1e-6)
  return drawingLine(anchors, draft.to, { angle: straight })
}

/** The handle being pulled out of an anchor, both ways, as the pen draws. */
function penHandle(draft) {
  if (draft?.tool !== 'pen') return []
  const out = []
  for (const a of draft.anchors ?? []) {
    if (Math.hypot(a.hx, a.hy) < 1e-6) continue
    out.push({ key: `h${a.x},${a.y}`, a, b: { x: a.x + a.hx, y: a.y + a.hy } })
    out.push({ key: `i${a.x},${a.y}`, a, b: { x: a.x - a.hx, y: a.y - a.hy } })
  }
  return out
}

function draftPath(draft, px, sides) {
  if (draft.tool === 'pen') {
    // Flattened by the same function the builder flattens with, so the curve
    // on screen while it is being drawn is the curve that gets made.
    const anchors = draft.to ? [...draft.anchors, { ...draft.to, hx: 0, hy: 0 }] : draft.anchors
    const node = pathFrom(dedupe(anchors), false)
    if (!node) return ''
    const [ring] = ringsOfNode(node, sides)
    return ring ? ringPath(ring.pts, px, false) : ''
  }
  if (draft.tool === 'line') {
    const pts = [...draft.pts, draft.to].filter(Boolean)
    return pts
      .map((p, i) => {
        const s = px(p.x, p.y)
        return `${i ? 'L' : 'M'}${s.x.toFixed(2)} ${s.y.toFixed(2)}`
      })
      .join('')
  }
  const made = shapeFrom(draft.tool, draft.from, draft.to)
  if (!made) return ''
  if (made.kind === 'rect') {
    const a = px(made.x, made.y + made.h)
    const b = px(made.x + made.w, made.y)
    return `M${a.x} ${a.y}H${b.x}V${b.y}H${a.x}Z`
  }
  const c = px(made.cx, made.cy)
  const r = Math.abs(px(made.cx + made.r, made.cy).x - c.x)
  return `M${c.x - r} ${c.y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`
}

/** The rubber-band point sits on the last anchor while its handle is being
 *  pulled; drawn twice over it would make a zero-length segment. */
const dedupe = (anchors) => {
  const last = anchors[anchors.length - 1]
  const before = anchors[anchors.length - 2]
  if (before && Math.hypot(last.x - before.x, last.y - before.y) < 1e-6) return anchors.slice(0, -1)
  return anchors
}

/** A tool's two points as the node it would make, or null if it is nothing. */
function shapeFrom(tool, from, to) {
  if (!from || !to) return null
  if (tool === 'rect') {
    const made = rectFrom(from, to)
    return made.w > 0.05 && made.h > 0.05 ? made : null
  }
  if (tool === 'circle') {
    const made = circleFrom(from, to)
    return made.r > 0.05 ? made : null
  }
  return null
}

/** What was left out, said plainly, so a missing outline is not a mystery. */
function dropNote({ open, crossing, tiny }) {
  const said = []
  if (open) said.push(`${open} unclosed`)
  if (crossing) said.push(`${crossing} crossing itself`)
  if (tiny) said.push(`${tiny} too small`)
  return said.length ? ` · ${said.join(', ')} left out` : ''
}
