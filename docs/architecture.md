# How BabyCAD fits together

Notes for anybody changing the code. The [README](../README.md) is the place to
start if you just want to run it or use it.

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
    axes.js           what the axes are called: Z-up names over a y-up scene
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
    VariablesPanel.jsx  the whole list in the right rail, values you can drag
    ViewCube.jsx      orientation cube, axis triad and camera buttons
    ...               the rest of the DOM chrome
  io/
    persistence.js    localStorage save/load
    exporters.js      GLB / STL / .babycad
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
menu is simply invisible. The variables panel's sliders run `0..1000` with the
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
during a drag for free — no special case needed. **Only the ball is the
handle**: the stick is `raycast={() => null}`, because a grabbable line that
crosses half the box turns a press meant for anything behind it into a turn,
and at a grazing angle that line runs straight over the lift cone. Hovering the
ball puts a drawn rotate cursor on the canvas — CSS has no such cursor, and
`grab` means "pick this up and move it", which is the one thing the ball does
not do.

**A resize says which sides it is pulling.** A drag on a bottom corner changes
two dimensions at once and a drag on the top changes a third, and until you
have learnt which handle is which the only way to find out is to pull one and
watch. So each axis the drag's `mask` names gets a double-headed arrow laid
along its edge, in that axis's own colour — the colour its number takes at the
same moment, and the colour the rail and the turn levers already give it. The
arrows are parented to the box frame, so they turn with the block for free and
the whole layout is the half-extents with the drag axis zeroed; and they sit on
the edge that axis's number has already chosen, which is frozen for the length
of a drag, so the arrow holds still while the block changes under it.

**Two writers for `visible` is the recurring bug in this file.** The occlusion
pass owns `visible` for anything you can grab and runs on a throttle; anything
else that writes it every frame will take turns with it and blink at that
throttle's rate. Locking hit this once; the edge arrows hit it again and stayed
on the box after the drag, flashing. The rule: chrome that is a *drawing* — the
dial, the edge arrows — opts out of the occlusion pass (`userData.edge`) and
owns its own visibility. Chrome you can *grab* leaves `visible` to that pass.

**The lift cone is the one handle that gets no trim**, and `LIFT_SIZE` rather
than `GIZMO_TRIM` is its dial. Every other handle has a direction you can miss
it in and land on nothing; miss this one and you land on the block, which drags
it sideways — the wrong axis, and a change rather than a no-op. It is also seen
end-on exactly when it is needed most, since a flat part is worked on from
above and from above an upright cone is a disc the size of its own base. For
the same reason it stands `3.6k` above the box rather than `2.2k`: the offset
is vertical, and seen from above a vertical offset projects to nearly nothing,
which put it on top of the height handle for anything short.

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

**The axis arrows hug the box.** All three spring from its front-bottom-left
corner and each runs the length of one of the three edges meeting there, head
poking out past the far corner, sharing the box's rotation so the two read as
one object. Equal arms, so the projection alone decides how long each looks —
which is what says where an axis points. Because they lie on the box's edges,
one or two are always on its far side, and those are painted *under* the faces
rather than over them: the faces are part-transparent, so a far arm reads as a
line seen through the box instead of one stabbing through it. The letters stay
on top either way.

**Z is up, not Y.** The scene graph is three.js-native y-up — floor on XZ, a
block's height is its `y` — but this is a CAD program, and CAD is Z-up. Every
axis the user meets is named the CAD way: the triad, the numbers in the
properties rail, the colors of the gizmo's turn levers. `scene/axes.js` holds
that mapping and is the only place it lives. Displayed Y is internal *−z*, and
the sign matters: CAD's +Y runs away from the viewer where three.js's +z runs
towards them, and the flip is what keeps the displayed frame right-handed. The
scene, the saved file and both exporters keep their internal coordinates — this
renames axes, it does not move anything.

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

