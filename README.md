# BabyCAD

A 3D building sandbox for kids that runs entirely in the browser. No backend,
no login, no accounts — nothing you build ever leaves your device.

Built from `babycad-engineering-spec.md` and the "BabyCAD UI" design doc.

## Running it

```bash
npm install
npm run dev           # http://localhost:5180
npm run build         # static bundle in dist/
npm run preview       # serve the built bundle
npm run check:shapes  # build every shape across its parameter range
```

## Deploying

`.github/workflows/deploy.yml` builds on every push to `main` and publishes
`dist/` to GitHub Pages. Enable it once under **Settings → Pages → Source →
GitHub Actions**. The Vite `base` is `./`, so the same bundle works at a user
site or a project site without hardcoding the repo name.

## Controls

| | |
|---|---|
| Orbit | drag empty space (one finger) — pivots on whatever is under the cursor |
| Zoom | scroll — zooms towards the cursor; pinch on touch |
| Pan | right-drag, or two-finger drag |
| Add a block | tap a shape in the left tray — it lands where the camera is looking |
| Change what it *is* | the shape's own numbers, at the top of the properties panel |
| Share a number | the `{}` beside any setting — make it a variable, or point it at one |
| All the variables | **Variables** in the top bar — rename them, retype them, drag them |
| Select | tap a block; tap empty space to deselect |
| Multi-select | shift-click, or turn on **Pick many** for touch |
| Move | drag the block itself along the floor |
| Lift | drag the cone above the box |
| Resize | drag a bottom corner handle (grows from the opposite corner) |
| Height | drag the handle on top of the box |
| Turn | swing one of the three balls on sticks — red X, green Y, blue Z |
| Exact numbers | type them into the properties panel on the right |
| Free movement | hold `Alt` while dragging, or switch **Snap** off |
| Undo / redo | `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z` |
| Duplicate | `Cmd/Ctrl+D` |
| Delete | `Delete` / `Backspace` |
| Look from a side | tap a face on the view cube (bottom left) |
| Turn the view | drag the view cube |
| Reset view | the ↻ button under the view cube, or **HOME** in the tray |
| Fit | the ⛶ button — frames the selection, or the whole build |
| Corner view | the cube button — back to three-quarter, same distance |

## How it fits together

```
src/
  shapes/
    index.js          the registry: every shape, its parameters, its builder
    extrude.js        2D contour -> solid, with twist and crease smoothing
    geometryCache.js  reference-counted geometry, keyed on type + parameters
    params.js         parameter specs, coercion, and variable compatibility
    builders/
      primitives.js   cube, ball, cone, tube, pyramid, donut, ramp, pipe, star
      gear.js         involute spur / helical gear
      thread.js       ISO metric screw thread
      spring.js       coil and torus knot
  scene/
    variables.js      named values, bindings, and re-resolving them
    Viewport.jsx      R3F canvas, lights, grid, shadows
    SceneObject.jsx   one shape; holds a reference on its cached geometry
    BoxGizmo.jsx      the bounding box and every handle on it
    gizmoMath.js      ray/line/plane maths the gizmo leans on
    sceneStore.js     the scene graph + selection (zustand)
    liveStore.js      transient drag state, kept out of the scene store
    meshRegistry.js   id -> live mesh, so drags can bypass React
    dragBus.js        lets a block hand a body-drag to the gizmo
  ui/
    ParamMenu.jsx     the {} beside every setting: make a variable, or use one
    VariablesModal.jsx  the whole list, with values you can drag
    ViewCube.jsx      orientation cube, axis triad and camera buttons
    ...               the rest of the DOM chrome
  io/
    persistence.js    localStorage save/load
    exporters.js      GLB / STL / JSON
  history/
    undoRedo.js       command pattern; every command carries its own inverse
tools/
  check-shapes.mjs    builds every shape at every extreme of its parameters
```

### Shapes

**Every shape is parametric, and the registry is the only place that knows
it.** A shape definition in `src/shapes/index.js` is a type, a label, a list of
parameter specs and a `build(params)`. The tray, the properties panel, the
geometry cache, persistence, undo and both exporters are all driven off that
list — adding a shape means adding one entry and one icon, and nothing else.

**Defaults reproduce the pre-parametric geometry exactly.** The six original
primitives had fixed dimensions baked into their builders; those numbers are
now the defaults. That is what makes the v1 → v2 scene migration a no-op
visually: a saved build with no `params` at all reopens looking identical.

**Parameters are not scale.** A cube has a Width *and* a Size X, which looks
redundant and isn't: parameters define the solid that gets built and exported,
scale is a transform applied to it. Resizing with the gizmo writes scale, the
way it always did; typing a width rebuilds the geometry. Shapes where this is
the same thing (the cube) are the exception — on a gear, a thread or a star
there is no scale that gets you a different tooth count.

