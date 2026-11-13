import { MALLORCA } from './mallorca.ts'
import { blockBitmap, BLOCK_COLS, BLOCK_ROWS } from './font.ts'

// ─── Tunables ────────────────────────────────────────────────────────────────
/** The title, one entry per board row. Each character gets its own LED block. */
export const LINES = ['INVENTARI', 'DE LA', 'DESTRUCCIO']
const BOARD_COLS = 10 // blocks per row; shorter rows are padded with blank blocks
const DEG = Math.PI / 180
const FLY_START = 0.12 // progress where LEDs start leaving the board
const FLY_SPREAD = 0.22 // left→right stagger across the board
const FLY_DUR = 0.42 // per-LED flight length (in progress units)

// Placeholder data: random clusters of rural construction. Replace with real data later.
const DATA_SEED = 11
const DATA_CLUSTERS = 40

// Colours. Lit LEDs are data (amber); unlit LEDs are basemap (grey). Same colours on the map.
export type Theme = {
  bg: number[]
  block: number[] // LED block housing
  off: number[] // unlit LED = basemap
  on: number[] // lit LED = data
  coast: number[] // basemap dots on the coastline
  shape: 'circle' | 'diamond' | 'emoji'
  emoji?: string // with shape 'emoji': the character drawn for every dot, tinted with `on`
  target?: TargetName // what the dots form at the end (default: Mallorca)
  lines?: string[] // board text: exactly 3 lines of ≤ 10 characters (default: LINES)
  rainbow?: boolean // emoji only: unlit dots sweep through the rainbow as you scroll
  fx?: boolean // shooting stars + hearts rising from the target's emitters, driven by scroll
}
export const DEFAULT_THEME: Theme = {
  bg: [6, 6, 6],
  block: [18, 17, 16],
  off: [38, 36, 33],
  on: [255, 204, 36], // warm yellow
  coast: [74, 71, 65], // a touch lighter than unlit LEDs
  shape: 'circle',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const mix = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pair two equally sized point sets one-to-one, keeping neighbours together:
 * cut both into the same number of vertical bands (equal counts), then pair
 * top-to-bottom within each band.
 */
function pairUp<A extends { u: number; v: number }, B extends { u: number; v: number }>(a: A[], b: B[]) {
  const n = a.length
  const bands = Math.max(1, Math.round(Math.sqrt(n / 3)))
  const sa = [...a].sort((p, q) => p.u - q.u)
  const sb = [...b].sort((p, q) => p.u - q.u)
  const out: [A, B][] = []
  for (let i = 0; i < bands; i++) {
    const from = Math.floor((i * n) / bands), to = Math.floor(((i + 1) * n) / bands)
    const ba = sa.slice(from, to).sort((p, q) => p.v - q.v)
    const bb = sb.slice(from, to).sort((p, q) => p.v - q.v)
    ba.forEach((p, j) => out.push([p, bb[j]]))
  }
  return out
}

// ─── Geography ───────────────────────────────────────────────────────────────
const LON0 = 2.9125
const LAT0 = 39.6185
const KX = Math.cos(LAT0 * DEG)
const BBOX = { w: (3.476 - 2.349) * KX, h: 39.969 - 39.268 } // in "degrees of latitude"
const PALMA = { lon: 2.6502, lat: 39.5696 }

function onIsland(lon: number, lat: number) {
  let inside = false
  for (let i = 0, j = MALLORCA.length - 1; i < MALLORCA.length; j = i++) {
    const [xi, yi] = MALLORCA[i]
    const [xj, yj] = MALLORCA[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToCoast(x: number, y: number) {
  let best = Infinity
  for (let i = 0; i < MALLORCA.length - 1; i++) {
    const ax = MALLORCA[i][0] * KX, ay = MALLORCA[i][1]
    const bx = MALLORCA[i + 1][0] * KX, by = MALLORCA[i + 1][1]
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    if (len2 === 0) continue // the ring repeats its first point at the end
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / len2)
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy))
  }
  return best
}

/** Signed distance to the coastline (in degrees of latitude): positive inland. */
function landness(lon: number, lat: number) {
  const d = distToCoast(lon * KX, lat)
  return onIsland(lon, lat) ? d : -d
}

/** Area of the island in "degrees of latitude" squared (shoelace formula). */
const ISLAND_AREA = Math.abs(
  MALLORCA.reduce((sum, [x1, y1], i) => {
    const [x2, y2] = MALLORCA[(i + 1) % MALLORCA.length]
    return sum + (x1 * KX * y2 - x2 * KX * y1)
  }, 0) / 2,
)

// ─── Targets: the shape the dots settle into ─────────────────────────────────
// Each target is a field in its own units (x right, y down, centred on 0):
// score > 0 inside, higher further in. Exactly N cells with the highest score are kept.
type Pt = [number, number]
type Target = {
  w: number; h: number; area: number
  score?: (x: number, y: number) => number // smooth field, > 0 inside
  inside?: (x: number, y: number) => boolean // or a plain mask, ranked by distance to its edge on the grid
  urban?: (x: number, y: number) => boolean
  emitters?: Pt[] // points things can rise from (e.g. tower tips), in target units
}
export type TargetName = 'mallorca' | 'heart' | 'castle'

// Classic heart curve (x² + y² − 1)³ − x²y³ ≤ 0, y up; spans x ±1.14, y −1…1.25.
const heartField = (x: number, y: number) => {
  const Y = -y + 0.125 // to y-up, and centre the bounding box vertically
  return -((x * x + Y * Y - 1) ** 3 - x * x * Y ** 3)
}
const HEART_AREA = (() => {
  let inside = 0
  const n = 400
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) if (heartField(-1.2 + (2.4 * (i + 0.5)) / n, -1.2 + (2.4 * (j + 0.5)) / n) > 0) inside++
  return (inside / (n * n)) * 2.4 * 2.4
})()