**One world unit is one millimetre.** The numbers in the properties rail are
mm, the grid's heavier lines are 20 mm apart, and an exported STL lands in a
slicer at the size it says it is. `FOOTPRINT` in `constants.js` is that 20 mm
square: every shape's defaults are drawn to fill it, placement keeps one clear
per element so shapes dropped one after another land side by side rather than
inside one another, and a copy appears half a footprint over. Snap is 5 mm,
which is one grid cell and a quarter of a footprint. Scale — the SIZE row — is
a multiplier, not a length, which is why it alone carries no mm.

**The yard is a bounded plate** rather than an endless grid, and the home
camera is framed to it (`HOME_CAMERA` in `viewportApi.js`). New blocks are
clamped to land on it. `PLATE` in `constants.js` is how big it is, and that
number stays out of the copy on purpose: quoted at somebody it reads as the
size of thing they are allowed to make, and it is not one — it is where the
drawn floor stops, and a build can run past it.

**Builds saved before millimetres are scaled on the way in.** `migrate` in
`persistence.js` multiplies positions and lengths by 20 for any scene below
v4, so an old build comes back the same shape in the same place rather than a
speck on a plate that grew around it. Only lengths move: a spec is a length if
it went through the `size` helper in `shapes/index.js`, which is why a gear's
tooth *count* and a sweep in degrees survive untouched. A variable is scaled
only when every parameter following it is a length.

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
  localStorage and comes back. That's the split the spec asks for. One thing
  cannot come back with it — an **imported model's triangles**. They live in
  `shapes/meshStore` beside the scene and are megabytes where the rest of a
  build is kilobytes, and localStorage has a few megabytes for everything; a
  cache that tried to carry one would not save the big build and would take
  itself down with it when it overflowed. So `readSession` drops those blocks
  and says how many, rather than restoring them without their triangles. A
  model with none builds as `nothingToDraw()`, which is a live, visible,
  selectable object that draws nothing — and whose bounding box the geometry
  cache deliberately pins to a point, so the clearance readout measured to it
  and reported a gap to bare plate. Anything else that walks the meshes
  (`scene/neighbour` does, and now asks for a vertex count rather than
  `visible`) should assume a mesh can be switched on and still be empty.
- **Import is a `.babycad` file, not `.glb`.** The design's footer button reads
  "Open a .glb", but reading an arbitrary GLB back would produce meshes that
  don't map onto the primitive data model. The button opens the scene JSON that
  Export writes — a `.babycad` file — which is the round-trip the spec's data
  model describes.
  Importing GLB would need a v2 decision about non-primitive geometry.
- **No Move/Turn/Size mode switch.** Replaced by direct manipulation on the
  bounding box, plus a numeric properties panel. This is a deliberate departure
  from the design doc's state 02.

### The touch shell

**There are two shells, and the pointer picks between them.** `state/device`
asks `(pointer: coarse)` — what is doing the pointing, not how wide the window
is — so a laptop with a touchscreen and a mouse in hand gets the desktop
chrome, and a narrow desktop window still gets rails rather than a bottom bar.
`compact` is a second, narrower question about width, and only tightens what
the touch shell already is. Both are subscribed to rather than read once, so a
convertible folded into a tablet or a phone turned on its side changes shells
on the spot.

**`App` branches once, and everything below the branch is shared.** The scene,
the stores, the properties panel, the variables panel, the modals and the
welcome screen are the same components in both. What differs is where they are
put: the two rails and every drop-down become sheets along the bottom edge,
because that is the half of a handheld a thumb reaches, and the tab strip
becomes the build's name in the top bar, because a 96px tab with a 20px close
button inside it is not a target a finger has. `PropertiesPanel` takes one
prop, `embedded`, which drops its own header and card so a sheet can be the
card; nothing else in it knows which shell it is in.