**Geometry is reference counted, not cached forever.** One geometry per
*type and parameter set*, so a hundred default cubes still share one — but
dragging a parameter slider mints a new geometry every frame, and three won't
free a dropped geometry's GPU buffers on its own. `geometryCache.js` counts
holders, keeps recently-released entries in a small idle pool (so an undo, or
a slider nudged back, reuses them) and disposes what falls out of it.

**The extruder is ours rather than three's `ExtrudeGeometry`** for two
reasons: twist, which a straight extrude can't do and which a helical gear and
a twisted star both need; and crease smoothing, which is what leaves a gear's
involute flanks smooth while its tooth tips stay sharp. `ExtrudeGeometry`
flat-shades everything, which turns a 48-sided pipe into a faceted barrel.

**Gear teeth are real involutes.** Not triangles, not trapezoids — the curve
traced by unwinding a string from the base circle, which is what makes two
gears of the same tooth size mesh at a constant ratio. The maths is twenty
lines in `builders/gear.js` and it's the difference between a gear that prints
and meshes and a cog-shaped decoration.

**The thread is a modulated surface of revolution, not a swept profile.**
`r(θ, y) = profile(frac((y − lead·θ/2π) / pitch))`. Following the helix keeps
the phase constant so the ridge lands exactly where it should; climbing one
pitch at a fixed angle returns the same radius so the surface is seamless.
It is watertight by construction, caps trivially, and multi-start threads are
one term in the phase. Its normals are computed analytically: letting
`computeVertexNormals` average across the crest rounds every thread over until
the rod reads as a stack of washers.

**`npm run check:shapes` is the guard rail.** It builds every shape at both
ends of every parameter and checks the signed volume and the normals. Three
renders back faces invisibly, so a builder with its winding reversed looks
*fine* from some angles and simply isn't there from others — which is exactly
how the ramp shipped inside out for an hour.

### Variables

A variable is `{ id, name, kind, value }`, and an object that follows one
records it in `bindings`, keyed by parameter. Three things are worth knowing:

**`params` always holds the resolved number.** Builders, the cache key, the
gizmo and both exporters never learn that variables exist — they read the same
plain values they always did. The alternative, storing `{ $var: id }` inside
`params` and resolving at build time, pushes variable-awareness into every one
of those consumers. Here it stays in `scene/variables.js`, whose whole job is
keeping the resolved copy honest: any write to `params` goes through `settle`,
which lays the bindings back on top, so a bound parameter can't be talked out
of its variable's value by a stray edit elsewhere.

**A variable edit is one command, covering both halves.** Changing a value
rewrites the `params` of every object bound to it, so those object patches
travel *with* the new variable list in a single `editVariables` — undoing a
tooth-size change has to put all four gears back in one step, not four.
Commands now operate on `{ objects, groups, variables }`; spread `...s` in a
new one or it will silently wipe the variable list.

**Compatibility is by kind, except for choices.** `int` collapses into
`number`, so a tooth count and a radius can share one variable (binding rounds
on the way in, and `coerce` clamps to whatever the target shape allows). A
choice variable carries the menu it was promoted from, and is only offered
where its current value is on that shape's menu — which is why a right/left
`hand` shows up on both a screw and a spring, but never on a gear's pressure
angle.

One UI note that is easy to undo by accident: the `{}` menu is portalled to the
body. The properties rail scrolls, and a pop-over drawn inside a scroll
container is clipped by it — for the bottom parameter of a gear that means the
menu is simply invisible. The variables sheet's sliders run `0..1000` with the
value mapped by hand for a related reason: changing `step` on a range input
makes the browser re-snap and fire an `input` event, which lands just after a
drag ends and reads as one more edit.

### Scene

Two things are worth knowing before changing the scene code:

**Dragging bypasses React.** While a gizmo drag is in flight the block meshes
are mutated directly through `meshRegistry` and the scene store is left alone.
Routing every pointer-move through React state re-renders the whole block tree
each frame and makes dragging stutter. The store is written once, at drag end,
which is also where the undo entry is pushed.

**There are no tool modes.** The design doc specced a Move/Turn/Size switch;
the build instead puts every operation on the bounding box, Tinkercad-style —
which handle you grab is the mode. `BoxGizmo` owns all of it, and the frame it
draws is recomputed each frame from the *live meshes* rather than the store, so
the box tracks a drag that the store hasn't heard about yet.

**The handle set is deliberately sparse** — four bottom corners, one height
handle, a lift cone and three turn levers. Corners anchor to the *opposite
bottom corner* so resizing grows a block up off the floor rather than sinking
it through.

**Turn levers are a stick with a ball on the end**, one per axis, each pointing
a different way so they never overlap (Y reaches along +X, X along +Z, Z along
-X). They live inside the box frame, so they follow the block's orientation
during a drag for free — no special case needed.