// A generic fairytale castle, built from boxes and cones (units: 10 wide, y down).
const box = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1
const cone = (apex: Pt, x0: number, x1: number, base: number) => (x: number, y: number) =>
  y <= base && y >= apex[1] && Math.abs(x - apex[0]) <= ((y - apex[1]) / (base - apex[1])) * ((x1 - x0) / 2)
const tower = (cx: number, half: number, top: number, roof: number) => [
  box(cx - half, top, cx + half, 10),
  cone([cx, roof], cx - half - 0.25, cx + half + 0.25, top),
]
const CASTLE_SOLID = [
  box(1, 6.2, 9, 10), // curtain wall
  ...tower(5, 1.5, 3.2, 0.2), // keep
  ...tower(1.7, 0.7, 3.8, 1.4), // outer towers
  ...tower(8.3, 0.7, 3.8, 1.4),
  ...tower(3.05, 0.45, 5.2, 3.4), // inner towers
  ...tower(6.95, 0.45, 5.2, 3.4),
]
const CASTLE_HOLES = [
  (x: number, y: number) => (Math.abs(x - 5) <= 0.6 && y >= 8.2) || Math.hypot(x - 5, y - 8.2) <= 0.6, // arched gate
  box(4.65, 4.3, 5.35, 5.4), // keep window
  // crenellations along the wall top, between the towers
  ...[2.6, 3.9, 6.1, 7.4].flatMap((x) => [box(x - 0.2, 6.2, x + 0.2, 6.6)]),
]
const castleInside = (x: number, y: number) => {
  const X = x + 5, Y = y + 5 // centre → castle units
  return CASTLE_SOLID.some((f) => f(X, Y)) && !CASTLE_HOLES.some((f) => f(X, Y))
}
const areaOf = (inside: (x: number, y: number) => boolean, w: number, h: number) => {
  let n = 0
  const steps = 400
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < steps; j++) if (inside(-w / 2 + (w * (i + 0.5)) / steps, -h / 2 + (h * (j + 0.5)) / steps)) n++
  return (n / steps ** 2) * w * h
}

const TARGETS: Record<TargetName, Target> = {
  mallorca: {
    w: BBOX.w, h: BBOX.h, area: ISLAND_AREA,
    score: (x, y) => landness(LON0 + x / KX, LAT0 - y),
    urban: (x, y) => Math.hypot(x - (PALMA.lon - LON0) * KX, LAT0 - y - PALMA.lat) < 0.06,
  },
  heart: { w: 2.3, h: 2.3, area: HEART_AREA, score: heartField },
  castle: {
    w: 10, h: 10, area: areaOf(castleInside, 10, 10), inside: castleInside,
    emitters: [[5, 0.2], [1.7, 1.4], [8.3, 1.4], [3.05, 3.4], [6.95, 3.4]].map(([x, y]) => [x - 5, y - 5] as Pt), // roof tips
  },
}

