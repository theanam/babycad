/**
 * Example builds check:  `node tools/check-examples.mjs`
 *
 * The welcome screen's examples are written as data against the shape
 * registry (see src/examples), so a renamed parameter or a changed default
 * would quietly load them wrong rather than fail. This builds each one the
 * way the app does and checks that what comes out is the build that was
 * written: every part survived, every parameter was taken as given rather
 * than replaced by a default, every bound parameter agrees with its variable,
 * and nothing is left floating under the plate or hanging off the edge of it.
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { EXAMPLES, buildExample } = await import('../src/examples/index.js')
const { buildGeometry } = await import('../src/shapes/geometryCache.js')
const { PLATE_HALF } = await import('../src/constants.js')
const { cuttersByObject } = await import('../src/shapes/csg.js')

let problems = 0
const fail = (message) => {
  console.log(`  BAD ${message}`)
  problems++
}

for (const example of EXAMPLES) {
  const scene = buildExample(example)
  if (!scene) {
    fail(`${example.id} did not build at all`)
    continue
  }
  const parts = example.parts.length
  console.log(`${example.name} — ${scene.objects.length} parts, ${scene.variables.length} variable(s)`)

  if (scene.objects.length !== parts) {
    fail(`${example.id} lost parts: wrote ${parts}, loaded ${scene.objects.length}`)
  }
  if (scene.variables.length !== (example.variables ?? []).length) {
    fail(`${example.id} lost a variable`)
  }

  // A hole has to travel with what it cuts.
  //
  // A combined hole is not drawn, so nothing on screen says whether it is
  // attached to anything — and if it is not, the build looks perfect until the
  // moment somebody drags it, at which point the solid walks out of its own
  // holes and leaves them hanging in the air. That is precisely the bug this
  // catches: every hole must share a group with a solid it actually cuts.
  const cutters = cuttersByObject(scene.objects)
  const cutBy = new Map() // hole id -> ids of the solids it cuts
  for (const [solidId, holes] of cutters) {
    for (const hole of holes) {
      if (!cutBy.has(hole.id)) cutBy.set(hole.id, [])
      cutBy.get(hole.id).push(solidId)
    }
  }
  const groupOf = new Map(scene.objects.map((o) => [o.id, o.parentGroupId ?? null]))
  for (const object of scene.objects) {
    if (!object.hole) continue
    const cut = cutBy.get(object.id) ?? []
    if (!cut.length) {
      fail(`${example.id}: a ${object.type} hole cuts nothing at all`)
      continue
    }
    // Uncombined is a legitimate state — the hole shows as a ghost and is
    // there to be picked up. What cannot stand is combined but unattached.
    const group = groupOf.get(object.id)
    if (group && !cut.some((id) => groupOf.get(id) === group)) {
      fail(`${example.id}: a ${object.type} hole is combined into a group with nothing it cuts, so it will be left behind when the build moves`)
    }
  }

  const byId = new Map(scene.variables.map((v) => [v.id, v]))

  for (const [i, object] of scene.objects.entries()) {
    const wrote = example.parts[i].params ?? {}

    // Every parameter written down has to survive validation unchanged. A
    // value out of the spec's range would be silently clamped, which is
    // exactly the sort of drift this check exists to catch.
    for (const [key, value] of Object.entries(wrote)) {
      const bound = object.bindings?.[key]
      if (bound) continue
      if (Math.abs(object.params[key] - value) > 1e-6) {
        fail(`${example.id} part ${i} (${object.type}): ${key} written ${value}, loaded ${object.params[key]}`)
      }
    }

    // A bound parameter must hold its variable's value, not the one typed
    // beside it — that is the whole point of binding it.
    for (const [key, id] of Object.entries(object.bindings ?? {})) {
      const variable = byId.get(id)
      if (!variable) {
        fail(`${example.id} part ${i} (${object.type}): ${key} is bound to a variable that isn't there`)
      } else if (Math.abs(object.params[key] - variable.value) > 1e-6) {
        fail(`${example.id} part ${i} (${object.type}): ${key} is ${object.params[key]}, ${variable.name} is ${variable.value}`)
      }
    }

    // On the plate, and on top of it rather than sunk through it.
    const geometry = buildGeometry(object.type, object.params)
    const box = geometry.boundingBox
    geometry.dispose()
    const floor = object.position[1] + box.min.y
    // Rotated parts are measured loosely: the unrotated box is all we have
    // here, and it over-reports for anything lying on its side.
    const turned = object.rotation.some((r) => Math.abs(r) > 1e-6)
    // A hole is measured by none of this. It is a tool, not a part: one that
    // bores right through a plate has to stick out below it, and one that opens
    // a tray has to stick out above — reaching past the model is the job.
    if (!object.hole && !turned && floor < -0.01) {
      fail(`${example.id} part ${i} (${object.type}) sinks ${(-floor).toFixed(2)} mm into the plate`)
    }
    for (const [axis, slot] of object.hole ? [] : [['x', 0], ['z', 2]]) {
      const half = slot === 0 ? box.max.x : box.max.z
      const reach = Math.abs(object.position[slot]) + half
      if (reach > PLATE_HALF) {
        fail(`${example.id} part ${i} (${object.type}) reaches ${reach.toFixed(1)} mm on ${axis}, past the ${PLATE_HALF} mm plate`)
      }
    }
  }
}

console.log(problems ? `\n${problems} problem(s)` : '\nall clear')
process.exitCode = problems ? 1 : 0
