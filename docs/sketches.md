# Sketches: drawing a profile and extruding it

Notes for building this. It is two features in the user's hands — **import an
SVG and extrude it**, and **draw something and extrude it** — and one feature
underneath, which is what this is about. Read
[architecture.md](architecture.md) first; everything here leans on the shape
registry, the geometry cache, `settle`, and the reasons `meshStore` exists.

**Where it has got to.** The spine, the importer and the drawing editor are
built, and guarded by `npm run check:sketch`. Variables inside a drawing are
not: that section is still a design, and it is the only one. Anything below
that describes code you cannot find is in it.

## One shape, two ways in

Both features make the same block: a **sketch document** — a 2D drawing, in
millimetres — plus the numbers that say how to lift it into a solid. The SVG
importer writes that document out of a file. The drawing editor writes it by
hand. Nothing downstream can tell which happened.

That is the whole reason to build it this way. A new entry in `SHAPE_DEFS` and
the tray, the properties rail, the geometry cache, persistence, the clipboard,
undo, holes and both exporters all pick it up for nothing — which is the deal
the registry makes and the reason adding the thirteenth shape costs less than
the third did.

The extruder is already here. `extrudeProfile` in `shapes/extrude.js` takes a
contour, its holes, a height and a twist, and it was written for the pipe, the
star and the gear. A drawing is the same operation with the contour coming from
somewhere else.

```
  shapes/sketch/doc.js       the document: nodes, normalize, digest, bounds
  shapes/sketch/flatten.js   document -> contours -> islands, wound right
  shapes/builders/sketch.js  islands -> extrudeProfile -> one solid
  io/importSvg.js            a file -> a document
  ui/sketch/                 a person -> a document
```

## The document lives in `params`

`shapes/meshStore` keeps an imported model's triangles beside the scene rather
than inside it, and the architecture doc is honest about what that costs: a
refresh cannot bring one back, because megabytes will not go in the session
cache. **A sketch must not inherit that**, and it does not have to, because a
drawing kept as *primitives and curves* rather than as points is kilobytes.

So the document is a parameter, like a word is a parameter on the text shape:

```js
{
  kind: 'sketch',
  nodes: [
    { id: 'n1', kind: 'rect',   x: -20, y: -12, w: 40, h: 24, r: 3 },
    { id: 'n2', kind: 'circle', cx: 0, cy: 0, r: 5 },
    { id: 'n3', kind: 'poly',   pts: [[0,0],[20,0],[20,10]], closed: true },
    { id: 'n4', kind: 'path',   segs: [['M',0,0], ['C',…], ['Z']] },
  ],
}
```

Four node kinds and no more. `rect` and `circle` are there because they are
what somebody draws and because they carry *named* dimensions — a width, a
radius — which is what the measurements on screen and the variables both hang
off. `poly` is a run of straight segments. `path` is the general case and is
what an import lands as: SVG's own command list, cubics and all.

Three things follow from keeping curves rather than points:

- **The file stays small.** A logo is a few hundred bezier segments, not the
  twenty thousand points it flattens to. Small enough for `params`, therefore
  small enough for the session cache, the clipboard and a `.babycad`.
- **`Smoothness` stays a live parameter.** A drawn circle is a circle and is
  flattened at build time, so turning smoothness up turns a coarse arc smooth
  after the fact. Flatten at draw time and that number is spent for ever.
- **An imported SVG is editable.** It is the same document the editor writes,
  so a logo can be opened, measured and resized in millimetres rather than
  being a black box the way an imported STL is.

### Millimetres are the document's own

**There is no `Size` parameter, and the document is authoritative.** A sketch
is in millimetres the way everything else in this app is, and its footprint is
what is drawn, not a multiplier laid over it. Import is where the guessing
happens and it happens once, on the way in (below). Afterwards, the way to make
a part 41 mm wide is to open it and type 41, which is the feature.

