// Reduce the change-probability raster to weighted points: data/change.json.
// Then run `pnpm morph` to regenerate the page's data.
//
//   pnpm prepare-data [path/to/change_probability.tif]
//
// The raster (10 m pixels, UTM 31N, byte 1–255 = probability that the land was
// converted from natural/agricultural to urban/road/industrial use, 2018–2024;
// 0 = no data) is summed into BLOCK-metre blocks in its own grid (gdalwarp -r sum
// ignores no-data), so each block's weight is its EXPECTED converted area in m²:
//   Σ (value / 255) × 100 m².
// Only block centres are reprojected to lon/lat. Needs GDAL (gdalwarp, gdalinfo,
// gdaltransform) on the PATH. Rows: [lon, lat, expected converted m², 'CHANGE'].
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_SOURCE = '/home/biel/dev/terraferida/ffg-web/public/change_probability.tif'
const source = process.argv[2] ?? DEFAULT_SOURCE
const BLOCK = 200 // m; a map quarter cell is ≈ 600 m, so this loses nothing visible
const PIXEL_AREA = 100 // m² (10 m × 10 m)

const tmp = mkdtempSync(join(tmpdir(), 'pixel-letters-raster-'))
try {
  // 1. Sum the probabilities into BLOCK × BLOCK m blocks (Float32, raw). -ovr NONE:
  //    the file is a COG with nearest-neighbour overviews, and gdalwarp would
  //    otherwise sum a coarse overview instead of the real 10 m pixels.
  const bin = join(tmp, 'sum.bin')
  execFileSync('gdalwarp', ['-q', '-ovr', 'NONE', '-r', 'sum', '-tr', `${BLOCK}`, `${BLOCK}`, '-ot', 'Float32', '-dstnodata', '0', '-of', 'ENVI', source, bin])
  const info = JSON.parse(execFileSync('gdalinfo', ['-json', bin], { encoding: 'utf8' }))
  const [w, h] = info.size as [number, number]
  const [x0, dx, , y0, , dy] = info.geoTransform as number[]
  const buf = readFileSync(bin)
  const sums = new Float32Array(buf.buffer, buf.byteOffset, w * h)

  // 2. Keep the non-empty blocks, as UTM centres with their expected converted area.
  const blocks: { x: number; y: number; m2: number }[] = []
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const s = sums[j * w + i]
      if (s > 0) blocks.push({ x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy, m2: (s / 255) * PIXEL_AREA })
    }

  // 3. Reproject only the centres (gdaltransform, lon/lat order with OGC:CRS84).
  const lonlat = execFileSync('gdaltransform', ['-s_srs', 'EPSG:32631', '-t_srs', 'OGC:CRS84'], {
    input: blocks.map((b) => `${b.x} ${b.y}`).join('\n') + '\n',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .trim()
    .split('\n')
    .map((line) => line.split(/\s+/).map(Number))

  const r5 = (n: number) => Math.round(n * 1e5) / 1e5
  const rows = blocks.map((b, k) => [r5(lonlat[k][0]), r5(lonlat[k][1]), Math.round(b.m2), 'CHANGE'])
  const out = new URL('../data/change.json', import.meta.url)
  const json = '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n'
  writeFileSync(out, json)
  const ha = rows.reduce((s, r) => s + (r[2] as number), 0) / 1e4
  console.log(`wrote ${out.pathname}: ${rows.length} blocks of ${BLOCK} m, ${ha.toFixed(0)} ha expected change, ${(json.length / 1024).toFixed(0)} KB`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
