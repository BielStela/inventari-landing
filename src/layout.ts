// Generator for src/morph.json: the board, the island, the data and the route of
// every LED, in GRID UNITS (1 = the board's LED spacing), centred on (0, 0).
// Runs at build time only (`pnpm morph`); the page just reads the JSON.
// Data: data/change.json, from the change-probability raster (`pnpm prepare-data`).
import { MALLORCA } from './mallorca.ts'
import { blockBitmap, BLOCK_COLS, BLOCK_ROWS } from './font.ts'
import { QUARTERS, DROPPED, BASE, COASTAL, DATA, type Morph } from './morph-format.ts'
import { rng } from './rng.ts'

// ─── Tunables ────────────────────────────────────────────────────────────────
/** The title, one entry per board row. Each character gets its own LED block. */
const LINES = ['INVENTARI', 'DE LA', 'DESTRUCCIO']
const BOARD_COLS = 10 // blocks per row; shorter rows are padded with blank blocks
const GAP_CELLS = 1 // empty cells between blocks

// ─── Helpers ─────────────────────────────────────────────────────────────────
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

// ─── Geography ───────────────────────────────────────────────────────────────
const DEG = Math.PI / 180
const LON0 = 2.9125
const LAT0 = 39.6185
const KX = Math.cos(LAT0 * DEG)
const BBOX = { w: (3.476 - 2.349) * KX, h: 39.969 - 39.268 } // in "degrees of latitude"

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

// ─── Shared grid ─────────────────────────────────────────────────────────────
// Board and map share ONE square lattice (spacing 1). Board: 7×9 LED blocks
// separated by one empty cell. Island: scaled so its area is exactly N_LEDS cells.
const BOARD_X = BOARD_COLS * BLOCK_COLS + (BOARD_COLS - 1) * GAP_CELLS // 79 cells
const BOARD_Y = LINES.length * BLOCK_ROWS + (LINES.length - 1) * GAP_CELLS // 29 cells
const N_LEDS = BOARD_COLS * LINES.length * BLOCK_COLS * BLOCK_ROWS
const ISLAND_SCALE = Math.sqrt(N_LEDS / ISLAND_AREA) // grid units per degree of latitude
const ISLAND_X = BBOX.w * ISLAND_SCALE
const ISLAND_Y = BBOX.h * ISLAND_SCALE
// Lattice offset (0 or ½ cell) of the board cells around the centre.
const FX = ((BOARD_X - 1) / 2) % 1
const FY = ((BOARD_Y - 1) / 2) % 1

// ─── Morph ───────────────────────────────────────────────────────────────────
// The map is the board's grid, subdivided: the island is covered by N_LEDS
// board-sized cells ("tiles"), and each tile is split into 2×2 quarter cells.
// Each LED flies to one tile as a single dot (an order-preserving rubber-sheet
// mapping: board left→right, top→bottom becomes island west→east, north→south),
// then splits into the tile's quarters. Quarters that fall in the sea are dropped,
// so the coastline gets the finer resolution.

/** Rows of [lon, lat, m², use]: expected converted area per block (see scripts/prepare-data.ts). */
export type Construction = [number, number, number, string]
export type DataOptions = {
  points: Construction[]
  sigma: number // heatmap kernel radius, in board cells
  gamma: number // tone curve on the density: < 1 lifts the sparse tail, 1 = linear
  pressureSigma: number // kernel radius (board cells) of the growth-pressure field used by sprawl
}