`AXIS_PARAMS` therefore gets `sketch: { y: ['thickness'] }` and nothing on X or
Z. `resizeToParams` bails on any axis with no length parameter behind it, so
pulling a corner writes the scale multiplier — the same honest answer an
imported model gives — while pulling the top handle writes millimetres of
thickness. A non-uniform stretch of somebody's drawing is not a thing any
parameter here can describe, and quietly distorting it would be worse than the
multiplier.

### Two places that assume a parameter is a scalar

Both are small and both will be silently wrong if they are missed.

**`paramsKey` builds the cache key by string concatenation**, and an object
stringifies to `[object Object]` — so every sketch in the build would share one
cache entry and show the same solid. The spec carries a `digest` instead:

```js
key += `|${s.key}:${s.digest ? s.digest(value) : value}`
```

`digestSketch` is FNV-1a over the document's JSON, the same trick `meshStore`
already uses to content-address a model, and it keeps the key short as well as
correct.

**`sameParams` in `sceneStore` compares values with `===`**, and a freshly
edited document is never the same object as the last one. Left alone it reads
every commit as a change, which is mostly harmless and occasionally an empty
undo entry. Compare sketches by digest there too.

## Flattening: contours, holes and islands

`flatten.js` turns a document into what `extrudeProfile` eats.

1. **Each node becomes one or more rings.** Arcs and cubics are sampled at the
   shape's `sides`, straight runs are passed through, a `rect` with a corner
   radius becomes four lines and four arcs. Open rings — a polyline that was
   never closed, a `path` with no `Z` — are **dropped from the solid**. There
   is no thickness to give them, and closing them behind somebody's back
   produces a shape nobody drew. The editor draws them dashed so it is obvious
   which lines are not part of the part.
2. **Rings are nested by containment**, and the parity of the nesting decides:
   depth 0 is material, depth 1 is a hole, depth 2 is material again — an
   island inside a hole, which is how the middle of an O works. Containment is
   a point-in-polygon test of one ring's first vertex against the other, which
   is sound because the rings do not cross.
3. **Each depth-0 ring plus its immediate children is one island**, and each
   island is passed through `windContours` — outer counter-clockwise, holes
   clockwise — because that is what both `extrudeProfile` and
   `ShapeUtils.triangulateShape` require and neither will say so.

A drawing is usually one island. Two letters side by side are two, and they are
extruded separately and merged with `BufferGeometryUtils.mergeGeometries`
rather than being fed to the extruder as one contour, because "outer contour"
is singular there and always was.

### Outlines that overlap are one shape

Two rectangles crossing each other are one bracket. Extruded separately that
is not what they look like: the silhouette is right, but you can see the seam
where one shell passes through the other, and with an edge taken off you get a
bevel running through the middle of a part that is supposed to be continuous.
So they are unioned **in two dimensions, before anything is extruded**, and
the extruder is handed one boundary — which is also what makes the edge follow
the outside of the whole thing rather than each piece's own outline.

Doing it afterwards in three dimensions would give a correct solid with the
wrong edges, each piece bevelled along its own outline with the bevels meeting
in a notch at the join; and it would be slow, a CSG union on every nudge of a
slider being exactly the cost `cutWorker` exists to keep off the main thread.

**Nesting and overlap are different questions and no one fill rule answers
both.** A ring inside another is a hole; two rings crossing are one shape.
Even-odd gets the first right and turns the overlap into a hole. Non-zero gets
the second right and loses the hole. So containment settles the depths first,
and `sketch/union.js` walks them from the inside out:

```
region(d) = union(rings at depth d) − region(d + 1)
```

Odd depths become holes, even depths material, and whatever shares a depth is
unioned on the way. It picks up something containment alone never could: two
L-shapes crossing can enclose a void that neither of them contains, and the
union finds it.

**`CrossSection` does the boolean, and it is already a dependency** — the
exporter rebuilds solids with the other half of the same module, so
`shapes/manifoldWasm` now starts it once for both. It is WebAssembly, so it
has to be started before it can be used, and a geometry builder runs inside a
render and cannot wait: until it is up, `unionIslands` says so and the
flattener falls back to plain containment nesting, which is what this did
before and is right for every drawing whose outlines do not overlap. When it
lands, `useUnion`'s generation goes up and `SceneObject` folds that into the
geometry key, so the drawing is built again — the same bargain `fontStore`
strikes with a typeface that arrives late.