**Every touch rule is behind `.app.touch` in `styles/touch.css`.** That scopes
it away from the desktop chrome *and* gives it the specificity to win over the
rule it replaces, which is why the file can be `@import`ed at the top of
`global.css` — where CSS demands imports live — without coming last or saying
`!important`. Keep new rules behind that prefix.

**The selection sheet is attached, not modal, and it has rungs.** No scrim and
nothing dimmed: the block being edited has to stay visible and stay draggable
while its numbers are on screen, which is the same reasoning the variables
panel already gives for taking the rail instead of opening over the scene. It
stops at three heights — a 220px bar of modes and actions, then the colours,
then the millimetres — and it starts at the shortest, because picking a block
up should cost a strip of the plate rather than the plate. On a short, wide
screen (a phone on its side) the drawer becomes a panel down the right-hand
side instead, where there is width to spare and no height at all.

**Two gestures have no touch equivalent, and both are answered with a switch.**
Shift-click becomes `pickMore` in `state/ui`, a sticky mode that makes a tap
add to the selection; the drag-a-box-over-empty-plate route is simply gone,
because one finger dragging on bare plate is how a touchscreen turns the view
and that cannot be both. Everything else already worked: `scene/orbit` has read
one finger as an orbit and two as pinch-and-pan since it was written, and
`gizmoMath`'s `grabScale` has grown the handles for a coarse pointer for as
long.

**Save means share.** `io/share` offers the file to `navigator.share`, because
a handheld has no file picker to point at and no downloads folder anybody opens
— Save to Files, AirDrop, mail it on. Three things about it are load-bearing
and written up in that file: `canShare` is asked with the real file and answers
per type (Chrome will not take a `.babycad`, iOS will), a share needs a user
gesture that is still warm and a slow export can outlast one, and both a
refusal and a dismissal fall through to the download path rather than losing
the file. Every caller keeps its old behaviour when sharing is off or refused.

### Cutting, and what it costs

**A hole cuts only once it is combined, and only its own piece.** It used to cut
whatever it overlapped, the moment it overlapped it — which on an imported
model meant a fresh cut on every nudge, and which let a combined hole carve
its way into the block next door. `cuttersByObject` now pairs a hole only with
solids in the same root group; a hole in no group cuts nothing and is drawn as
its ghost. The example builder is the one caller that pairs by overlap alone
(`loose: true`), because it is discovering the groups it is about to make.

**The cut at Combine is still bounded, because `three-bvh-csg` is not.** A hole
subtracts itself from the solids in its piece, synchronously, on the main
thread. That is fine for the shapes this app builds — hundreds or a few thousand triangles, a
cut lands in a frame or two — and it is not fine for an imported model, because
the cost is not linear in the triangle count. Measured against a hollow printed
part, where the cutting block passes through a lot of thin wall:

```
   6k tris  0.2s     18k tris  1.3s     37k tris   4.9s
  12k tris  0.6s     25k tris  2.3s     48k tris   8.8s
```

That is an exponent of about 1.9. Extrapolated, a 200k-triangle STL — an
ordinary download — is something like two minutes of locked tab. A convex mesh
of the same size is thirty times cheaper, so there is no honest single number;
`LIVE_CUT_TRIANGLES` in `shapes/csg` is set where the *worst* case is about two
seconds. Past it `acquireShape` returns the block whole and the hole stays the
grey ghost it already was.

Nothing is lost from the file. `io/solidCut` cuts it again with Manifold on the
way out — a different implementation and a far faster one — and that is the cut
a printer sees. What the budget costs is the live preview, on the one kind of
block that has no parameters to preview against anyway.

**A hole whose every target was refused stays visible even when combined.**
Combining is what normally puts the grey ghost away, and doing that here would
leave a block that looks solid with nothing on screen to say a hole is in it,
and nothing left to select. `isFinished` takes a second argument for this and
`Viewport`'s `stalled` set works out who it applies to — a hole that reaches
two blocks and gets through to one of them has done its job and still steps
back.

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
