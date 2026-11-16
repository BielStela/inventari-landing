# How it works: *Inventari de la destrucció*

A departures-board title that collapses into a dot map of Mallorca, whose yellow
dots are the land converted to urban use between 2018 and 2024. The map then
grows on its own (a sprawl projection), and at the end of the page the map folds
back into the title, rebuilt from whatever has been built by then.

This document explains every piece, from the raw raster to the last pixel drawn,
in the order the data flows through them. Numbers quoted are the real ones from
the current `src/morph.json` and source (working tree of 2026-11-14), not
estimates, unless marked otherwise.

---

## Contents

1. [The big picture](#1-the-big-picture)
2. [The data: from raster to points](#2-the-data-from-raster-to-points)
3. [The board: an LED matrix](#3-the-board-an-led-matrix)
4. [One grid for board and map](#4-one-grid-for-board-and-map)
5. [The island: tiles and quarters](#5-the-island-tiles-and-quarters)
6. [Putting the data on the map: density and dithering](#6-putting-the-data-on-the-map-density-and-dithering)
7. [Who flies where: the rubber-sheet pairing](#7-who-flies-where-the-rubber-sheet-pairing)
8. [When each LED leaves: delays](#8-when-each-led-leaves-delays)
9. [The file the page reads: `morph.json`](#9-the-file-the-page-reads-morphjson)
10. [Rendering: the scene](#10-rendering-the-scene)
11. [The animation, frame by frame](#11-the-animation-frame-by-frame)
12. [Scroll: how the page drives the progress](#12-scroll-how-the-page-drives-the-progress)
13. [The projection: a sprawl cellular automaton](#13-the-projection-a-sprawl-cellular-automaton)
14. [Board ↔ map colour coupling](#14-board--map-colour-coupling)
15. [Accessibility and "nothing at rest"](#15-accessibility-and-nothing-at-rest)
16. [Assumptions and known approximations](#16-assumptions-and-known-approximations)
17. [Tunables cheat-sheet](#17-tunables-cheat-sheet)
18. [Sources](#18-sources)

---

## 1. The big picture

There are two distinct moments in the life of this project:

```
BUILD TIME (Node, run by hand)                         RUN TIME (browser)
──────────────────────────────                         ──────────────────
change_probability.tif                                 morph.json ──► scene.ts  (draws a frame for progress p)
   │  pnpm prepare-data  (GDAL)                                 └──► sprawl.ts (projection state)
   ▼                                                   scroll ──► main.ts   (turns scroll into p, runs clocks)
data/change.json   (22,797 weighted points)
   │  pnpm morph  (scripts/morph.ts → src/layout.ts)
   ▼
src/morph.json     (1,890 LEDs, 61 KB)
```

**Design principle: precompute everything.** All the geometry (which LED goes
where, which quarter is sea, which is data, the coastline, the delays, the growth
pressure) is computed once, offline, and stored in `src/morph.json`. The browser
only *scales* those numbers to the viewport and interpolates them. That keeps the
page light (no geodata, no polygon maths, no raster in the browser) and makes
every visit identical.

| File | Role | Runs |
|---|---|---|
| `scripts/prepare-data.ts` | Raster → weighted points | Build, needs GDAL |
| `scripts/morph.ts` | Entry point, sets timing + data options | Build |
| `src/layout.ts` | **The generator**: board, island, dithering, pairing | Build |
| `src/font.ts` | 5×7 glyphs → 7×9 LED blocks | Build |
| `src/mallorca.ts` | Coastline polygon (154 vertices) | Build |
| `src/morph-format.ts` | Shared format of `morph.json` | Both |
| `src/rng.ts` | Seeded PRNG (mulberry32) | Both |
| `src/scene.ts` | Canvas renderer, `draw(p)` | Browser |
| `src/sprawl.ts` | The projection's cellular automaton | Browser |
| `src/sprawl-clock.ts` | When the projection is allowed to tick | Browser |
| `src/main.ts` | Scroll → progress, views, controls | Browser |

---

## 2. The data: from raster to points

**Source.** `change_probability.tif`: a 10 m raster in UTM zone 31N (EPSG:32631).
Each pixel is a byte: `0` = no data, `1–255` = probability that the land was
converted from natural/agricultural use to urban/road/industrial use between
2018 and 2024.

> **Assumption.** How that probability was produced (the classification model,
> the imagery) is not documented in this repo. The page credits the data to
> Terraferida. The raster is read from the sibling project `ffg-web`.

**What `pnpm prepare-data` does** (`scripts/prepare-data.ts`):

1. **Sums the raster into 200 m blocks** with `gdalwarp -r sum`. Summing a
   probability over pixels gives an *expected count* of converted pixels, so
   each block's weight is its **expected converted area**:

   ```
   m² = Σ (value / 255) × 100 m²      (100 m² = one 10 m × 10 m pixel)
   ```

   `-ovr NONE` matters: the file is a Cloud-Optimised GeoTIFF with
   nearest-neighbour overviews, and without that flag gdalwarp would sum a
   coarse overview instead of the real 10 m pixels.
2. **Keeps only non-empty blocks** and takes their centres in UTM.
3. **Reprojects only those centres** to lon/lat with `gdaltransform`
   (`OGC:CRS84` gives lon, lat order).

**Result:** `data/change.json`, 22,797 rows `[lon, lat, m², 'CHANGE']`, adding
up to ≈ 3,021 ha of expected converted land. The `'CHANGE'` label is a leftover
"use" column, carried but not used.

**Why 200 m blocks?** A quarter cell on the final map is ≈ 700 m wide (see §5),
so 200 m is well below what the map can show. It just shrinks millions of pixels
into a few thousand points.

---

## 3. The board: an LED matrix

The title is drawn like a split-flap / LED departures board: every character
sits in its own **LED block**.

### 3.1 Glyphs (`src/font.ts`)

Each letter is a hand-drawn **5×7 dot-matrix glyph**, the classic size used on
character LCDs and LED signage (e.g. the HD44780 character set draws its
characters in a 5×7 dot area). Only the letters the title needs are defined
(`A C D E I L N O R S T U V` and space). Unknown characters render as blank.

```
 I        N        V
.111.    1...1    1...1
..1..    11..1    1...1
..1..    1.1.1    1...1
..1..    1.1.1    1...1
..1..    1..11    1...1
..1..    1...1    .1.1.
.111.    1...1    ..1..
```

Each glyph is padded with **one unlit LED of margin** on every side, giving a
**7×9 block** (`BLOCK_COLS = 7`, `BLOCK_ROWS = 9`). The margin LEDs are real
LEDs: they are drawn (dark) on the board and they fly to the map like the others.

### 3.2 The board (`src/layout.ts`)

```ts
const LINES = ['INVENTARI', 'DE LA', 'DESTRUCCIO']
const BOARD_COLS = 10   // blocks per row; shorter rows padded with blank blocks
const GAP_CELLS = 1     // one empty cell between blocks
```

- 3 rows × 10 blocks = **30 blocks** (shorter lines are padded with blank blocks,
  so the board is a full rectangle).
- 30 blocks × 63 LEDs = **1,890 LEDs**, of which **349 are lit** (the letter
  strokes) and 1,541 are unlit.
- Board size in cells: `10·7 + 9·1 = 79` wide, `3·9 + 2·1 = 29` tall.
- The "Ó" of *DESTRUCCIÓ* is drawn as a plain `O` (there's no accented glyph). The
  real title, with the accent, is in an `<h1 class="sr-only">` for screen readers.

Each block also gets a **housing**: a dark rectangle drawn behind
its LEDs, inset by 0.12 cells so neighbouring housings don't touch across the
gap. That's what makes it read as hardware rather than as a font.

Every LED is stored with:
- `x, y`: its position in grid units, centred on (0, 0);
- `lit`: on or off;
- `u, v`: its normalised position on the board (0 → 1 left→right, top→bottom),
  used later for delays.

---

## 4. One grid for board and map

This is the central idea that makes the morph look coherent.

> **Board and map share ONE square lattice of spacing 1** ("grid units"). One
> grid unit = the distance between two neighbouring LEDs on the board.

- The board occupies 79 × 29 cells of that lattice.
- The island is scaled so that its **area is exactly 1,890 cells**, one per LED:

  ```ts
  ISLAND_SCALE = sqrt(N_LEDS / ISLAND_AREA)   // grid units per degree of latitude
  ```

  So *the number of LEDs on the board equals the number of board-sized cells
  that fit on the island*. Nothing is created or destroyed between the two
  pictures: every LED has exactly one home.

### 4.1 The projection (geography)

Coordinates are projected with a **local equirectangular projection** centred on
Mallorca (`LON0 = 2.9125°, LAT0 = 39.6185°`):

```
x = (lon − LON0) · cos(LAT0) · ISLAND_SCALE
y = −(lat − LAT0) · ISLAND_SCALE           (screen y points down)
```

Multiplying longitude by `cos(LAT0) ≈ 0.770` makes one unit of x the same
ground distance as one unit of y. Over an island this small, that's accurate to
about ±0.5 % (see §16).

### 4.2 What a cell means on the ground

| | Value |
|---|---|
| Island area (from the polygon, shoelace formula) | ≈ 3,693 km² |
| `ISLAND_SCALE` | ≈ 79.6 grid units per degree of latitude |
| **One board cell / tile** | **≈ 1.40 km** across (≈ 1.95 km²) |
| **One quarter cell (map dot)** | **≈ 0.70 km** across |
| Island bounding box | 69.1 × 55.8 cells |

(Mallorca's official area is ≈ 3,640 km²; the 1:10m coastline is coarse and
slightly generous, see §16.)

### 4.3 How big on screen

`boardBox()` in `scene.ts` picks the lattice spacing **P (px)** so that both
pictures fit:

```ts
P = min(0.90·vw / 79, 0.60·vh / 29, 0.88·vw / 69.1, 0.88·vh / 55.8)
```

On a 1440 × 900 viewport that's `min(16.4, 18.6, 18.3, 14.2)` → **P ≈ 14.2 px**,
limited by the island's height. Board LEDs are drawn with diameter
`B = 0.72·P` ≈ 10 px.

Because there's a single P, the board and the map are drawn **at the same scale**:
the LEDs don't shrink or grow in flight because of a zoom, they just move.

---

## 5. The island: tiles and quarters

The map is **the board's grid, subdivided**. It works at two resolutions:

- **Tiles**: board-sized cells (1 × 1). There are exactly 1,890, one per LED.
- **Quarters**: each tile split 2 × 2 into half-size cells. These are the dots of
  the final map: **twice the board's resolution**.

```
        one tile (= one LED)                    quarter offsets (QUARTERS)
   ┌─────────┬─────────┐                     k=0 (−¼,−¼)   k=1 (+¼,−¼)
   │    ●    │    ●    │                     k=2 (−¼,+¼)   k=3 (+¼,+¼)
   ├─────────┼─────────┤
   │    ●    │    ●    │                     spacing between quarters = ½
   └─────────┴─────────┘
```

### 5.1 Choosing the tiles: "the N most inland cells"

Every lattice cell around the island gets a **landness** score: the signed
distance from its centre to the coastline (positive inland, negative at sea).

```ts
landness(lon, lat) = onIsland(lon, lat) ? distToCoast(...) : −distToCoast(...)
```

- `onIsland` is the classic **even–odd ray-casting** point-in-polygon test: shoot a
  ray to the right and count how many polygon edges it crosses; odd = inside.
- `distToCoast` is the minimum distance from the point to each segment of the
  coastline (projection onto the segment, clamped to its ends).

Cells are sorted by landness and **the 1,890 most inland are kept**. Because the
island's scaled area is exactly 1,890 cells, this picks out the island's shape
almost exactly, filled from the centre outwards. Ties at the coast are decided
by which cell centre is deeper inland.

> Why not just "cells whose centre is on the island"? That would give *about*
> 1,890 cells, not *exactly*. Ranking by landness guarantees the count matches
> the LEDs, so no LED is left without a home and no tile is left empty.

### 5.2 Quarters: refining the coastline

Each tile's 4 quarters get their own landness. Then:

- **DROPPED**: a quarter whose centre is at sea is dropped… *unless* it is the
  tile's most inland quarter (every tile keeps at least one dot). In practice
  every tile kept at least 2: **1,811 tiles keep 4, 51 keep 3, 28 keep 2**.
  **107 quarters are dropped** in total.
- **COASTAL**: a kept quarter with a missing neighbour (left/right/up/down, at
  quarter spacing ½) sits on the coastline. These **429** quarters are drawn a
  little lighter, which outlines the island.
- **BASE**: everything else (basemap grey).
- **DATA**: set in the next step.

This is why the coast looks finer than the inland: the *tiles* follow the coast
at 1.4 km resolution, but *dropping quarters* carves it at 0.7 km.

Final count: **7,453 dots** on the map (6,402 base, 429 coastal, 622 data).

---

## 6. Putting the data on the map: density and dithering

Problem: we have 22,797 weighted points and need to decide **which tiles are
"data"**. And the board fixes the budget: there are **349 lit LEDs**, so exactly
**349 tiles** must be data tiles (lit LEDs fly to data tiles, see §7). This is
what makes "the title becomes the data" literal: the yellow on the map *is* the
yellow of the letters.

### 6.1 Heatmap (kernel density estimation)

Each data point is projected to grid units and the density at a quarter's centre
is a **Gaussian kernel sum**:

```
density(x, y) = Σ_points  w · exp( −((x−px)² + (y−py)²) / (2σ²) )
```

- `w` = the point's expected converted m²;
- `σ = 0.5` board cells (≈ 700 m, i.e. about one quarter) via `SIGMA`;
- points further than 3σ in x or y are skipped (contributes < 1.2 % of the peak).

A tile's raw value is the sum of its kept quarters' densities, normalised to
the maximum and passed through a tone curve `value = (raw/max)^γ`. With the
default `γ = 1` it's linear. `GAMMA=0.75 pnpm morph` lifts the sparse tail so the
odd isolated building isn't swallowed by the dense cores.

### 6.2 Dithering (Floyd–Steinberg error diffusion)

A threshold (`value > t`) would give solid blobs where it's dense and nothing
elsewhere. **Error diffusion** instead lights tiles so that the *local share* of
lit tiles follows the density: solid cores, speckled periphery, the odd dot
where it's thin. It's the same technique used to print greyscale images with
black ink only.

For every tile, row by row:

```
v      = min(1, k·value) + accumulated error
on     = v ≥ 0.5
error  = v − on            → pushed onto neighbours not yet visited:

                 [ x ]  7/16
         3/16    5/16   1/16
```

Rows are walked in **serpentine order** (left→right, then right→left), which
avoids the diagonal "worm" artefacts of plain raster order. Because tiles sit on
a lattice that includes sea cells, neighbours missing from the island simply
don't receive error.

### 6.3 Hitting exactly 349

Dithering with gain `k` lights *roughly* `Σ k·value` tiles. To get exactly the
number of lit LEDs:

1. **Binary search on k** (up to 50 iterations, `k ∈ [0, 64]`) for the dither
   whose lit count is closest to 349.
2. **Fix any remainder** by density: turn off the faintest lit tiles, or turn
   on the densest unlit ones, one at a time.

### 6.4 Quarters within a data tile

Inside each data tile, the number of yellow quarters follows its scaled value:

```
n = clamp( round(4 · min(1, k·value)), 1, kept quarters )
```

The densest quarters light first. That's why a sparse data tile might show 1
yellow dot and a dense one all 4: **622 yellow dots** from 349 data tiles.

### 6.5 Growth pressure (for the projection)

The same kernel is evaluated again with a **much wider σ = 2.5 cells**
(≈ 3.5 km, `PRESSURE_SIGMA`), giving a smooth field that reaches past the built
areas into the countryside around them: *where new construction "wants" to go*.

- Normalised by its **99th percentile** (so one huge quarry doesn't flatten
  everything else to zero), clamped to 1;
- **square-root** toned (lifts low values);
- **quantised to 0–15** (4 bits) per quarter, so 4 quarters pack into 16 bits.

Its use is explained in §13.

---

## 7. Who flies where: the rubber-sheet pairing

Every LED now needs one tile. Two rules:

1. **Lit LEDs → data tiles, unlit LEDs → the other tiles.** The two groups are
   paired separately (349 ↔ 349, 1,541 ↔ 1,541).
2. **Neighbours stay neighbours.** The board should stretch onto the island like
   a rubber sheet, so the motion reads as one surface deforming, not as 1,890
   random particles swapping places.

`pairUp()` does it with **rank matching in vertical bands**:

```
1. Sort both sets by x.
2. Cut both into the same number of bands with EQUAL COUNTS
   (bands = round(√(n/3)): 23 bands for the unlit set, 11 for the lit set).
3. Inside each band, sort both by y and pair them in order.
```

```
 board (79 × 29)                         island (≈69 × 56)
 ┌───┬───┬───┬───┬───┐                   ┌──┬───┬────┬───┬──┐
 │ 1 │ 2 │ 3 │ 4 │ 5 │   band i  ───►    │1 │ 2 │ 3  │ 4 │5 │
 └───┴───┴───┴───┴───┘                   │  │   │    │   │  │
  wide, short bands                       └──┴───┴────┴───┴──┘
                                          narrower/taller where the island is
```

So **board left→right becomes island west→east, and board top→bottom becomes
island north→south**. Because the matching is by *rank* (not coordinate), it
copes with the change of aspect ratio (79 × 29 → 69 × 56) and with the island's
irregular outline: a band is wider where the island is thin and narrower where
it's fat, but always holds the same number of points.

> **Why `√(n/3)` bands?** It gives bands with roughly 3·bands points each, i.e.
> bands taller than they are wide. Fewer, wider bands would let points travel
> far sideways inside a band; more, thinner bands would let them travel far
> vertically. It's a pragmatic compromise, not derived from a formula.

> **Consequence:** the letters don't land in recognisable places. The I of
> *INVENTARI* goes to the far west, the O of *DESTRUCCIÓ* to the far east, but
> the yellow is distributed according to the data, not according to the letter
> shapes. The match is in the *amount* of yellow, which is exact.

---

## 8. When each LED leaves: delays

Each LED gets a departure **delay** (in progress units, see §11):

```ts
delay = u·0.22                // left→right wave across the board (spread)
      + v·0.05                // a slight top→bottom lag
      + rand()·0.05           // jitter, seeded (rng(7)): identical every build
      + (lit ? 0.06 : 0)      // dataDelay: lit LEDs leave later…
```

…so **data lands last, on top**: the grey basemap forms first, then the yellow
arrives over it. Measured ranges: unlit 0.001–0.314, lit 0.084–0.363.

---

## 9. The file the page reads: `morph.json`

```ts
type Morph = {
  board:  [79, 29]                // board size in cells
  island: [69.132, 55.823]        // island bounding box in cells
  blocks: [x, y, w, h][]          // 30 housings
  leds:   [boardX, boardY, lit, tileX, tileY, delay, kinds, pressure][]   // 1,890
}
```

Two bit-packed fields keep it compact (61 KB, one LED per line so diffs are
readable):

| Field | Layout | Meaning |
|---|---|---|
| `kinds` | 2 bits × 4 quarters | `0 DROPPED, 1 BASE, 2 COASTAL, 3 DATA`. Quarter k is `(kinds >> 2k) & 3`. |
| `pressure` | 4 bits × 4 quarters | 0–15. Quarter k is `(pressure >> 4k) & 15`. |

Quarter order is fixed by `QUARTERS` in `morph-format.ts`: NW, NE, SW, SE.

Regenerate it with `pnpm morph` whenever the title, grid, timing or data change.
Options via env: `SIGMA`, `GAMMA`, `PRESSURE_SIGMA`.

---

## 10. Rendering: the scene

`createScene(canvas, sprawl)` in `src/scene.ts` returns `{ resize, draw }`.
**It never animates on its own.** `draw(p)` renders one frame for progress
`p ∈ [0, 1]` (0 = board, 1 = map). Something else (the scroll, §12) decides p.

### 10.1 Particles

On `resize()`, `build()` scales `morph.json` by P and creates **one particle per
kept quarter**, 7,453 in all:

```ts
{ tx, ty,          // its LED's position on the board (px)
  cx, cy,          // its tile's centre on the island (px)
  ox, oy,          // this quarter's offset from the tile centre (±P/4)
  led,             // which LED it belongs to
  base,            // map colour when not built: OFF grey, or COAST on the coastline
  delay,           // its LED's delay
  primary }        // the LED's first kept quarter
```

**Key point:** an LED on the board is not one object, it's 2–4 particles
stacked on the exact same spot, same size, same colour, so they look like one
dot. At rest the board draws only the `primary` one of each LED (no point
drawing 4 identical circles). In flight all of them are drawn, still stacked.
"Splitting" just means letting their offsets (`ox, oy`) grow from 0 to ±P/4.

The particle order (LED by LED, quarter by quarter, dropped ones skipped) is the
same as the cell order in `sprawl.ts`, so **particle i ↔ sprawl cell i**.

### 10.2 Dot sizes: a constant dot-to-pitch ratio

- Board LEDs: diameter `B = 0.72·P` on a pitch of `P`.
- Map dots: diameter `B/2 = 0.36·P` on a pitch of `P/2`.

Both are **72 % of their pitch**, so the map reads as the same material as the
board, just finer. Halving the size while halving the spacing is what makes the
split look like a subdivision, not like a change of style.

### 10.3 Colours

| Name | RGB | Use |
|---|---|---|
| `BG` | 6, 6, 6 | Page background |
| `BLOCK` | 18, 17, 16 | LED housing |
| `OFF` | 38, 36, 33 | Unlit LED = basemap dot |
| `COAST` | 74, 71, 65 | Coastline basemap dot |
| `ON` | 255, 204, 36 | Lit LED = data dot (warm yellow, `#ffcc24`) |

The same yellow and the same grey mean the same thing on both pictures: **lit is
data, unlit is land**.

### 10.4 Batched drawing

Drawing 7,453 circles one by one with `fill()` each would be slow. Instead,
`led()` appends each circle to a **`Path2D` per colour**, and `flush()` fills
each path once. To keep the number of distinct colours (and therefore `fill()`
calls) low during colour transitions, colours are **quantised to steps of 6**
per channel (`quantKey`) — invisible on this palette, and it caps the number of
paths per frame.

The canvas is backed at `devicePixelRatio` (capped at 2) for crisp dots on
high-density screens.

---

## 11. The animation, frame by frame

All motion is a pure function of **progress p**. Here's what `draw(p)` does.

### 11.1 Rest states

- `p ≤ 0.0005` → `drawBoard(0)`: housings + one dot per LED at its board spot.
- `p ≥ 0.9995` → `drawMap(1)`: all quarters at their map spot, size B/2, map colour.

### 11.2 In between (normal motion)

```
p:     0   0.02     0.12         ~0.20                      0.903      0.983  1
       │    ├─housings fade─┤                                  │          │
       │              ├── LEDs take off (left→right wave) ──────┤          │
       │                                    each flies FLY_DUR = 0.42       │
       │                                                       ├─ split ───┤
       │                                                       all at once
```

For each particle:

```ts
t       = clamp((p − FLY_START − delay) / FLY_DUR)   // 0 → 1 over its own flight
travel  = ease(t)                                     // cubic ease-in-out
split   = smooth(LANDED_AT, MAP_SETTLED_AT, p)        // global, same for all

x    = lerp(tx, cx, travel) + ox · split
y    = lerp(ty, cy, travel) + oy · split
size = lerp(B, B/2, split)
colour = mix(boardColour, mapColour, split)
```

Step by step:

1. **Housings fade** between p = 0.02 and 0.16 (`blockFade`), so the board
   loses its hardware first and becomes a field of loose dots.
2. **Flight.** Each LED starts at `FLY_START + delay` and flies in a **straight
   line** from its board spot to its tile centre over `FLY_DUR = 0.42` progress
   units. All its 2–4 particles travel stacked, so it looks like one dot.
   - `ease` is **cubic ease-in-out** (slow start, fast middle, slow arrival).
   - Because delays grow left→right, the board peels off as a **wave**, the grey
     basemap forming first and the yellow data (+0.06) landing on top.
3. **Landing.** The last LED lands at
   `LANDED_AT = FLY_START + max(delay) + FLY_DUR = 0.12 + 0.363 + 0.42 ≈ 0.903`.
   At that moment the island is complete, but at **board resolution**: 1,890
   big dots, in board colours.
4. **The split.** Over `SPLIT_DUR = 0.08` (until `MAP_SETTLED_AT ≈ 0.983`),
   **every dot at once** splits into its quarters: offsets grow to ±P/4, size
   halves, colour goes from the LED's board colour to each quarter's own map
   colour (grey, coastal grey or yellow). The resolution doubles in one beat,
   and the coastline sharpens as the dropped quarters' siblings move out.
5. `MAP_SETTLED_AT` is exported: from there on the frame **is** the finished
   map. `main.ts` uses it to know when the projection may start and when to show
   its controls.

`smooth(a, b, x)` is **smoothstep**: a cubic `3t² − 2t³` ramp between a and b,
zero slope at both ends, so nothing starts or stops with a jolt.

### 11.3 Reduced motion

With `prefers-reduced-motion: reduce`, nothing moves: the board fades out while
the map fades in (crossfade over p = 0.35–0.65). See §15.

---

## 12. Scroll: how the page drives the progress

`src/main.ts`. The page uses **native scroll**, never hijacked. The scroll
position is turned into a *target* progress, and the drawn progress *glides*
towards it.

### 12.1 Page structure

```
┌──────────────────────────┐  ─┐
│ #stage (intro)  270vh    │   │ sticky canvas, 100vh
│   board → map            │   │ + 140vh of morph + 30vh hold on the map
├──────────────────────────┤  ─┘
│ #content (text)          │     scrolls normally, z-index above the outro
│   …                      │
│   last screen of text ───┼─┐   the outro starts 100vh EARLY, under the text
├──────────────────────────┤ │   (margin-top: −100vh)
│ #outro          265vh    │ ┘   map fades in as the text leaves,
│   map → board            │     holds 10vh, morphs back over 100vh,
└──────────────────────────┘     ends on the board at the page's very bottom
```

Each stage is a tall `<section>` with a `position: sticky` 100vh child holding
its canvas: the canvas stays pinned while the section scrolls past, and how far
it has scrolled is the progress.

Stage heights are **set from `main.ts`** from the same constants that compute
the timing (`INTRO_MORPH_VH`, `HOLD_VH`, `FADE_VH`, …), so CSS and timing can't
drift apart. The CSS heights are only fallbacks.

### 12.2 Target progress

```ts
stageProgress(stage, before, after):
  transition = stageHeight − innerHeight − (before + after)·vh
  t          = clamp((−stage.top − before·vh) / transition)
```

- **Intro**: `target = stageProgress(intro, 0, HOLD_VH)`. The morph spans 140vh
  of scroll, then 30vh of hold on the finished map before the text arrives.
  (So the split, 0.08 of p, takes ≈ 11vh of scroll.)
- **Outro**: `target = 1 − stageProgress(outro, OUTRO_BEFORE_VH, 0)`. **Mirror
  image**: scrolling down goes map → board. Its canvas also **fades in**
  (`smooth(0, 0.55, …)`) while the last text scrolls away over it.
- Values within 0.001 of 0 or 1 snap to 0/1: sub-pixel scroll rounding must not
  keep a view from settling.

### 12.3 Damped progress (frame-rate independent)

A mouse wheel scrolls in notches of ~100 px; mapped straight to p, the morph
would jump. Each view's drawn `p` follows its target with **exponential
damping**:

```ts
p += (target − p) · (1 − e^(−Δt/τ))      // τ = 0.18 s
```

The factor `1 − e^(−Δt/τ)` makes the glide **independent of frame rate**: a
60 Hz and a 144 Hz screen converge identically in wall-clock time, which a fixed
`p += (target − p) · 0.1` would not. Δt is capped at 0.1 s so a stalled tab
doesn't jump. When within 0.0005 of the target, p snaps to it and the loop
**stops**.

Because only the *drawn* progress is damped, the scrollbar is always truthful
and scrolling back up reverses the morph exactly.

### 12.4 Two views, one state

The intro and outro are two `View`s, each with its own canvas, scene and p, but
**one shared `sprawl` state** (§13). The outro therefore shows the map *as far
as the projection got* and re-forms the title from it.

### 12.5 Small pieces

- **The board is a button.** An invisible `<button>` laid exactly over the board
  (`boardBox`, the same box the scene draws in). Click/Enter scrolls *natively*
  (`scrollTo({behavior:'smooth'})`) to the start of the hold on the map. The
  scrollbar moves, so scrolling back still reverses.
- **Controls placement.** Pause/Reset hang at the island's bounding-box
  bottom-right corner, which is open sea on Mallorca's outline, so they never
  cover a dot at any screen size.
- **Hint and finale.** "Scroll ↓" fades out over the first 4 % of the intro.
  The finale (yellow "Visita el mapa →" button + credits) fades in during the
  last 8 % of the outro, once the rebuilt title has settled.
- **Off-screen views aren't drawn**; they're redrawn when they come back.

---

## 13. The projection: a sprawl cellular automaton

Once the map is formed, it starts to **grow**: an illustrative projection of
what happens if conversion continues the way it has. `src/sprawl.ts`.

### 13.1 Model

It's a **probabilistic urban-growth cellular automaton** in the spirit of
**SLEUTH** (Clarke et al., 1997), heavily simplified:

- **Cells**: the 7,453 map quarters, on their own integer lattice (quarter
  centres `n ± ¼` become consecutive integers via `×2 − ½`).
- **State**: built (1) or not (0). **Generation 0 is the data**: the 622 yellow
  quarters, the state as of 2024 (8.3 % of the island).
- **Neighbourhood**: the 8 surrounding quarters (Moore). Sea neighbours don't
  exist (`−1`), so **the coast is a wall**.
- **Built cells are never demolished.**
- An empty cell with **k** built neighbours is built in one step with probability

  ```
  P(build) = 1 − (1 − EDGE · p′)^k  +  SPONTANEOUS · p′
  p′       = 0.08 + 0.92 · pressure          (PRESSURE_FLOOR = 0.08)
  EDGE = 0.002,  SPONTANEOUS = 0.000006
  ```

  - **Edge growth**: each built neighbour gives an independent chance
    `EDGE·p′`; `1 − (1 − q)^k` is the probability that *at least one* of the k
    succeeds. Growth spreads from the edges of what's already built.
  - **Spontaneous growth**: a rare new seed out of nowhere.
  - Both are scaled by the **pressure** field from §6.5: growth is fast around
    existing construction and slow in empty mountains. The floor of 0.08 means
    nowhere is immune, just slower.

Compared with SLEUTH: SLEUTH has five coefficients (diffusion, breed, spread,
slope resistance, road gravity), four growth rules (spontaneous, new spreading
centres, edge, road-influenced), excluded areas, and self-modification of its
coefficients. Here there are only **spontaneous + edge** rules, the
**pressure field stands in for slope/road/attractiveness layers**, there's no
calibration against history, and coefficients are constant. It's a visual
projection, **not a calibrated forecast**.

### 13.2 Measured growth

Simulated with the real `morph.json` and seed (12 generations per second):

| Time | Generation | Built share |
|---|---|---|
| 0 s | 0 | 8.3 % (the data) |
| 10 s | 120 | 18.4 % |
| 20 s | 240 | 31.3 % |
| 40 s | 480 | **56.1 %** |
| 60 s | 720 | 71.1 % |
| 100 s | 1,200 | **83.4 %** |
| 200 s | 2,400 | 92.5 % |

That matches the tuning comment in the code ("half built at 40 s, ~80 % at
100 s").

### 13.3 Determinism

The CA uses its own **seeded PRNG** (`rng(1)`). Every visitor sees the island
grow the same way, and `reset()` restores generation 0 *and* the seed, so it
replays identically. There's **no history**: time only moves forward, and the
only way back is Reset (or a reload).

### 13.4 The clock (`sprawl-clock.ts`)

The CA ticks at **12 generations per second** via `requestAnimationFrame`, but
**only while all of these hold**:

- not paused;
- the tab is visible;
- some view's finished map is shown: its drawn p ≥ `MAP_SETTLED_AT`, the scroll
  asks for the full map, the stage is on screen, and (outro) it's at least half
  faded in.

It **never catches up** on missed time: leave the tab and come back, it
continues from where it was. The first generation fires on the first frame after
the split finishes, so there's no dead pause after landing. Scrolling or
returning to the tab `poke()`s it back on.

---

## 14. Board ↔ map colour coupling

The colours on both pictures are **read from the sprawl state at draw time**, so
both views and both pictures always agree.

- **Map dot**: yellow if its cell is built, otherwise its basemap grey.
- **Board LED**: its brightness is its built quarters divided by a **reference**:

  ```
  lit LED   : ref = its data quarters at generation 0
  unlit LED : ref = all its kept quarters
  brightness = min(1, built quarters / ref);   colour = mix(OFF, ON, brightness)
  ```

  At generation 0 this reproduces the title **exactly** (lit LEDs = 1, unlit =
  0). As the island fills, unlit LEDs start glowing in proportion to how much of
  their tile has been built. Since every LED flies back to the board from its
  tile, the **outro's title is rebuilt from the projected map**: the more has
  been built, the more the letters drown in a yellow board. That's the ending:
  *a broken title*.

---

## 15. Accessibility and "nothing at rest"

- **Nothing runs at rest.** No animation loop runs unless something is moving:
  the glide stops when settled, the CA stops when its map isn't shown, and an
  unchanged p isn't redrawn (`drawnP` cache).
- **Pause/Play** (WCAG 2.2 SC 2.2.2 *Pause, Stop, Hide*: moving content that
  lasts more than 5 s must be pausable). **Reset** only appears once something
  has changed, and focus moves to Pause when Reset hides itself.
- **`prefers-reduced-motion: reduce`**: the morph becomes a crossfade, the
  damping is off (p follows the scroll exactly), the projection **starts
  paused**, the board button jumps instead of smooth-scrolling, and the hint's
  bobbing arrow stops.
- The canvases are `aria-hidden`. The title is a real `<h1>` (visually hidden,
  `lang="ca"`), the board button has a label, and the controls form a labelled
  group.

---

## 16. Assumptions and known approximations

| # | Assumption / approximation | Effect |
|---|---|---|
| 1 | **Local equirectangular projection** with `cos(39.6185°)`. Across Mallorca's latitude range (39.27°–39.97°), `cos` varies from 0.774 to 0.766. | Horizontal scale error ≲ ±0.5 %. Invisible at 700 m dots. |
| 2 | **1° of latitude = 111.32 km** (used in this doc only, for km figures). | Figures in km are ±0.5 %. |
| 3 | **Coastline: Natural Earth 1:10m**, 154 vertices. Coarse; smooths small bays and capes. | Polygon area ≈ 3,693 km² vs. ≈ 3,640 km² official (+1.5 %). Small islets (Cabrera, Dragonera) are not included. |
| 4 | **Distances in "degrees of latitude"** for landness. Only the *ranking* matters, so units don't. | None. |
| 5 | **The change raster is a probability**, and summing it gives expected converted area. Correct for *expected* values; it says nothing about uncertainty. | A block with many low-probability pixels weighs like one with fewer certain ones. |
| 6 | **Provenance of the raster** (model, imagery, validation) is not documented here. | To be filled in from Terraferida / ffg-web. |
| 7 | **The data budget is fixed by the title**: 349 lit LEDs → 349 data tiles. The amount of yellow on the map is set by typography, not by hectares. | The map shows *where* (relative density), not *how much* in absolute terms. Changing the title changes the yellow budget. |
| 8 | **Dithering** places yellow probabilistically following density. | Individual yellow dots are not individual buildings; read the pattern, not the dot. |
| 9 | **The projection is illustrative**, not a calibrated forecast (§13.1). Its time axis is seconds on screen, not years. | Should be presented as "what if it continues", never as a prediction. |
| 10 | Two code comments are slightly off: `prepare-data.ts` says a quarter is ≈ 600 m (measured: ≈ 700 m); `scripts/morph.ts` says pressure reaches ~2.5 km (σ = 2.5 cells ≈ 3.5 km). | Cosmetic; worth correcting in the comments. |

---

## 17. Tunables cheat-sheet

**Build time** (rerun `pnpm morph` after changing):

| Where | Name | Value | What |
|---|---|---|---|
| `layout.ts` | `LINES` | `INVENTARI / DE LA / DESTRUCCIO` | The title |
| `layout.ts` | `BOARD_COLS`, `GAP_CELLS` | 10, 1 | Board layout |
| `morph.ts` | `spread` | 0.22 | Left→right departure wave |
| `morph.ts` | `dataDelay` | 0.06 | Lit LEDs leave later |
| env | `SIGMA` | 0.5 | Data heatmap radius (cells) |
| env | `GAMMA` | 1 | Tone curve on density |
| env | `PRESSURE_SIGMA` | 2.5 | Growth-pressure radius (cells) |
| `prepare-data.ts` | `BLOCK` | 200 m | Raster aggregation block |

**Run time** (just reload):

| Where | Name | Value | What |
|---|---|---|---|
| `scene.ts` | `FLY_START` | 0.12 | First departure |
| `scene.ts` | `FLY_DUR` | 0.42 | Per-LED flight length |
| `scene.ts` | `SPLIT_DUR` | 0.08 | Global split after landing |
| `scene.ts` | `B` | 0.72·P | LED diameter |
| `main.ts` | `INTRO_MORPH_VH`, `HOLD_VH` | 140, 30 | Intro scroll lengths |
| `main.ts` | `FADE_VH`, `OUTRO_HOLD_VH`, `OUTRO_MORPH_VH` | 100, 10, 100 | Outro scroll lengths |
| `main.ts` | `TAU` | 0.18 s | Scroll damping |
| `sprawl.ts` | `EDGE`, `SPONTANEOUS`, `PRESSURE_FLOOR` | 0.002, 6e-6, 0.08 | Growth rates |
| `sprawl-clock.ts` | `gensPerSec` | 12 | Projection speed |

> Constraint: `FLY_START + max(delay) + FLY_DUR + SPLIT_DUR` must stay ≤ 1
> (currently 0.983), or the split is cut short (`MAP_SETTLED_AT` is clamped to 1).

---

## 18. Sources

**Data and geography**
- Natural Earth, *1:10m Physical Vectors — Land*. Public domain. https://www.naturalearthdata.com/
- EPSG:32631, *WGS 84 / UTM zone 31N*. https://epsg.io/32631
- GDAL, `gdalwarp` (the `sum` resampling method, GDAL ≥ 3.1) and `gdaltransform`. https://gdal.org/programs/gdalwarp.html
- Change-probability raster: Terraferida (per the page credits); see assumption 6.

**Geometry**
- Shoelace (surveyor's / Gauss's area) formula, for the polygon area. https://en.wikipedia.org/wiki/Shoelace_formula
- Even–odd ray casting point-in-polygon test, as in W. R. Franklin's PNPOLY. https://wrfranklin.org/Research/Short_Notes/pnpoly.html
- Equirectangular projection. https://en.wikipedia.org/wiki/Equirectangular_projection

**Density and dithering**
- B. W. Silverman (1986), *Density Estimation for Statistics and Data Analysis*, Chapman & Hall. (Gaussian kernel density estimation.)
- R. W. Floyd & L. Steinberg (1976), "An adaptive algorithm for spatial greyscale", *Proceedings of the Society for Information Display* 17(2), 75–77. (Error diffusion.)
- Serpentine scanning for error diffusion: R. Ulichney (1987), *Digital Halftoning*, MIT Press.

**Urban growth model**
- K. C. Clarke, S. Hoppen & L. Gaydos (1997), "A self-modifying cellular automaton model of historical urbanization in the San Francisco Bay area", *Environment and Planning B: Planning and Design* 24(2), 247–261. (SLEUTH.)
- Project Gigalopolis (SLEUTH documentation). http://www.ncgia.ucsb.edu/projects/gig/

**Animation and rendering**
- Smoothstep. https://en.wikipedia.org/wiki/Smoothstep
- Cubic ease-in-out (Robert Penner's easing equations). https://easings.net/#easeInOutCubic
- Frame-rate-independent damping with `1 − e^(−Δt/τ)`: R. Driscoll (2016), "Frame Rate Independent Damping Using Lerp". https://www.rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/
- `Path2D` (batched canvas paths), MDN. https://developer.mozilla.org/en-US/docs/Web/API/Path2D
- mulberry32 PRNG (Tommy Ettinger, public domain), as collected in bryc's PRNG notes. https://github.com/bryc/code/blob/master/jshash/PRNGs.md

**Accessibility**
- WCAG 2.2, Success Criterion 2.2.2 *Pause, Stop, Hide*. https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide
- `prefers-reduced-motion`, MDN. https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

**Typography**
- Hitachi HD44780U datasheet (5×8-dot character font, 5×7 glyph area), the reference for the classic dot-matrix letterform. The glyphs in `font.ts` are drawn by hand in that style, not copied from a ROM.