**Rings are wound counter-clockwise on the way in.** They reach the union in
the extruder's plane, where the drawing's y has been turned upside down, so a
shape drawn the usual way round arrives wound the other way — and a clockwise
polygon under Manifold's default fill rule is not a hole, it is nothing at
all. The first version of this came back with an empty drawing every time.
Which way round a ring happens to be carries no meaning here; the depth is
what says material from hole, and it is settled before the union runs.

**Self-intersecting rings are the known bad case.** `triangulateShape` does not
refuse them; it returns a mess of triangles, which is a solid that looks wrong
rather than an error anybody can act on. `flatten` runs a cheap segment-crossing
test per ring and drops a ring that fails it, and the panel says how many were
dropped. It is not a repair — repairing a figure-of-eight means deciding what
the person meant — but a missing outline you can see is better than a solid
that will not slice.

## The builder, and one seam in it

```js
buildSketch({ sketch, thickness, sides, edge, edgeStyle })
```

Islands, extrude, merge, centre on the origin — every builder here returns
geometry centred on the origin, and `restingHeight` is what sets it down.

**`Edge` above zero goes down a different road, and it is a real trade.**
`extrudeProfile` gives crease smoothing and cannot bevel. `ExtrudeGeometry`
bevels and flat-shades everything. So `edge > 0` builds through
`ExtrudeGeometry`, exactly as `builders/text.js` already does for the same
reason, and the cost is that a curve facets until `Smoothness` is turned up.
The alternative is shipping the one new solid without the edge control every
other solid in the tray has, and offering to round the edges of a drawing is
worth more than keeping one code path. Say it in the panel's tooltip; do not
hide it.

Two things follow that are easier to accept than to work around:

- **No `Twist` in v1.** The extruder has it, the bevel path cannot, and a
  parameter that silently turns another one off is worse than a parameter that
  is not there. If it comes, the two are mutually exclusive and the UI has to
  say so.
- **A sketch with nothing buildable in it builds as `nothingToDraw()`** — the
  geometry cache already does that for a throw, and an empty drawing is the
  ordinary state of a block the moment it is made, not an error.

A sketch block can be marked a hole like any other, which is worth saying out
loud: it means an SVG cutting its own shape out of a plate works the day the
importer lands, with no code for it.

## Importing an SVG

`io/importSvg.js`, and `SVGLoader` out of three's examples does the reading.
Four decisions are the whole of it:

