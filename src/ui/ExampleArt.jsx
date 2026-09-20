/**
 * Flat pictures of the example builds, for the welcome screen's cards.
 *
 * Deliberately drawings and not renders: rendering three scenes off-screen
 * before the app has even been used is a lot of work for a thumbnail, and a
 * drawing can say "rocket" at 150 pixels in a way a shaded 3D view of the same
 * seven blocks cannot. Same palette as the blocks themselves, so a card and
 * the build it opens look like they belong together.
 */
const ART = {
  rocket: (
    <g>
      <path d="M60 8c9 9 13 22 13 35v22H47V43c0-13 4-26 13-35Z" fill="#EDEFF4" />
      <path d="M60 8c9 9 13 22 13 35v22H60Z" fill="#C3CAD9" />
      <path d="M60 8c-5 5-8.5 12-10.6 19h21.2C68.5 20 65 13 60 8Z" fill="#FF5A47" />
      <rect x="47" y="38" width="26" height="5" fill="#FF8A3D" />
      <rect x="47" y="56" width="26" height="5" fill="#FF8A3D" />
      <path d="M47 50v15l-13 11V61Z" fill="#FF5A47" />
      <path d="M73 50v15l13 11V61Z" fill="#C4402F" />
      <rect x="52" y="65" width="16" height="7" rx="1.5" fill="#3A414F" />
      <path d="M54 72h12l-6 11Z" fill="#FFC93D" />
    </g>
  ),
  'gear-train': (
    <g>
      <rect x="10" y="62" width="100" height="10" rx="2" fill="#3A414F" />
      <Gear cx={43} cy={42} r={26} teeth={14} fill="#A9744F" hub="#8A5B3C" />
      <Gear cx={88} cy={42} r={17} teeth={9} fill="#FFC93D" hub="#D8A417" />
      <circle cx="19" cy="67" r="3" fill="#8A93A5" />
      <circle cx="101" cy="67" r="3" fill="#8A93A5" />
    </g>
  ),
  robot: (
    <g>
      <rect x="27" y="34" width="14" height="7" rx="3.5" fill="#EDEFF4" />
      <rect x="79" y="34" width="14" height="7" rx="3.5" fill="#EDEFF4" />
      <circle cx="24" cy="37.5" r="6" fill="#FF5A47" />
      <circle cx="96" cy="37.5" r="6" fill="#FF5A47" />
      <rect x="41" y="24" width="38" height="34" rx="3" fill="#2E7DF6" />
      <circle cx="60" cy="41" r="7" fill="none" stroke="#D6E24A" strokeWidth="3.4" />
      <rect x="49" y="6" width="22" height="17" rx="3" fill="#FFC93D" />
      <circle cx="55" cy="14" r="2.6" fill="#3A414F" />
      <circle cx="65" cy="14" r="2.6" fill="#3A414F" />
      <path d="M60 6V1" stroke="#8A93A5" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="60" cy="0.5" r="3" fill="#FF5A47" />
      <rect x="45" y="58" width="11" height="17" fill="#3A414F" />
      <rect x="64" y="58" width="11" height="17" fill="#3A414F" />
      <rect x="41" y="75" width="19" height="6" rx="1.5" fill="#FF8A3D" />
      <rect x="60" y="75" width="19" height="6" rx="1.5" fill="#FF8A3D" />
    </g>
  ),
}

/** A toothed disc. Same construction as the tray's gear glyph, drawn larger. */
function Gear({ cx, cy, r, teeth, fill, hub }) {
  const step = (Math.PI * 2) / teeth
  const inner = r * 0.78
  const at = (radius, angle) =>
    `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`
  let d = ''
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    d += `${i ? 'L' : 'M'}${at(inner, a - step * 0.24)}L${at(r, a - step * 0.13)}`
    d += `L${at(r, a + step * 0.13)}L${at(inner, a + step * 0.24)}`
  }
  return (
    <g>
      <path d={`${d}Z`} fill={fill} />
      <circle cx={cx} cy={cy} r={inner} fill={fill} />
      <circle cx={cx} cy={cy} r={inner * 0.52} fill={hub} />
      <circle cx={cx} cy={cy} r={inner * 0.2} fill="#1A1D24" />
    </g>
  )
}

export default function ExampleArt({ id }) {
  return (
    <svg className="example-art" viewBox="-4 -4 128 92" aria-hidden="true">
      {ART[id] ?? null}
    </svg>
  )
}
