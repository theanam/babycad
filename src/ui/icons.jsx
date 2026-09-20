/** Stroke icons. All share one 24-grid so they optically match at any size. */
const Svg = ({ size = 20, stroke = 'currentColor', width = 2.2, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={stroke}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
)

export const UndoIcon = (p) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h9a7 7 0 0 1 0 14H8" />
  </Svg>
)
export const RedoIcon = (p) => (
  <Svg {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9h-9a7 7 0 0 0 0 14h5" />
  </Svg>
)
export const PlusIcon = (p) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const SaveIcon = (p) => (
  <Svg {...p}>
    <path d="M4 5h11l5 5v9H4z" />
    <path d="M8 5v5h7" />
  </Svg>
)
export const FolderIcon = (p) => (
  <Svg {...p}>
    <path d="M4 7h6l2 3h8v10H4z" />
  </Svg>
)
export const ExportIcon = (p) => (
  <Svg {...p}>
    <path d="M12 4v11" />
    <path d="m7 11 5 5 5-5" />
    <path d="M5 20h14" />
  </Svg>
)
export const OpenIcon = (p) => (
  <Svg {...p}>
    <path d="M12 20V9" />
    <path d="m7 13 5-5 5 5" />
    <path d="M5 4h14" />
  </Svg>
)
/** Reset the view: a near-full turn, so it reads as a circular arrow. */
export const ResetIcon = (p) => (
  <Svg {...p}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" />
    <path d="M20.5 4v5h-5" />
  </Svg>
)
export const MoveIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3v18M3 12h18" />
    <path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9 3 12l3 3M18 9l3 3-3 3" />
  </Svg>
)
export const TurnIcon = (p) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-3.3-6.5" />
    <path d="M21 4v5h-5" />
  </Svg>
)
export const SizeIcon = (p) => (
  <Svg {...p}>
    <path d="M4 14v6h6" />
    <path d="M20 10V4h-6" />
    <path d="M20 4 10 14" />
  </Svg>
)
export const PickManyIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="10" height="10" rx="2" />
    <rect x="11" y="11" width="10" height="10" rx="2" />
  </Svg>
)
export const CombineIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="9" height="9" rx="2" />
    <rect x="12" y="12" width="9" height="9" rx="2" />
    <path d="M12 8h4v4" />
  </Svg>
)
export const SplitIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <rect x="13" y="13" width="8" height="8" rx="2" />
  </Svg>
)
export const CopyIcon = (p) => (
  <Svg {...p}>
    <rect x="4" y="4" width="12" height="12" rx="2" />
    <path d="M8 20h10a2 2 0 0 0 2-2V8" />
  </Svg>
)
export const TrashIcon = (p) => (
  <Svg {...p}>
    <path d="M5 7h14" />
    <path d="M7 7l1 13h8l1-13" />
    <path d="M10 7V4h4v3" />
  </Svg>
)
export const SnapIcon = (p) => (
  <Svg {...p}>
    <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />
  </Svg>
)
export const FitIcon = (p) => (
  <Svg {...p}>
    <path d="M4 9V4h5" />
    <path d="M20 9V4h-5" />
    <path d="M4 15v5h5" />
    <path d="M20 15v5h-5" />
  </Svg>
)
export const IsoIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </Svg>
)
export const CloseIcon = (p) => (
  <Svg width={2.6} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const CheckIcon = (p) => (
  <Svg width={2.8} {...p}>
    <path d="m5 13 5 5L19 7" />
  </Svg>
)
export const ChevronUpIcon = (p) => (
  <Svg width={2.4} {...p}>
    <path d="m6 14 6-6 6 6" />
  </Svg>
)
/** A chain link: this value follows a variable. */
export const LinkIcon = (p) => (
  <Svg width={2.4} {...p}>
    <path d="M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1.1 1.1" />
    <path d="M14 11a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.7 18l1.1-1.1" />
  </Svg>
)
/** Braces: the variables themselves. */
export const VariableIcon = (p) => (
  <Svg width={2.2} {...p}>
    <path d="M9 4c-2 0-2.5 1.2-2.5 3S6 10.5 4.5 10.5C6 10.5 6.5 12 6.5 14s.5 3 2.5 3" />
    <path d="M15 4c2 0 2.5 1.2 2.5 3s.5 3.5 2 3.5c-1.5 0-2 1.5-2 3.5s-.5 3-2.5 3" />
  </Svg>
)

/* ------------------------------------------------------------------------ */

/**
 * The little "toy block" previews in the tray, drawn with clip-paths so they
 * read as solid objects with three tone steps — the same trick the design uses
 * to stand in for shading.
 */
const facets = {
  cube: ['#FFD93D', '#E0B321', '#B58C10'],
  pyramid: ['#FFB84D', '#C4782A'],
}

/**
 * The generators get flat SVG glyphs rather than the clip-path solids above:
 * a gear or a coil reads as itself in outline, and faking three tone steps on
 * one only makes it muddy at 34 pixels.
 */
const Glyph = ({ size, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    {children}
  </svg>
)

const gearPath = (teeth = 9, ro = 11, ri = 8.2, cx = 12, cy = 12) => {
  const step = (Math.PI * 2) / teeth
  const at = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`
  let d = ''
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    d += `${i ? 'L' : 'M'}${at(ri, a - step * 0.22)}L${at(ro, a - step * 0.13)}`
    d += `L${at(ro, a + step * 0.13)}L${at(ri, a + step * 0.22)}`
  }
  return d + 'Z'
}

const GLYPHS = {
  wedge: (size) => (
    <Glyph size={size}>
      <path d="M3 19 L19 19 L19 5 Z" fill="#16C1C1" />
      <path d="M19 19 L21 17 L21 3 L19 5 Z" fill="#0E8C8C" />
      <path d="M3 19 L19 19 L21 17 L5 17 Z" fill="#0B6E6E" />
    </Glyph>
  ),
  pipe: (size) => (
    <Glyph size={size}>
      <path d="M3 7 L3 17 A9 4 0 0 0 21 17 L21 7 Z" fill="#6A3FE0" />
      <ellipse cx="12" cy="7" rx="9" ry="4" fill="#9B79FF" />
      <ellipse cx="12" cy="7" rx="4" ry="1.8" fill="#3A2277" />
    </Glyph>
  ),
  star: (size) => (
    <Glyph size={size}>
      <path
        d="M12 2 L14.9 9.2 L22.5 9.7 L16.7 14.6 L18.5 22 L12 17.9 L5.5 22 L7.3 14.6 L1.5 9.7 L9.1 9.2 Z"
        fill="#D6E24A"
      />
      <path d="M12 2 L12 17.9 L5.5 22 L7.3 14.6 L1.5 9.7 L9.1 9.2 Z" fill="#A8B52F" />
    </Glyph>
  ),
  gear: (size) => (
    <Glyph size={size}>
      <path d={gearPath()} fill="#C08A5E" />
      <circle cx="12" cy="12" r="6.4" fill="#A9744F" />
      <circle cx="12" cy="12" r="2.6" fill="#1A1D24" />
    </Glyph>
  ),
  thread: (size) => (
    <Glyph size={size}>
      <rect x="7" y="2" width="10" height="20" rx="1" fill="#C3CAD9" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M7 ${4.2 + i * 4} L17 ${2.4 + i * 4} L17 ${4.6 + i * 4} L7 ${6.4 + i * 4} Z`} fill="#7E8798" />
      ))}
    </Glyph>
  ),
  spring: (size) => (
    <Glyph size={size}>
      {[0, 1, 2, 3].map((i) => (
        <ellipse
          key={i}
          cx="12"
          cy={5 + i * 4.6}
          rx="8"
          ry="2.6"
          fill="none"
          stroke={i % 2 ? '#6C7484' : '#98A1B2'}
          strokeWidth="2.4"
        />
      ))}
    </Glyph>
  ),
  knot: (size) => (
    <Glyph size={size}>
      <ellipse cx="12" cy="12" rx="9.5" ry="5" fill="none" stroke="#FF5FA2" strokeWidth="3" transform="rotate(-30 12 12)" />
      <ellipse cx="12" cy="12" rx="9.5" ry="5" fill="none" stroke="#C23C77" strokeWidth="3" transform="rotate(30 12 12)" />
      <ellipse cx="12" cy="12" rx="9.5" ry="5" fill="none" stroke="#FF8FBF" strokeWidth="3" transform="rotate(90 12 12)" />
    </Glyph>
  ),
}

