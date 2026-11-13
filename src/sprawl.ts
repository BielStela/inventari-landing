// The projection: a probabilistic urban-sprawl cellular automaton on the island's
// quarter cells, after SLEUTH (Clarke et al.). Generation 0 is the data (the
// yellow quarters, the state as of 2024). Built cells are never demolished; an
// empty cell is built by edge growth around built neighbours or, rarely,
// spontaneously, both scaled by the construction-pressure field. Sea cells are
// never built, so the coastline is a wall. Seeded: every run grows the same way.
// There is no history: time only moves forward, and the board is rebuilt from
// whatever is built now. The only way back is reset(), straight to generation 0.
import { QUARTERS, DROPPED, DATA, type Morph } from './morph-format.ts'
import { rng } from './rng.ts'

// Tuning (per step, at 12 steps/s ≈ half built at 40 s, ~80% at 100 s): an empty
// cell with k built neighbours is built with probability 1 − (1 − EDGE·pressure')^k,
// plus SPONTANEOUS·pressure' out of nowhere, where
// pressure' = PRESSURE_FLOOR + (1 − PRESSURE_FLOOR)·pressure.
const EDGE = 0.002
const SPONTANEOUS = 0.000006
const PRESSURE_FLOOR = 0.08 // even the emptiest mountain isn't immune, just slow
const SEED = 1

export type Sprawl = ReturnType<typeof createSprawl>

export function createSprawl(morph: Morph) {
  // Cells in the same order as the scene's particles: LED by LED, quarter by quarter.
  const cellLed: number[] = []
  const gx: number[] = [], gy: number[] = []
  const alive0: number[] = []
  const pressure: number[] = []
  morph.leds.forEach(([, , , tx, ty, , packed, packedPressure = 0], l) => {
    QUARTERS.forEach(([dx, dy], k) => {
      const kind = (packed >> (2 * k)) & 3
      if (kind === DROPPED) return
      cellLed.push(l)
      // Quarter centres sit at n ± ¼ (in board cells); ×2 − ½ makes them consecutive integers.
      gx.push(Math.round((tx + dx) * 2 - 0.5))
      gy.push(Math.round((ty + dy) * 2 - 0.5))
      alive0.push(+(kind === DATA))
      const p = ((packedPressure >> (4 * k)) & 15) / 15
      pressure.push(PRESSURE_FLOOR + (1 - PRESSURE_FLOOR) * p)
    })
  })
  const n = cellLed.length

  // Neighbour lists: 8 per cell, −1 for sea.
  const index = new Map<number, number>()
  const key = (x: number, y: number) => (x + 2048) * 4096 + (y + 2048)
  for (let i = 0; i < n; i++) index.set(key(gx[i], gy[i]), i)
  const nbr = new Int32Array(n * 8).fill(-1)
  for (let i = 0; i < n; i++) {
    let k = 0
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        nbr[i * 8 + k++] = index.get(key(gx[i] + dx, gy[i] + dy)) ?? -1
      }
  }

  let alive = Uint8Array.from(alive0)
  let next = new Uint8Array(n)
  let generation = 0
  let rand = rng(SEED)

  /** One generation: built cells stay built; empty ones may be built. */
  function step() {
    for (let i = 0; i < n; i++) {
      if (alive[i]) { next[i] = 1; continue }
      let c = 0 // built neighbours
      for (let k = i * 8, e = k + 8; k < e; k++) { const j = nbr[k]; if (j >= 0) c += alive[j] }
      const pr = pressure[i]
      const pBuild = (c ? 1 - (1 - EDGE * pr) ** c : 0) + SPONTANEOUS * pr
      next[i] = rand() < pBuild ? 1 : 0
    }
    ;[alive, next] = [next, alive]
    generation++
  }

  // Board brightness per LED: its live quarters relative to a reference, so that
  // generation 0 reproduces the title exactly (lit LEDs: their starting data
  // quarters; unlit LEDs: all their quarters, so new building glows in proportion).
  const nLeds = morph.leds.length
  const ref = new Float32Array(nLeds)
  for (let i = 0; i < n; i++) {
    const l = cellLed[i]
    ref[l] += morph.leds[l][2] ? alive0[i] : 1
  }
  const brightness = new Float32Array(nLeds)
  function ledBrightness() {
    brightness.fill(0)
    for (let i = 0; i < n; i++) brightness[cellLed[i]] += alive[i]
    for (let l = 0; l < nLeds; l++) brightness[l] = Math.min(1, brightness[l] / ref[l])
    return brightness
  }

  /** Back to generation 0: the data. */
  function reset() {
    alive.set(alive0)
    generation = 0
    rand = rng(SEED) // replays identically after a reset
  }

  return {
    step,
    reset,
    ledBrightness,
    isAlive: (i: number) => alive[i] === 1,
    get generation() { return generation },
  }
}
