// Generate src/morph.json: every LED's board position, its tile on the island,
// its flight delay and which of the tile's quarters it splits into.
// Rerun whenever the title, the grid or the data change:
//
//   pnpm morph
import { readFileSync, writeFileSync } from 'node:fs'
import { computeMorph, type Construction } from '../src/layout.ts'

// The change-probability raster, reduced to points by `pnpm prepare-data`.
const points = JSON.parse(readFileSync(new URL('../data/change.json', import.meta.url), 'utf8')) as Construction[]

const morph = computeMorph(
  {
    spread: 0.22, // left→right stagger of departures across the board (progress units)
    dataDelay: 0.06, // lit LEDs leave a little later, so data lands on top
  },
  {
    points,
    sigma: Number(process.env.SIGMA ?? 0.5), // ≈ one quarter cell
    gamma: Number(process.env.GAMMA ?? 1), // linear; GAMMA=0.75 pnpm morph lifts the sparse tail
    pressureSigma: Number(process.env.PRESSURE_SIGMA ?? 2.5), // growth pressure reaches ~2.5 km around construction
  },
)
const out = new URL('../src/morph.json', import.meta.url)
const json = JSON.stringify(morph).replace(/\],\[/g, '],\n[') // one LED per line, diff-friendly
writeFileSync(out, json + '\n')
console.log(`wrote ${out.pathname}: ${morph.leds.length} LEDs, ${(json.length / 1024).toFixed(1)} KB`)