// ─── Shared grid ─────────────────────────────────────────────────────────────
// Board and map live on ONE square lattice with spacing P, centred on the screen.
// Board: 7×9 LED blocks separated by one empty cell, so it is an exact patch of
// the lattice. Map: the island scaled so it covers exactly as many cells as the
// board has LEDs. Every LED moves from one lattice cell to another.
const GAP_CELLS = 1 // empty cells between blocks
const BOARD_X = BOARD_COLS * BLOCK_COLS + (BOARD_COLS - 1) * GAP_CELLS // 79 cells
const BOARD_Y = LINES.length * BLOCK_ROWS + (LINES.length - 1) * GAP_CELLS // 29 cells
const N_LEDS = BOARD_COLS * LINES.length * BLOCK_COLS * BLOCK_ROWS
// Cells per target unit, so the target's area is exactly N_LEDS cells.
const targetScale = (t: Target) => Math.sqrt(N_LEDS / t.area)
// Lattice offset (0 or ½ cell) so board cells and map cells coincide.
const FX = ((BOARD_X - 1) / 2) % 1
const FY = ((BOARD_Y - 1) / 2) % 1

/** Lattice spacing P and the screen box of the board at rest. Both board and target fit. */
export function boardBox(vw: number, vh: number, target: TargetName = 'mallorca') {
  const t = TARGETS[target], cells = targetScale(t)
  const P = Math.min((vw * 0.9) / BOARD_X, (vh * 0.6) / BOARD_Y, (vw * 0.88) / (t.w * cells), (vh * 0.88) / (t.h * cells))
  return { x: vw / 2 - (BOARD_X * P) / 2, y: vh / 2 - (BOARD_Y * P) / 2, w: BOARD_X * P, h: BOARD_Y * P, P }
}

function hslRgb(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return [f(0), f(8), f(4)]
}

