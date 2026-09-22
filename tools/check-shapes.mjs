/**
 * Geometry sanity check for every shape, at its defaults and across its whole
 * parameter range:  `node tools/check-shapes.mjs`
 *
 * Nothing here looks at pixels, so it can't tell you a gear is ugly. What it
 * can tell you — and what is otherwise very easy to get wrong and very hard to
 * spot in a screenshot — is whether a mesh is inside out. Three renders back
 * faces invisibly, so a builder with its winding reversed looks *fine* from
 * some angles and simply isn't there from others.
 *
 *   signed volume > 0   the triangles wind outward (this caught the wedge)
 *   normals agree       the stored normals point the same way as the winding
 *   no NaN, no empty    every parameter in range builds something
 */
import { register } from 'node:module'

register('./resolve-extensionless.mjs', import.meta.url)

const { SHAPE_DEFS, defaultParams } = await import('../src/shapes/index.js')
const { buildGeometry } = await import('../src/shapes/geometryCache.js')

function inspect(geometry) {
  const position = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const index = geometry.getIndex()
  const triangles = index ? index.count / 3 : position.count / 3
  let volume = 0
  let agree = 0
  let disagree = 0
  let nan = 0

  const vertex = (i) => {
    const v = index ? index.getX(i) : i
    return [position.getX(v), position.getY(v), position.getZ(v), v]
  }

  for (let t = 0; t < triangles; t++) {
    const [ax, ay, az, va] = vertex(t * 3)
    const [bx, by, bz] = vertex(t * 3 + 1)
    const [cx, cy, cz] = vertex(t * 3 + 2)
    if ([ax, ay, az, bx, by, bz, cx, cy, cz].some((n) => !Number.isFinite(n))) nan++

    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6

    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const fx = uy * vz - uz * vy
    const fy = uz * vx - ux * vz
    const fz = ux * vy - uy * vx
    if (normals) {
      const dot = fx * normals.getX(va) + fy * normals.getY(va) + fz * normals.getZ(va)
      if (dot > 0) agree++
      else if (dot < 0) disagree++
    }
  }
  return { triangles, volume, agree, disagree, nan }
}

let problems = 0

for (const def of SHAPE_DEFS) {
  const geometry = buildGeometry(def.type, defaultParams(def.type))
  const s = inspect(geometry)
  const box = geometry.boundingBox
  const bad = s.nan > 0 || s.volume <= 0 || s.disagree > s.agree * 0.02
  if (bad) problems++
  const corner = (v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`
  console.log(
    `${def.type.padEnd(9)} tris=${String(s.triangles).padStart(6)}` +
      `  volume=${s.volume.toFixed(4).padStart(8)}` +
      `  normals ok/bad=${s.agree}/${s.disagree}` +
      `  box=[${corner(box.min)}]..[${corner(box.max)}]${bad ? '   <-- CHECK' : ''}`
  )
}

console.log('\nsweeping every parameter to both ends of its range…')
for (const def of SHAPE_DEFS) {
  for (const spec of def.params) {
    const values =
      spec.kind === 'choice'
        ? spec.options.map((o) => o.value)
        : spec.kind === 'bool'
          ? [true, false]
          : spec.kind === 'text'
            ? // A single glyph, a run with a counter and a descender, digits,
              // and one over the length cap so the trim is exercised too.
              ['I', 'Bag', '2026', 'x'.repeat((spec.maxLength ?? 48) + 10)]
            : [spec.min, (spec.min + spec.max) / 2, spec.max]
    for (const value of values) {
      const params = { ...defaultParams(def.type), [spec.key]: value }
      try {
        const s = inspect(buildGeometry(def.type, params))
        if (s.nan > 0 || s.triangles === 0) {
          console.log(`  BAD ${def.type}.${spec.key}=${value} tris=${s.triangles} nan=${s.nan}`)
          problems++
        }
      } catch (error) {
        console.log(`  THREW ${def.type}.${spec.key}=${value}: ${error.message}`)
        problems++
      }
    }
  }
}

console.log(problems ? `\n${problems} problem(s)` : '\nall clear')
process.exitCode = problems ? 1 : 0