**The turning dial appears on press and is world-fixed.** It stands up in the
plane of rotation, in the lever's colour, ticked every 15 degrees to match the
rotation snap. It is deliberately *not* parented to the box: a dial that turned
with the block would sit still relative to the lever and show nothing. Keeping
it fixed is what lets you see the lever travelling around it.

**Gizmo chrome is small and semi-transparent on purpose.** Handles hold a
constant size on screen, so zoomed out a scene would otherwise be mostly
gizmo. `HANDLE_SCREEN` in `BoxGizmo.jsx` is the one dial.

**The view cube is a hand-projected SVG, not CSS 3D and not a second canvas.**
A CSS cube sweeps out roughly 1.7x its own face size as it turns, so it spills
out of any frame tight enough to sit in a screen corner, and CSS perspective
balloons it besides. Projecting the eight corners by hand keeps everything
inside a fixed viewBox and lets the axis triad share the exact same rotation,
so the two read as one drawing. A cube is convex, so at most three faces ever
face you and they never overlap — hiding the back faces is all the sorting it
needs. It follows the camera from a plain rAF loop writing to refs; pushing
orientation through React state sixty times a second is the one thing this app
carefully avoids.

**Dragging the cube turns the view**, it does not move the widget. Tapping a
face snaps to that side; the `turned` guard stops a drag that began on a face
from also firing that snap. The orbit maths is shared with `CameraRig` via
`orbitCamera` — the cube pivots on the camera's target and spreads a full turn
over a much shorter pixel span, so a small drag on a small cube goes somewhere.

**The axis arrows spring from the box's front-bottom-left corner** and share
its rotation, so box and axes read as one object. Their arm lengths differ on
purpose: X and Y start at the far side and run along the box's edges, so they
have to span it, while Z starts on the front face already and only pokes out
towards the viewer.

**Camera moves glide, and any interaction cancels them.** `viewport.flyTo`
eases position and target together over 260ms; `CameraRig` cancels it on
pointer-down and wheel, so a flight can never fight a drag.

**The camera follows the cursor.** Zoom is OrbitControls' own `zoomToCursor`.
Orbiting is not: OrbitControls always re-aims the camera at its target, so
moving that target to the cursor would swing the view before the drag even
began. `CameraRig` takes the rotate gesture instead (`enableRotate={false}` on
OrbitControls) and swings the whole camera rigidly about the point under the
cursor, then parks the target back on the new view axis at the same distance.
OrbitControls' `lookAt` then agrees with where the camera already points, so
nothing jumps and pan, zoom and damping still work. Keep that invariant —
target on the view axis — if you touch either file.

**The yard is a bounded 20x20 plate**, not an endless grid, and the home camera
is framed to it (`HOME_CAMERA` in `viewportApi.js`). New blocks are clamped to
land on the plate.

**Undo is a command stack, not snapshots.** Each command in `undoRedo.js` is a
pair of pure functions over `{ objects, groups }` and captures whatever it
needs to invert itself exactly. Add a new mutating action by adding a command
factory there, not by diffing scenes.

## Scope notes

Matching the spec's v1 boundary:

- **Combine is grouping, not CSG.** Combined blocks move, turn, scale, copy and
  delete as one unit and export as a glTF node, but they are not booleaned into
  a single solid. True CSG is the flagged v2 stretch goal. This is what a
  *threaded hole* is waiting on: the screw generator makes an external thread,
  and cutting a matching internal one out of a block needs a real subtraction.
- **The undo stack resets on refresh.** The *build* doesn't: it autosaves to
  localStorage and comes back. That's the split the spec asks for.
- **Import is BabyCAD JSON, not `.glb`.** The design's footer button reads
  "Open a .glb", but reading an arbitrary GLB back would produce meshes that
  don't map onto the primitive data model. The button opens the scene JSON that
  Export writes, which is the round-trip the spec's data model describes.
  Importing GLB would need a v2 decision about non-primitive geometry.
- **No Move/Turn/Size mode switch.** Replaced by direct manipulation on the
  bounding box, plus a numeric properties panel. This is a deliberate departure
  from the design doc's state 02.
- **Phones are not a target.** Tablet-and-up, per the spec; the chrome tightens
  below 860px but isn't designed for a phone.

## Performance

Geometries are shared by type *and* parameters, and only materials are
per-block. Past 120 blocks the app drops per-block shadow casting and the soft
ground shadow rather than let the frame rate collapse.

That threshold counts blocks, not triangles, and the generators are far heavier
than the primitives — a default screw is around ten thousand triangles against
a cube's twelve. A yard full of screws will cost more than a yard full of
cubes well before it trips the block count. If that starts to bite, the dial to
reach for is a triangle budget in `Viewport.jsx` rather than a lower block
count; the per-shape smoothness parameters are already the user-facing escape
hatch.