export function computeMorph(timing: { spread: number; dataDelay: number }, data: DataOptions): Morph {
  // ── Board
  const cellX = (i: number) => i - (BOARD_X - 1) / 2
  const cellY = (j: number) => j - (BOARD_Y - 1) / 2
  type Led = { x: number; y: number; lit: boolean; u: number; v: number }
  const leds: Led[] = []
  const blocks: number[][] = []
  const inset = 0.12 // housing stops short of the empty cells between blocks
  LINES.forEach((line, row) => {
    ;[...line.padEnd(BOARD_COLS, ' ')].slice(0, BOARD_COLS).forEach((ch, col) => {
      const i0 = col * (BLOCK_COLS + GAP_CELLS)
      const j0 = row * (BLOCK_ROWS + GAP_CELLS)
      blocks.push([cellX(i0) - 0.5 + inset, cellY(j0) - 0.5 + inset, BLOCK_COLS - 2 * inset, BLOCK_ROWS - 2 * inset])
      blockBitmap(ch).forEach((cells, r) =>
        cells.forEach((on, c) => {
          const i = i0 + c, j = j0 + r
          leds.push({ x: cellX(i), y: cellY(j), lit: on, u: i / (BOARD_X - 1), v: j / (BOARD_Y - 1) })
        }),
      )
    })
  })
  const N = leds.length
  const nLit = leds.filter((l) => l.lit).length

  // ── Tiles: the N most inland cells of the board lattice.
  const toLon = (x: number) => LON0 + x / (KX * ISLAND_SCALE)
  const toLat = (y: number) => LAT0 - y / ISLAND_SCALE
  const land = (x: number, y: number) => landness(toLon(x), toLat(y))
  const ci = Math.ceil(ISLAND_X / 2) + 3, cj = Math.ceil(ISLAND_Y / 2) + 3
  const cells: { x: number; y: number; score: number }[] = []
  for (let j = -cj; j <= cj; j++)
    for (let i = -ci; i <= ci; i++) {
      const x = i + FX, y = j + FY // same lattice as the board
      cells.push({ x, y, score: land(x, y) })
    }
  cells.sort((a, b) => b.score - a.score)
  type Tile = { x: number; y: number; q: { x: number; y: number; land: number; kind: number }[]; data: boolean }
  const tiles: Tile[] = cells.slice(0, N).map(({ x, y }) => {
    const q = QUARTERS.map(([dx, dy]) => ({ x: x + dx, y: y + dy, land: land(x + dx, y + dy), kind: BASE }))
    // Quarters in the sea are dropped; every tile keeps at least its most inland quarter.
    const best = Math.max(...q.map((c) => c.land))
    for (const c of q) if (c.land < 0 && c.land !== best) c.kind = DROPPED
    return { x, y, q, data: false }
  })
  // Coastline: kept quarters with a missing neighbour (quarter spacing is 0.5).
  const keptQ = new Set(tiles.flatMap((t) => t.q.filter((c) => c.kind).map((c) => `${c.x * 4},${c.y * 4}`)))
  for (const t of tiles)
    for (const c of t.q)
      if (c.kind && [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([a, b]) => !keptQ.has(`${c.x * 4 + a},${c.y * 4 + b}`))) c.kind = COASTAL

  // ── Data: a heatmap of the converted area (Gaussian kernel density, σ in board
  // cells), then DITHERED onto the tiles so the share of lit tiles follows the
  // local density: solid cores, speckled periphery, the odd dot where it's thin.
  const pts = data.points.map(([lon, lat, area]) => ({
    x: (lon - LON0) * KX * ISLAND_SCALE,
    y: -(lat - LAT0) * ISLAND_SCALE,
    w: area,
  }))
  /** Kernel density at (x, y) with a Gaussian of radius sigma (cut off at 3σ). */
  const kernel = (sigma: number) => {
    const s2 = 2 * sigma ** 2, reach = 3 * sigma
    return (x: number, y: number) => {
      let d = 0
      for (const p of pts) {
        const dx = p.x - x, dy = p.y - y
        if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue
        d += p.w * Math.exp(-(dx * dx + dy * dy) / s2)
      }
      return d
    }
  }
  const density = kernel(data.sigma)
  const qDensity = new Map<object, number>()
  for (const t of tiles) for (const c of t.q) if (c.kind) qDensity.set(c, density(c.x, c.y))

  // Pressure: the same heatmap with a much wider kernel, so it reaches past the
  // built cells into the countryside around them. Normalised at the 99th
  // percentile (so one quarry doesn't flatten the rest), square-root toned,
  // quantised to 0–15.
  const pressureAt = kernel(data.pressureSigma)
  const qPressure = new Map<object, number>()
  for (const t of tiles) for (const c of t.q) if (c.kind) qPressure.set(c, pressureAt(c.x, c.y))
  const sortedP = [...qPressure.values()].sort((a, b) => a - b)
  const p99 = sortedP[Math.floor(0.99 * (sortedP.length - 1))] || 1
  const pressure4 = (c: object) => Math.round(15 * Math.sqrt(Math.min(1, (qPressure.get(c) ?? 0) / p99)))
  // Tile value in [0, 1]: its quarters' density, normalised, through a tone curve
  // (gamma < 1 lifts the sparse tail so it isn't swallowed by the densest cores).
  const raw = tiles.map((t) => t.q.reduce((sum, c) => sum + (qDensity.get(c) ?? 0), 0))
  const rawMax = Math.max(...raw)
  const value = raw.map((v) => (v / rawMax) ** data.gamma)

  // Floyd–Steinberg error diffusion over the tile lattice (serpentine rows).
  const at = new Map(tiles.map((t, i) => [`${t.x},${t.y}`, i]))
  const rows = [...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b)
  const xs = tiles.map((t) => t.x)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const dither = (k: number) => {
    const err = new Float64Array(tiles.length)
    const on = new Uint8Array(tiles.length)
    rows.forEach((y, r) => {
      const dir = r % 2 ? -1 : 1
      for (let x = dir > 0 ? xMin : xMax; dir > 0 ? x <= xMax : x >= xMin; x += dir) {
        const i = at.get(`${x},${y}`)
        if (i === undefined) continue
        const v = Math.min(1, k * value[i]) + err[i]
        on[i] = v >= 0.5 ? 1 : 0
        const e = v - on[i]
        const spread = (dx: number, dy: number, w: number) => {
          const j = at.get(`${x + dx * dir},${y + dy}`)
          if (j !== undefined) err[j] += e * w
        }
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16)
      }
    })
    return on
  }
  // Find the field scale k that lights (as near as possible) exactly nLit tiles…
  let lo = 0, hi = 64, best = dither(1), bestK = 1
  const count = (on: Uint8Array) => on.reduce((s, v) => s + v, 0)
  for (let it = 0; it < 50; it++) {
    const k = (lo + hi) / 2, on = dither(k), c = count(on)
    if (Math.abs(c - nLit) < Math.abs(count(best) - nLit)) { best = on; bestK = k }
    if (c === nLit) break
    if (c < nLit) lo = k; else hi = k
  }
  // …then fix any remainder by density: drop the faintest lit tiles or add the densest unlit ones.
  const byValue = tiles.map((_, i) => i).sort((a, b) => value[b] - value[a])
  let c = count(best)
  for (const i of [...byValue].reverse()) { if (c <= nLit) break; if (best[i]) { best[i] = 0; c-- } }
  for (const i of byValue) { if (c >= nLit) break; if (!best[i]) { best[i] = 1; c++ } }

  // Inside each lit tile, its share of 4 quarters follows its (scaled) value: the
  // densest quarters light first, at least one.
  tiles.forEach((t, i) => {
    if (!best[i]) return
    t.data = true
    const kept = t.q.filter((q) => q.kind).sort((a, b) => qDensity.get(b)! - qDensity.get(a)!)
    const n = Math.max(1, Math.min(kept.length, Math.round(4 * Math.min(1, bestK * value[i]))))
    for (const q of kept.slice(0, n)) q.kind = DATA
  })

  // ── Rubber-sheet pairing, lit LEDs ↔ data tiles and unlit LEDs ↔ the other tiles.
  const rand = rng(7)
  const out: number[][] = []
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  const route = (from: Led[], to: Tile[], extraDelay: number) => {
    for (const [led, t] of pairUp(from, to)) {
      const delay = led.u * timing.spread + led.v * 0.05 + rand() * 0.05 + extraDelay
      const packed = t.q.reduce((acc, c, k) => acc | (c.kind << (2 * k)), 0)
      const pressure = t.q.reduce((acc, c, k) => acc | ((c.kind ? pressure4(c) : 0) << (4 * k)), 0)
      out.push([led.x, led.y, +led.lit, t.x, t.y, r3(delay), packed, pressure])
    }
  }
  route(leds.filter((l) => !l.lit), tiles.filter((t) => !t.data), 0)
  route(leds.filter((l) => l.lit), tiles.filter((t) => t.data), timing.dataDelay) // data lands last, on top

  return { board: [BOARD_X, BOARD_Y], island: [r3(ISLAND_X), r3(ISLAND_Y)], blocks: blocks.map((b) => b.map(r3)), leds: out }
}

/**
 * Pair two equally sized point sets one-to-one, keeping neighbours together:
 * cut both into the same number of vertical bands (equal counts), then pair
 * top-to-bottom within each band.
 */
function pairUp<A extends { x: number; y: number }, B extends { x: number; y: number }>(a: A[], b: B[]) {
  const n = a.length
  const bands = Math.max(1, Math.round(Math.sqrt(n / 3)))
  const sa = [...a].sort((p, q) => p.x - q.x)
  const sb = [...b].sort((p, q) => p.x - q.x)
  const out: [A, B][] = []
  for (let i = 0; i < bands; i++) {
    const from = Math.floor((i * n) / bands), to = Math.floor(((i + 1) * n) / bands)
    const ba = sa.slice(from, to).sort((p, q) => p.y - q.y)
    const bb = sb.slice(from, to).sort((p, q) => p.y - q.y)
    ba.forEach((p, j) => out.push([p, bb[j]]))
  }
  return out
}