/** Render an emoji into a small canvas, optionally recoloured with `tint` (keeps its shading). */
function makeSprite(emoji: string, tint?: number[]) {
  const size = 96
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const draw = () => {
    g.font = `${size * 0.8}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(emoji, size / 2, size / 2 + size * 0.04)
  }
  draw()
  if (!tint) return c
  g.globalCompositeOperation = 'color' // take hue and saturation from the tint, lightness from the emoji
  g.fillStyle = rgb(tint)
  g.fillRect(0, 0, size, size)
  g.globalCompositeOperation = 'destination-in' // trim back to the emoji's own shape
  draw()
  return c
}

// ─── Scene ───────────────────────────────────────────────────────────────────
type Particle = {
  tx: number; ty: number; ts: number; tc: number[] // LED on the board
  mx: number; my: number; ms: number; mc: number[] // its dot on the map
  delay: number
}
type Rect = { x: number; y: number; w: number; h: number }

export type Scene = ReturnType<typeof createScene>

/**
 * Departures-board title → dot map of Mallorca, strictly one-to-one:
 * the map has exactly as many dots as the board has LEDs. Each lit LED is one
 * data dot; each unlit LED is one basemap dot.
 * `draw(p)` renders progress p ∈ [0, 1] once; nothing animates on its own.
 */
export function createScene(canvas: HTMLCanvasElement, theme: Theme = DEFAULT_THEME) {
  const { bg: BG, block: BLOCK, off: OFF, on: ON, coast: COAST } = theme
  const target = TARGETS[theme.target ?? 'mallorca']
  const ctx = canvas.getContext('2d')!
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let dpr = 1
  let W = 0, H = 0
  let blocks: Rect[] = []
  let particles: Particle[] = []
  let emitters: Pt[] = [] // screen offsets from centre
  let fxScale = 1 // lattice spacing, sizes the effects

  function build(vw: number, vh: number) {
    const rand = rng(7)

    // ── Board: one 7×9 LED block per character, on the lattice. Coordinates relative to screen centre.
    const { P } = boardBox(vw, vh, theme.target)
    const B = P * 0.72 // LED diameter, identical on the board and on the map
    const cellX = (i: number) => (i - (BOARD_X - 1) / 2) * P // board cell column → x
    const cellY = (j: number) => (j - (BOARD_Y - 1) / 2) * P // board cell row → y
    type Led = { x: number; y: number; u: number; v: number }
    const lit: Led[] = []
    const unlit: Led[] = []
    blocks = []
    const inset = P * 0.12 // housing stops short of the empty cells between blocks
    ;(theme.lines ?? LINES).forEach((line, row) => {
      ;[...line.padEnd(BOARD_COLS, ' ')].slice(0, BOARD_COLS).forEach((ch, col) => {
        const i0 = col * (BLOCK_COLS + GAP_CELLS)
        const j0 = row * (BLOCK_ROWS + GAP_CELLS)
        blocks.push({
          x: cellX(i0) - P / 2 + inset, y: cellY(j0) - P / 2 + inset,
          w: BLOCK_COLS * P - 2 * inset, h: BLOCK_ROWS * P - 2 * inset,
        })
        blockBitmap(ch).forEach((cells, r) =>
          cells.forEach((on, c) => {
            const i = i0 + c, j = j0 + r
            ;(on ? lit : unlit).push({ x: cellX(i), y: cellY(j), u: i / (BOARD_X - 1), v: j / (BOARD_Y - 1) })
          }),
        )
      })
    })
    const N = lit.length + unlit.length // === N_LEDS

    // ── Map: the target scaled to cover N lattice cells; keep exactly the N highest-scoring cells.
    const k = P * targetScale(target) // screen px per target unit
    const Wm = target.w * k, Hm = target.h * k
    const ci = Math.ceil(Wm / P / 2) + 3, cj = Math.ceil(Hm / P / 2) + 3
    const candidates: { x: number; y: number; i: number; j: number; score: number }[] = []
    for (let j = -cj; j <= cj; j++)
      for (let i = -ci; i <= ci; i++) {
        const x = (i + FX) * P, y = (j + FY) * P // same lattice as the board
        candidates.push({ x, y, i, j, score: target.score ? target.score(x / k, y / k) : target.inside!(x / k, y / k) ? 1 : -1 })
      }
    if (!target.score) {
      // Mask target: score = cells to the edge (positive inside, negative outside), via BFS.
      const cols = 2 * ci + 1
      const at = (i: number, j: number) => candidates[(j + cj) * cols + (i + ci)]
      const dist = new Map<object, number>()
      let frontier = candidates.filter((c) =>
        [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
          const n = at(c.i + di, c.j + dj)
          return n && n.score !== c.score
        }),
      )
      frontier.forEach((c) => dist.set(c, 1))
      for (let d = 2; frontier.length; d++) {
        const next: typeof candidates = []
        for (const c of frontier)
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = at(c.i + di, c.j + dj)
            if (n && !dist.has(n)) { dist.set(n, d); next.push(n) }
          }
        frontier = next
      }
      for (const c of candidates) c.score *= dist.get(c) ?? 1
    }
    candidates.sort((a, b) => b.score - a.score)
    const kept = candidates.slice(0, N)
    const keptCells = new Set(kept.map((d) => `${d.i},${d.j}`))
    const isCoast = (d: { i: number; j: number }) =>
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => !keptCells.has(`${d.i + di},${d.j + dj}`))

    type Dot = { x: number; y: number; s: number; c: number[]; u: number; v: number; urban: boolean }
    // Basemap dots keep the unlit colour (a touch lighter on the edge); data dots stay lit.
    const dots: Dot[] = kept.map((d) => ({
      x: d.x, y: d.y, s: B, c: isCoast(d) ? COAST : OFF,
      u: (d.x + Wm / 2) / Wm, v: (d.y + Hm / 2) / Hm,
      urban: target.urban?.(d.x / k, d.y / k) ?? false,
    }))
    const s = P // lattice spacing, used to size the placeholder data clusters

    emitters = (target.emitters ?? []).map(([ex, ey]) => [ex * k, ey * k] as Pt)
    fxScale = P

    // ── Placeholder data: exactly as many construction dots as lit LEDs.
    // Weighted random pick (Efraimidis–Spirakis): clustered, none in Palma's urban area.
    const drand = rng(DATA_SEED)
    const clusters = Array.from({ length: DATA_CLUSTERS }, () => {
      const d = dots[Math.floor(drand() * dots.length)]
      return { x: d.x, y: d.y, sigma: s * (1.5 + drand() * 3.5), w: 0.4 + drand() * 0.6 }
    })
    const weighted = dots.map((d) => {
      let w = 0.02
      for (const c of clusters) w += c.w * Math.exp(-((d.x - c.x) ** 2 + (d.y - c.y) ** 2) / (2 * c.sigma ** 2))
      return { d, key: d.urban ? -1 : Math.pow(drand(), 1 / w) }
    })
    weighted.sort((a, b) => b.key - a.key)
    const dataDots = weighted.slice(0, lit.length).map((w) => w.d)
    const baseDots = weighted.slice(lit.length).map((w) => w.d)
    for (const d of dataDots) d.c = ON

    // ── One LED ↔ one dot.
    const mk = ([led, dot]: [Led, Dot], tc: number[], extraDelay: number): Particle => ({
      tx: led.x, ty: led.y, ts: B, tc,
      mx: dot.x, my: dot.y, ms: dot.s, mc: dot.c,
      delay: led.u * FLY_SPREAD + led.v * 0.05 + rand() * 0.05 + extraDelay,
    })
    particles = [
      ...pairUp(unlit, baseDots).map((pr) => mk(pr, OFF, 0)),
      ...pairUp(lit, dataDots).map((pr) => mk(pr, ON, 0.06)), // data lands last, on top
    ]

  }

  // ─── Batched round LEDs ─────────────────────────────────────────────────────
  // Dots are grouped by colour into one path each and filled in one call.
  // Coordinates are relative to the screen centre.
  let batch = new Map<string, Path2D>()
  const quantKey = (c: number[]) => rgb(c.map((v) => Math.min(255, Math.round(v / 6) * 6)))

  // Emoji dots: draw the emoji once, tinted with the lit colour, then stamp it.
  // Brightness (relative to lit vs background) becomes opacity, so unlit dots are faint.
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const emoji = theme.shape === 'emoji' ? theme.emoji ?? '💎' : null
  const litSprite = emoji ? makeSprite(emoji) : null // lit dots: the original emoji
  const offSprite = emoji ? makeSprite(emoji, ON) : null // unlit dots: tinted, faint
  const HUES = 24
  const rainbowSprites = emoji && theme.rainbow
    ? Array.from({ length: HUES }, (_, h) => makeSprite(emoji, hslRgb((h * 360) / HUES, 0.55, 0.7)))
    : null
  let phase = 0 // rainbow offset, driven by scroll

  function led(x: number, y: number, size: number, color: number[], lit = false) {
    if (litSprite && offSprite) {
      const a = clamp((lum(color) - lum(BG)) / (lum(ON) - lum(BG)))
      if (a < 0.01) return
      const S = size * (lit ? 1.65 : 1.35) // emoji glyphs have built-in padding; lit ones a bit bigger
      ctx.globalAlpha = a
      let img = lit ? litSprite : offSprite
      if (!lit && rainbowSprites) {
        // Diagonal rainbow bands that slide as you scroll.
        const h = ((x + y * 0.6) / Math.max(W, H)) * 2.5 + phase
        img = rainbowSprites[(((Math.floor(h * HUES) % HUES) + HUES) % HUES)]
        ctx.globalAlpha = Math.min(0.5, a * 1.7) // a little brighter than plain unlit dots, still soft
      }
      ctx.drawImage(img, W / 2 + x - S / 2, H / 2 + y - S / 2, S, S)
      return
    }
    const key = quantKey(color)
    let path = batch.get(key)
    if (!path) { path = new Path2D(); batch.set(key, path) }
    // One LED: a circle (or diamond) of width `size`.
    const cx = W / 2 + x, cy = H / 2 + y, r = Math.max(size / 2, 0.5)
    if (theme.shape === 'diamond') {
      const d = r * 1.15 // a diamond looks smaller than a circle of the same width
      path.moveTo(cx, cy - d)
      path.lineTo(cx + d, cy)
      path.lineTo(cx, cy + d)
      path.lineTo(cx - d, cy)
      path.closePath()
    } else {
      path.moveTo(cx + r, cy)
      path.arc(cx, cy, r, 0, Math.PI * 2)
    }
  }

  function flush() {
    ctx.globalAlpha = 1
    for (const [key, path] of batch) { ctx.fillStyle = key; ctx.fill(path) }
    batch = new Map()
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2)
    W = canvas.clientWidth
    H = canvas.clientHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    build(W, H)
  }

  /** LED block housings. `fade` 0 = visible, 1 = gone. */
  function drawBlocks(fade: number) {
    ctx.fillStyle = rgb(mix(BLOCK, BG, fade))
    for (const r of blocks) ctx.fillRect(W / 2 + r.x, H / 2 + r.y, r.w, r.h)
  }

  function drawBoard(fade: number) {
    drawBlocks(fade)
    for (const q of particles) led(q.tx, q.ty, q.ts, mix(q.tc, BG, fade), q.tc === ON)
    flush()
  }

  function drawMap(visibility: number) {
    for (const q of particles) led(q.mx, q.my, q.ms, mix(BG, q.mc, visibility), q.tc === ON)
    flush()
  }

  // ─── Effects (scroll-driven, no clock): shooting stars and rising hearts ─────
  const heartSprite = theme.fx ? makeSprite('💖') : null
  const starSprite = theme.fx ? makeSprite('⭐') : null
  const HEARTS_PER_TOWER = 5
  const STARS = 3

  /** `t` advances with scroll; `show` fades the effects in once the figure has formed. */
  function drawFx(t: number, show: number) {
    if (!heartSprite || !starSprite || show <= 0) return
    const unit = fxScale

    // Hearts: each tower tip releases a stream that rises, sways and fades.
    emitters.forEach(([ex, ey], e) => {
      for (let i = 0; i < HEARTS_PER_TOWER; i++) {
        const life = (((t * 3.2 + i / HEARTS_PER_TOWER + e * 0.13) % 1) + 1) % 1 // 0 → 1, loops with scroll
        const rise = life * unit * 14
        const sway = Math.sin(life * Math.PI * 3 + e * 1.7 + i * 2.1) * unit * 1.4
        const size = unit * (1.1 + life * 1.3)
        ctx.globalAlpha = show * Math.sin(Math.PI * life) * 0.95
        ctx.drawImage(heartSprite, W / 2 + ex + sway - size / 2, H / 2 + ey - unit - rise - size / 2, size, size)
      }
    })

    // Shooting stars: streaks crossing the sky from upper left to the right.
    for (let j = 0; j < STARS; j++) {
      const s = t * 2.2 - j * 0.45 // each star starts a little later
      const life = ((s % 1) + 1) % 1
      const x0 = -0.1 * W + j * 0.18 * W, y0 = 0.06 * H + j * 0.07 * H
      const x1 = x0 + 0.75 * W, y1 = y0 + 0.28 * H
      const hx = lerp(x0, x1, life), hy = lerp(y0, y1, life)
      const tail = 0.16
      const tx = lerp(x0, x1, Math.max(0, life - tail)), ty = lerp(y0, y1, Math.max(0, life - tail))
      const fade = show * Math.sin(Math.PI * life)
      const grad = ctx.createLinearGradient(tx, ty, hx, hy)
      grad.addColorStop(0, 'rgba(255,200,235,0)')
      grad.addColorStop(1, `rgba(255,240,250,${0.9 * fade})`)
      ctx.globalAlpha = 1
      ctx.strokeStyle = grad
      ctx.lineWidth = Math.max(1.5, unit * 0.35)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(hx, hy)
      ctx.stroke()
      const size = unit * 2.2
      ctx.globalAlpha = fade
      ctx.drawImage(starSprite, hx - size / 2, hy - size / 2, size, size)
    }
    ctx.globalAlpha = 1
  }

  /** Render progress p (0 = board, 1 = map). `rainbow` shifts the rainbow, `fx` drives the effects. */
  function draw(p: number, rainbow = 0, fx = 0) {
    drawDots(p, rainbow)
    if (theme.fx && !reducedMotion.matches) drawFx(fx, smooth(0.75, 0.95, p))
  }

  function drawDots(p: number, rainbow: number) {
    phase = rainbow
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = rgb(BG)
    ctx.fillRect(0, 0, W, H)

    if (p <= 0.0005) return drawBoard(0)
    if (p >= 0.9995) return drawMap(1)
    if (reducedMotion.matches) {
      // Crossfade only, no moving LEDs.
      const c = smooth(0.35, 0.65, p)
      if (c < 1) drawBoard(c)
      if (c > 0) drawMap(c)
      return
    }

    // In between: housings fade, every LED moves to its own dot on the island.
    const blockFade = smooth(0.02, 0.16, p)
    if (blockFade < 1) drawBlocks(blockFade)
    for (const q of particles) {
      const l = ease(clamp((p - FLY_START - q.delay) / FLY_DUR))
      led(lerp(q.tx, q.mx, l), lerp(q.ty, q.my, l), lerp(q.ts, q.ms, l), mix(q.tc, q.mc, l), q.tc === ON)
    }
    flush()
  }

  return { resize, draw, get ledCount() { return particles.length } }
}