export function ShapeIcon({ type, size = 34 }) {
  const box = { position: 'relative', width: size, height: size, flex: 'none' }
  const fill = { position: 'absolute', inset: 0 }

  if (GLYPHS[type]) return GLYPHS[type](size)

  if (type === 'cube') {
    const [top, left, right] = facets.cube
    return (
      <div style={box} aria-hidden="true">
        <div style={{ ...fill, background: top, clipPath: 'polygon(50% 0,100% 25%,50% 50%,0 25%)' }} />
        <div style={{ ...fill, background: left, clipPath: 'polygon(0 25%,50% 50%,50% 100%,0 75%)' }} />
        <div style={{ ...fill, background: right, clipPath: 'polygon(50% 50%,100% 25%,100% 75%,50% 100%)' }} />
      </div>
    )
  }

  if (type === 'sphere') {
    return (
      <div
        aria-hidden="true"
        style={{
          ...box,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 34% 28%, #7FB3FF 0%, #2E7DF6 46%, #1A4EA8 100%)',
        }}
      />
    )
  }

  if (type === 'cone') {
    return (
      <div style={box} aria-hidden="true">
        <div
          style={{
            position: 'absolute', left: 0, top: 0, width: size, height: size * 0.86,
            background: 'linear-gradient(100deg,#FF8A73 0%,#FF5A47 48%,#B82E20 100%)',
            clipPath: 'polygon(50% 0,100% 88%,0 88%)',
          }}
        />
        <div
          style={{
            position: 'absolute', left: 0, bottom: size * 0.06, width: size, height: size * 0.34,
            borderRadius: '50%', background: '#C33A2B',
          }}
        />
      </div>
    )
  }

  if (type === 'cylinder') {
    return (
      <div style={box} aria-hidden="true">
        <div
          style={{
            position: 'absolute', left: size * 0.08, top: size * 0.15,
            width: size * 0.84, height: size * 0.7,
            background: 'linear-gradient(100deg,#6FE3A8 0%,#35C46B 50%,#1E7B43 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute', left: size * 0.08, bottom: size * 0.01,
            width: size * 0.84, height: size * 0.3,
            borderRadius: '50%', background: '#2AA65B',
          }}
        />
        <div
          style={{
            position: 'absolute', left: size * 0.08, top: 0,
            width: size * 0.84, height: size * 0.3,
            borderRadius: '50%', background: '#7CEEB4',
          }}
        />
      </div>
    )
  }

  if (type === 'pyramid') {
    const [lit, shade] = facets.pyramid
    return (
      <div style={box} aria-hidden="true">
        <div style={{ ...fill, background: lit, clipPath: 'polygon(50% 0,100% 74%,50% 100%)' }} />
        <div style={{ ...fill, background: shade, clipPath: 'polygon(50% 0,0 74%,50% 100%)' }} />
      </div>
    )
  }

  // torus
  return (
    <div
      aria-hidden="true"
      style={{
        ...box,
        borderRadius: '50%',
        border: `${Math.round(size * 0.29)}px solid #FF5FA2`,
        boxSizing: 'border-box',
        transform: 'rotateX(58deg)',
        boxShadow: 'inset 0 0 0 1px #C23C77',
      }}
    />
  )
}

/** Flat colored proxy used in the panel when the selection is recolored. */
const ROUND_SHAPES = new Set(['sphere', 'torus', 'pipe', 'gear', 'spring', 'knot'])

export function ColorDot({ color, type, size = 34 }) {
  const round = ROUND_SHAPES.has(type)
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: round ? '50%' : 9,
        background: color,
        boxShadow: 'inset 0 -3px 0 #00000038',
      }}
    />
  )
}