**Filled paths only.** `SVGLoader.createShapes` honours `fill-rule`, which is
the part nobody should write twice — even-odd and nonzero disagree about which
ring is a hole, and the file says which it meant. A stroke-only drawing has no
area to extrude and is reported as such rather than arriving empty. (Widening
strokes into outlines is `pointsToStroke`'s job and is a later question.)

**SVG's Y grows down; the plate's does not.** Flip on the way in or every
import arrives mirrored, which is the kind of wrong that looks fine until the
first letterform.

**Millimetres are guessed once, in the open.** If the root says `width="40mm"`
— or any real unit — that is honoured against the viewBox and the document is
in millimetres exactly. If it says `width="1024"`, there is no physical size in
the file at all, so the longest side is scaled to 40 mm and the toast says it
guessed. Baking it at import means the document is in millimetres from then on,
like every other document, and the drawing editor is where it gets fixed.

**A segment budget.** A traced photograph is tens of thousands of curves and
this document goes in `params`, therefore in the session cache, therefore
against a localStorage quota shared with the whole build. Past the budget the
import is refused with the count in the message, rather than accepted and
quietly unable to save.

The importer is a sibling of `io/importModel.js`, not a branch inside it: the
two share a file picker and nothing else. `App.onImport` looks at the extension
and sends `.svg` one way and `.stl/.obj/.3mf` the other.

## The drawing editor

A full-screen overlay, `ui/sketch/`, over a `sketchEditing` field in
`state/ui` — the same reasoning that put `variablesOpen` there, since the tray,
the properties rail and both touch sheets all open it.

**SVG DOM, not a canvas.** It is the `ViewCube`'s idiom already: hit-testing
per element for free, crisp lines at any zoom, and dimension labels that are
ordinary DOM with an ordinary input inside them — which matters, because typing
a measurement is half the feature and a canvas would mean re-implementing a
text field.

### The tools, and the list is closed

Pick-and-move, lines, pen, box, circle, delete — and a box's corner radius,
which is a measurement rather than a tool. The list is deliberately short:
this is a profile editor for somebody who wants a bracket with two holes in
it, not a vector illustrator. Boolean operations, fillets between segments,
mirroring and arrays are all reasonable and all later.

**The arc came off that list while it was being built.** It was on it, and it
should not have been. An arc is not a closed region, so an arc *tool* has to
be something else wearing the name — a pie slice, or a bow put into a segment
that is already drawn — and neither is worth the interaction it costs next to
the thing people actually reach for, which is a rounded corner. That is a
measurement on a box and it is there. The `E` segment is already in the
document and already flattened (every imported SVG arrives full of them), so
an arc tool, when it comes, is a tool and not a change to the format.

### The pen

The one tool that draws a curve, and it works the way the pen in every vector
editor has worked for thirty years: **click for a corner, click and drag to
pull a curve out of it**, click the first point again to close.

An anchor is `{ x, y, hx, hy }`, where the handle is an offset from the anchor
and stands for *both* sides of it — the curve leaves along `+h` and arrives
along `−h`. That is a smooth node, and it is what dragging as you click gives
you. Handles that pull independently are the other half of a proper pen and
are not here: they want a modifier to grab one on its own, and almost every
curve anybody draws is made of smooth nodes and corners.

**Two corners in a row make an `L`, not a flat `C`.** A curve with its
controls sitting on top of its own ends is the same shape, but it flattens
into a fan of sampled points and measures as a curve, when what was drawn was
a straight edge. `pathFrom` looks at both ends before it decides.

**Two anchors can close, if either of them is curved.** Straight lines need
three points to enclose anything; curves do not — out along one and back along
the other is a leaf, and it is the simplest curved shape anybody draws.
Taking the polyline's rule for the pen was what stopped it closing at all.

**The handle being pulled is drawn through its anchor**, both ways. A curve
whose controls you cannot see is a curve you are guessing at.

**A path offers grips by how many points it has, not by where it came from.**
Up to `MAX_GRIPS` anchors, each one is a handle you can drag, and moving one
carries the control points either side of it by the same amount so the curve
comes along rather than being stretched. Past that it is a swarm and the
outline moves as a whole — which is what an imported logo wants, and it is the
count that says so, not the provenance. A closed run writes its first anchor
twice, as the `M` and as the end of the segment coming back round, so the move
is applied to every segment that ends there rather than to one index; miss
that and the outline tears open at the seam.

What is not there yet is a grip on the *curvature* — the handle that says how
far a curve bulges. Moving an anchor takes its handles with it, so the shape
follows, but changing them means drawing and redrawing. That is the next piece
of work on this tool.

**The plane is the plate seen from above.** The extrusion runs up +Y, so the
drawing's X and Y are the plate's X and Y under the names `scene/axes` already
gives them. Draw the plate outline faintly in the background; it is the one
piece of context that makes a drawing's size mean something before it is
extruded.

**Snap comes from `SNAP_STEPS`**, so the drawing snaps the way the plate does
and the switch in the top bar is the same switch. Grid, origin crosshair, and
Alt to escape it — all of it the behaviour the scene already has, because a
second set of rules for the second window is how an app stops feeling like one
app.

### Measurements on screen

Every segment carries its length, every rectangle its width and height, every
circle its diameter, in the same millimetres the properties rail uses. **Click
the number and type a new one.** That is what makes this a CAD sketcher rather
than a drawing program: the dimension is an input, not a readout.

**The line being drawn is the exception, and reads out rather than takes
input.** While a run is in progress it says how long the new segment is and
what corner it is making with the one before it, because those are the two
things being decided at that moment. The pen gets the same readout, minus the
angle whenever either end of the segment is curved: the straight line between
two anchors is not the corner you can see, and a number that does not match
the picture is worse than no number. It cannot be an input — the shape does
not exist yet — and the instant the run closes every segment has an editable
length of its own. The corner is the angle *at* the previous point, so a
right angle reads 90 and a straight line reads 180; the turn angle would say
90 and 0 for the same two, which is the same fact told the way nobody asks
for it.

What a typed dimension does has to be decided per node kind and written down,
because "make this 40" is ambiguous the moment two things touch:

- A **rectangle's** width moves its right edge; its left stays.
- A **circle's** diameter grows about its centre.
- A **polyline segment's** length moves the far end along the segment's own
  direction. The near end is the anchor because the near end is where you drew
  from.
- An **imported outline** has no dimensions of its own — it is somebody else's
  curves — but it has a size, and typing that scales it about its own middle.
  This is the promise the importer makes good on: an SVG that never said how
  big it was came in at a guess, and this is where the guess gets fixed.

The design said a typed segment length should drag everything after it along
too, keeping the rest of the shape's form. That reads well until the ring is
closed, and then "after" comes back round to the start and the shape is torn
open — so it moves the one point, which also changes the next segment's
length, which is what an editor with no constraints in it should be expected
to do.

No constraint solver. A dimension is an edit to the document, applied once,
not a rule the drawing remembers — constraints are a real feature and a much
bigger one, and pretending with half of one is worse than being clear that
these are numbers you type.

### A photograph to trace over

Open a picture of the thing, scale it until something in it is a size you
know, and trace the outline you want. `ui/sketch/trace.js`.

**It is a backdrop and nothing else.** It is not in the document, so it cannot
reach the solid, the file or the clipboard — the `photo` key does not survive
`normalizeSketch`, and `check:sketch` asks. It sits over the grid and under
the drawing, because a backdrop is a thing you draw on top of and the line
being traced has to be the clearest thing on the board. A fade slider is the
one control that matters after the size.

**It is deliberately not saved.** A photograph is a megabyte or two where the
sketch document is kilobytes, and putting one in `params` would be the mistake
`shapes/meshStore` exists to avoid, except worse: a model's triangles are at
least part of the part, and this is a reference somebody used once. So it
lives in a module-level map for as long as the tab is open — close the board
and come back and it is still there, reload and it is gone with the object URL
behind it.

**It arrives fitted to the view, not to a number of millimetres.** A JPEG does
not say how big the thing in it is, and there is nothing to guess from. The
view is where the person is looking, so that is where it lands, whole and in
proportion; setting its real size against something measurable is the next
thing they do and is the entire point of the exercise.

**Scaling holds the proportions**, always. A traced photograph that has been
stretched is a tracing of the wrong shape, and nobody has ever wanted one.

**A drawing that has not been placed yet keeps its photo under `new`**, and
`adoptTrace` hands it over to the block the moment there is one. Without that
the photo would vanish the first time somebody reopened the thing they had
traced — which is exactly when they want it, because tracing is rarely
finished in one sitting. Backing out of a new drawing takes the photo with it;
an existing block keeps its own.

**Moving it is a mode, not a tool.** The tool row is for things you draw with,
and the row is already five wide on a phone. The mode lives in the photo's own
strip, which is on screen only while there is a photo, and picking any drawing
tool leaves it — that falls out of its being `tool === 'photo'` internally.

### Escape backs out one step at a time

One key, most local first: the shape being drawn, then the tool holding it,
then the selection. From a half-drawn line, one press drops the line and
leaves you still holding the tool — because the usual reason to abandon a run
is to start a better one — and a second puts the mouse back to picking things,
which is where you were before you reached for the tool. A tool at rest goes
straight back to Pick on the first press.

**It never closes the board.** Every other modal in the app takes Escape as
"go away", and this one must not: there is unsaved drawing behind it and no
confirmation in front of it. Cancel is a button, deliberately.

### Undo inside the editor is its own stack

The drawing session commits as **one** `setParams` command when it is done.
Every line, nudge and typed number in between goes on a small local stack that
lives and dies with the overlay. Push every stroke onto the scene's history and
closing a drawing means twenty presses of Ctrl-Z to get back to before you
opened it, which is not what anybody means by undoing "the drawing".

Cancel discards. Done commits. A new drawing that was cancelled never places a
block; a new drawing that was finished is placed by `viewport.placementPoint`
like any other shape.

**On touch** the overlay is the whole screen, the tool bar is along the bottom
under a thumb, one finger draws and two pan and zoom — which is `scene/orbit`'s
split, kept, for the same reason.

## Variables in the drawing

A dimension holds either a number or a reference:

```js
{ x: -20, y: -12, w: { var: 'v3', v: 40 }, h: 24 }
```

`v` is the resolved value and **the flatten step reads nothing else**. That is
the same invariant `params` keeps for the rest of the app: the builder, the
cache key, the exporters and the gizmo never learn that variables exist. Here
it is one level deeper, and it holds the same way.

Which means the integration is small and there are exactly four places:

1. **`settle`** in `sceneStore` and **`resolveParams`** in `scene/variables` —
   the two functions that lay bindings back over `params` — gain a pass that
   walks a sketch document and refreshes every `{ var, v }` from the variable
   map. Both, not one: `settle` is the path for a direct parameter write and
   `resolveParams` is the path for a variable edit, and a sketch that follows
   only one of them will drift.
2. **Pruning.** `pruneBindings` drops a binding whose variable is gone. A
   sketch reference cannot simply be dropped — the dimension would have no
   value at all — so it **freezes at the number it last held**, which is
   exactly what `freezeFormulasUsing` already does when a deleted variable is
   named in a sum. The build stays the shape it was.
3. **`usageCounts`** walks `bindings` only, so a variable used solely inside a
   drawing would report "used by 0" and look safe to delete. It has to walk
   sketch documents too.
4. **The `{}` beside a dimension is `ParamMenu`**, handed a synthetic number
   spec. It is portalled to the body already and `candidatesFor` filters by
   kind, so promoting a dimension to a variable and pointing it at an existing
   one are both reuse.

Once `settle` does its half, dragging a value in the variables panel reshapes
drawings live, along with everything else it drives — no further work.

**Sums inside a dimension** (`wall * 2` typed into a measurement) are not in
v1, but `scene/expression`'s `evaluate` is what they would use and the shape of
the stored value has room for them. One thing at a time.

## What guards this

`tools/check-sketch.mjs`, in `npm run check`, because the failure modes here
are the ones the architecture doc already says a screenshot will not catch —
a ring wound the wrong way is invisible from half the angles it is wrong from.

Fixtures as documents, through `buildGeometry('sketch', …)` and the same
signed-volume, normal-agreement and NaN inspection `check-shapes.mjs` runs: a
square; a square with a hole; a hole with an island in it; two islands; a path
of cubics; a rounded rectangle at several smoothnesses; and the degenerate set
— empty, open, a single point, a self-crossing ring — which must each build
something rather than throw.

Plus assertions below the builder, on `flatten` directly: nesting parity picks
the right rings as holes, winding comes out as documented, and an open ring is
dropped rather than closed.

**The importer needs `DOMParser`, which Node has not got**, so covering the
SVG path end to end means a dev-only `@xmldom/xmldom`. It is worth it: unit
scaling, the Y flip and fill-rule hole nesting are precisely the three things
that will ship wrong and look right in the first screenshot taken of them.

## Order of work

Each of these is worth shipping on its own.

1. ~~**The spine and the importer.**~~ **Done.** `doc`, `flatten`,
   `builders/sketch`, the registry entry, `AXIS_PARAMS`, the `digest` hook,
   the properties row, `io/importSvg`, `App.onImport`, `check-sketch`. This is
   *SVG import and extrude*, whole.
2. ~~**The editor.**~~ **Done.** `ui/sketch/`, the `sketchEditing` state, the
   Draw button in the tray and in the shape sheet, dimensions you can type
   into, the local undo stack, the touch layout. This is *draw and extrude*.
3. **Variables in the drawing.** The four integration points above, and the
   `{}` on every dimension.

`SCENE_VERSION` went to 7 with the first of them. It is purely additive — a v6
build has no sketches in it and opens unchanged — and the bump is there so a
build made with this cannot be quietly half-read by a version that does not
know the type.

### Two things the build taught, which the design had wrong

**An edge has to be pulled *in*, not left where `ExtrudeGeometry` puts it.**
Its bevel grows outward from the outline by default, so a 20 mm square with a
1 mm edge came out 22 mm across — while a cube with a 3 mm edge is still 20 mm.
`bevelOffset: -e` puts the widest point back on the outline that was drawn.

**A ring is asked whether it crosses itself before it is asked how big it
is.** A figure-of-eight encloses as much one way as the other, so it measures
as no area at all and was being reported as too small — which sends somebody
looking for a dimension when what is wrong is the shape.

One thing the design did not mention and should have: a partial `AXIS_PARAMS`
entry was new with this, and two assertions in `check-resize` quietly assumed
every mapped shape maps all three axes. Both now ask only about the axes a
shape claims.

### Edge shape did nothing, and the reason was shading

It was reported as a switch that changed nothing, and the geometry said
otherwise: Round and Bevel differed by sixty triangles against twenty-eight,
and three hundred cubic millimetres. Both were true. `ExtrudeGeometry`
flat-shades everything it makes, and **a flat-shaded round edge is a flight of
steps** — three facets, read as three facets, which is a chamfer with extra
lines in it. Geometrically different, visually the same thing.

Two changes. `ROUND_FACETS` went from the three `builders/text` uses to six,
because a letter's edge is a fraction of a millimetre and a plate's is
millimetres, so what softens one steps the other. And `smoothCreases` in
`shapes/edges.js` now shades the result: one threshold, the extruder's own 35°,
doing three jobs at once —

- the bands of a round merge into one another *and* into the face they run
  out onto, which is what a fillet does: it lands tangentially, with no line
  where it arrives;
- a chamfer's single band meets both at 45° and stays a crisp chamfer;
- a flattened curve's wall — the thirty-two sides of a drawn circle — smooths,
  while the corner where two straight walls meet does not.

The third of those is why the trade written above is no longer a trade.

**The obvious test for this is the wrong one.** "Does the rim point straight
up?" fails: a fillet runs out onto the face tangentially, so at the rim it
points very nearly straight up, exactly as the face does. What tells them
apart is how *many* ways each rim point faces — one for a round, because the
curve and the face are one surface there, and two for a chamfer, because they
are not. That is what `check:sketch` asks.

**`builders/text` has the same defect and has not been touched.** Its Round
and Bevel leave three normals at every rim point either way, which is the same
switch doing the same nothing. It is the same one-line fix; it is also a
visible change to lettering in every build anybody has already made, so it
wants asking about rather than slipping in.

### And three the editor taught

**A selection is an index, and undo can take the outline it pointed at out
from under it.** Undoing back to an empty drawing with something selected took
the board down. Everything now reads the node rather than the index, and
moving between versions lets go of a selection that is not in the one being
moved to. A drag in flight needs the same guard, for the same reason.

**A measurement sits inside the board, so a press on one is also a press on
what is behind it.** Without stopping that, clicking a number picked whatever
outline was underneath it and typing went somewhere else. The labels stop the
event; they are the one thing on the board that is not the board.

**React runs a state updater twice to prove it is pure**, and undo had been
written as one updater pushing onto the other stack. In development that
pushed twice. Neither stack is touched from inside the other's updater now.
