// The format of src/morph.json, shared by the generator (layout.ts) and the page (scene.ts).

/** Quarter-cell kinds, packed 2 bits each into one number per LED. */
export const DROPPED = 0, BASE = 1, COASTAL = 2, DATA = 3
/** Quarter offsets from the tile centre (in board cells), in order of the packed bits. */
export const QUARTERS = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] as const

export type Morph = {
  board: [number, number] // board size in cells
  island: [number, number] // island bounding box in cells
  blocks: number[][] // LED block housings [x, y, w, h]
  /**
   * One per LED: [boardX, boardY, lit, tileX, tileY, delay, packed quarter kinds,
   * packed quarter pressure]. Pressure (4 bits per quarter, 0–15) is a wide, smooth
   * heatmap of construction: where new building "wants" to go (drives the sprawl projection).
   */
  leds: number[][]
}
