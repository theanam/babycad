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
export const ChevronUpIcon = (p) => (
  <Svg width={2.4} {...p}>
    <path d="m6 14 6-6 6 6" />
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

export function ShapeIcon({ type, size = 34 }) {
  const box = { position: 'relative', width: size, height: size, flex: 'none' }
  const fill = { position: 'absolute', inset: 0 }

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
export function ColorDot({ color, type, size = 34 }) {
  const round = type === 'sphere' || type === 'torus'
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
