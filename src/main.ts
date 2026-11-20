// Scroll version: native scroll position drives the transitions.
// The page is a bookend. INTRO: the title board collapses into the map of the
// data (as of 2024), then the sprawl projection runs. The text follows. OUTRO:
// as the last lines scroll away, the map fades back in underneath them, as far
// as the projection got, then re-forms into the title, now rebuilt from whatever
// has been built: a broken title to end on.
//
// The scroll itself is never touched. Its position is a TARGET; each view's drawn
// progress glides towards it (frame-rate-independent exponential damping), so a
// notchy mouse wheel animates as smoothly as a trackpad. The intro board is also
// a button: clicking it smooth-scrolls (natively) to the map.
// Both views render ONE shared projection state. It runs on its own clock while
// either map is fully formed and on screen; there is no way back to the original
// title short of Reset or a reload. Nothing runs at rest.
import './style.css'
import { createScene, boardBox, islandBox, clamp, smooth, MAP_SETTLED_AT, type Scene } from './scene.ts'
import { createSprawl } from './sprawl.ts'
import { createSprawlClock } from './sprawl-clock.ts'
import morph from './morph.json'
import type { Morph } from './morph-format.ts'
import content from './content.html?raw'
import { listingFor } from './listings.ts'

document.querySelector('#content')!.innerHTML = content

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const hint = document.querySelector<HTMLElement>('#hint')!
const finale = document.querySelector<HTMLElement>('#finale')!
const boardButton = document.querySelector<HTMLButtonElement>('#board')!

// One projection state, rendered by both views.
const sprawl = createSprawl(morph as Morph)

// ─── Scroll lengths (vh) ──────────────────────────────────────────────────────
// Both stages' heights are derived from these (set below), so CSS and timing
// can't drift apart. Each stage is one viewport of pinned canvas plus its scroll.
// Intro: the morph board → map, then a hold on the finished map before the text.
const INTRO_MORPH_VH = 140
const HOLD_VH = 30
// Outro: starts one viewport early, under the last screen of text; its map fades
// in as that text scrolls away, holds briefly, then morphs back to the title.
const FADE_VH = 100
const FADE_FROM = 0, FADE_TO = 0.55 // fade window, as fractions of that overlap
const OUTRO_HOLD_VH = 10
const OUTRO_MORPH_VH = 100
const OUTRO_BEFORE_VH = FADE_VH * FADE_TO + OUTRO_HOLD_VH // scroll from pinned to the morph's start

// ─── Views ────────────────────────────────────────────────────────────────────
// A view is one sticky stage with its own canvas, controls and damped progress
// p (0 = board, 1 = map). Intro: board → map as you scroll down. Outro: the
// mirror image, map → board, ending on the board at the very end of the page.
type View = {
  stage: HTMLElement
  scene: Scene
  target: () => number // progress the scroll position asks for
  p: number
  drawnP: number
  controls: HTMLElement
  fade: () => number // canvas opacity, 0–1 (the outro fades in; the intro is always 1)
}

function makeView(stage: HTMLElement, target: () => number, fade = () => 1): View {
  const canvas = stage.querySelector('canvas')!
  return {
    stage, target, fade, p: 0, drawnP: -1,
    scene: createScene(canvas, sprawl),
    controls: stage.querySelector<HTMLElement>('.controls')!,
  }
}

/** Scroll progress through a stage's transition, between holds of `before` and `after` vh. */
function stageProgress(stage: HTMLElement, before: number, after: number) {
  const r = stage.getBoundingClientRect()
  const transition = r.height - innerHeight - ((before + after) / 100) * innerHeight
  const t = clamp((-r.top - (before / 100) * innerHeight) / transition)
  return t > 0.999 ? 1 : t < 0.001 ? 0 : t // sub-pixel scroll rounding must not keep a view from settling
}

const intro = makeView(document.querySelector('#stage')!, () => stageProgress(intro.stage, 0, HOLD_VH))
const outro = makeView(
  document.querySelector('#outro')!,
  () => 1 - stageProgress(outro.stage, OUTRO_BEFORE_VH, 0),
  // Fades in from the moment the map is pinned under the last screen of text
  // (any earlier and it would be seen sliding up), complete halfway through the overlap.
  () => smooth(FADE_FROM, FADE_TO, -outro.stage.getBoundingClientRect().top / ((FADE_VH / 100) * innerHeight)),
)
const views = [intro, outro]
intro.stage.style.height = `${100 + INTRO_MORPH_VH + HOLD_VH}vh`
outro.stage.style.height = `${100 + OUTRO_BEFORE_VH + OUTRO_MORPH_VH}vh` // ends on the board at the page's last scroll position
for (const v of views) v.p = v.target() // no glide on load

const onScreen = (v: View) => {
  const r = v.stage.getBoundingClientRect()
  return r.bottom > 0 && r.top < innerHeight
}

/** Scroll offset where the intro morph ends and the hold on the finished map begins. */
function mapScrollY() {
  // Browsers round scroll positions to whole pixels: round up, past the threshold.
  return Math.ceil(intro.stage.offsetTop + intro.stage.offsetHeight - innerHeight - (HOLD_VH / 100) * innerHeight) + 1
}

/** Canvas opacity and controls: cheap, so updated on every scroll, not only on redraw. */
function applyFade(v: View) {
  const f = v.fade()
  v.stage.querySelector('canvas')!.style.opacity = String(f)
  // The projection controls only show while that view's finished map is fully shown.
  v.controls.style.visibility = v.p >= MAP_SETTLED_AT && f > 0.99 ? 'visible' : 'hidden'
}

function draw(v: View, force = false) {
  applyFade(v)
  if (!force && v.p === v.drawnP) return
  if (!onScreen(v)) { v.drawnP = -1; return } // off screen: nothing to draw (redrawn when it returns)
  v.drawnP = v.p
  v.scene.draw(v.p)
  if (v === outro) {
    // The finale (button + credits) fades in as the rebuilt title settles, scroll-linked;
    // hidden (and out of the tab order) until it is mostly there.
    const f = 1 - smooth(0, 0.08, v.p)
    finale.style.opacity = String(f)
    finale.style.visibility = f > 0.05 ? 'visible' : 'hidden'
  }
  if (v === intro) {
    const h = 1 - smooth(0, 0.04, v.p)
    hint.style.opacity = String(h)
    hint.hidden = h === 0 // display: none once gone, which also stops its bobbing arrow
    // The board button only exists while the intro board is (nearly) at rest.
    boardButton.style.visibility = v.p < 0.02 ? 'visible' : 'hidden'
  }
}
const drawAll = (force = false) => views.forEach((v) => draw(v, force))

// ─── Damped progress ──────────────────────────────────────────────────────────
// Each view's p glides towards its target with time constant TAU: each frame it
// covers 1 − e^(−Δt/τ) of the remaining distance. Runs only while catching up.
const TAU = 0.18 // seconds; higher = heavier, smoother; 0 = no damping
let gliding = false
let lastFrame = 0

function glide(now: number) {
  const tau = reducedMotion.matches ? 0 : TAU
  const dt = Math.min((now - lastFrame) / 1000, 0.1) // a stalled tab doesn't jump
  lastFrame = now
  let settled = true
  for (const v of views) {
    const goal = v.target()
    v.p = tau === 0 ? goal : v.p + (goal - v.p) * (1 - Math.exp(-dt / tau))
    if (Math.abs(goal - v.p) < 0.0005) v.p = goal // close enough: land exactly
    else settled = false
    draw(v)
  }
  if (settled) gliding = false
  else requestAnimationFrame(glide)
  projection.poke() // starts it as soon as the last LED has landed, mid-glide
}

function follow() {
  // Fades follow the scroll directly; redraw views that just came on screen;
  // glide only if some view is behind its target.
  for (const v of views) v.drawnP === -1 ? draw(v, true) : applyFade(v)
  if (gliding || views.every((v) => v.target() === v.p)) return
  gliding = true
  lastFrame = performance.now()
  requestAnimationFrame(glide)
}

// ─── The projection ───────────────────────────────────────────────────────────
// Runs while either view's finished map is shown: its last LED has landed in the
// DRAWN frame, the scroll asks for the map, and the stage is on screen. Scrolling
// within a hold or the text does not interrupt it.
const mapShown = (v: View) => v.p >= MAP_SETTLED_AT && v.target() >= 1 && onScreen(v) && v.fade() >= 0.5
const projection = createSprawlClock(
  () => { sprawl.step(); drawAll(true); syncControls() },
  () => views.some(mapShown),
)

// ─── Projection controls (one set per view, one shared state) ───────────────────
// Pause/Play (WCAG 2.2.2: moving content must be pausable). Readers who prefer
// reduced motion start paused. Reset goes back to generation 0, the data, which
// also restores the original title; it only shows once something has changed.
function syncControls() {
  for (const v of views) {
    // One button, two icons: the class picks the icon, the label says what a press does.
    const pause = v.controls.querySelector<HTMLElement>('.pause')!
    pause.classList.toggle('is-paused', projection.paused)
    pause.setAttribute('aria-label', projection.paused ? 'Play' : 'Pause')
    v.controls.querySelector<HTMLElement>('.reset')!.hidden = sprawl.generation === 0
  }
}
for (const v of views) {
  v.controls.querySelector('.pause')!.addEventListener('click', () => {
    projection.setPaused(!projection.paused)
    syncControls()
  })
  v.controls.querySelector('.reset')!.addEventListener('click', () => {
    sprawl.reset()
    hideListing() // its dot may not be built any more
    drawAll(true)
    syncControls()
    v.controls.querySelector<HTMLElement>('.pause')!.focus() // reset hides itself; keep focus in the group
  })
}

// ─── Listings: hover a built dot of the finished map ─────────────────────────────
// Each built (yellow) dot "is" a luxury property for sale: hovering it with a
// mouse rings the dot and shows a fake listing next to it. Only on the finished,
// fully shown map; any scroll hides it (the next mouse move brings it back).
const ring = document.querySelector<HTMLElement>('#dot-ring')!
const card = document.querySelector<HTMLElement>('#listing')!
const GAP = 12, MARGIN = 16 // px: card to dot, card to viewport edge
let shownDot = -1

function hideListing() {
  ring.hidden = card.hidden = true
  shownDot = -1
}

function showListing(canvas: HTMLCanvasElement, dot: { i: number; x: number; y: number; r: number }) {
  const l = listingFor(dot.i)
  card.lang = l.lang
  card.querySelector('img')!.src = l.photo
  card.querySelector('.listing-title')!.textContent = l.title
  card.querySelector('.listing-price')!.textContent = l.price
  card.querySelector('.listing-details')!.textContent = l.details
  const c = canvas.getBoundingClientRect()
  const x = c.left + dot.x, y = c.top + dot.y
  const d = dot.r * 2 + 6 // ring diameter: just outside the dot
  Object.assign(ring.style, { width: `${d}px`, height: `${d}px`, transform: `translate(${x - d / 2}px, ${y - d / 2}px)` })
  ring.hidden = card.hidden = false
  // To the right of the dot, or to its left if it would leave the viewport; centred vertically.
  const w = card.offsetWidth, h = card.offsetHeight
  let left = x + d / 2 + GAP
  if (left + w > innerWidth - MARGIN) left = x - d / 2 - GAP - w
  const top = clamp(y - h / 2, MARGIN, innerHeight - h - MARGIN)
  card.style.transform = `translate(${left}px, ${top}px)`
}

for (const v of views) {
  const canvas = v.stage.querySelector('canvas')!
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    const dot = v.p === 1 && v.fade() > 0.99 ? v.scene.dotAt(e.offsetX, e.offsetY) : null
    if (!dot) return hideListing()
    if (dot.i === shownDot) return
    shownDot = dot.i
    showListing(canvas, dot)
  })
  canvas.addEventListener('pointerleave', hideListing)
}
addEventListener('scroll', hideListing, { passive: true })

// ─── The board as a button ────────────────────────────────────────────────────
// A real <button> laid over the intro board. Clicking (or Enter/Space) scrolls the
// page natively to the map; the damping smooths it further. The scrollbar moves,
// so scrolling back still reverses the morph.
function placeBoardButton() {
  const canvas = intro.stage.querySelector('canvas')!
  const b = boardBox(canvas.clientWidth, canvas.clientHeight) // same box the scene draws the board in
  Object.assign(boardButton.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` })
}
/**
 * Pause / Reset sit at the island's bottom-right corner: open sea on Mallorca's
 * outline (the island narrows to the south-west there), so they hug the island
 * without covering any dot, at every screen size.
 */
function placeControls() {
  for (const v of views) {
    const canvas = v.stage.querySelector('canvas')!
    const b = islandBox(canvas.clientWidth, canvas.clientHeight)
    Object.assign(v.controls.style, { left: `${b.x + b.w}px`, top: `${b.y + b.h}px` })
  }
}

/** The finale button sits just under the outro board (same box the scene draws it in). */
function placeFinale() {
  const canvas = outro.stage.querySelector('canvas')!
  const b = boardBox(canvas.clientWidth, canvas.clientHeight)
  finale.querySelector<HTMLElement>('.cta')!.style.top = `${b.y + b.h + Math.max(28, b.P * 4)}px`
}
boardButton.addEventListener('click', () => {
  scrollTo({ top: mapScrollY(), behavior: reducedMotion.matches ? 'auto' : 'smooth' })
})

addEventListener('scroll', follow, { passive: true })
addEventListener('resize', () => {
  for (const v of views) { v.scene.resize(); v.p = v.target() }
  placeBoardButton()
  placeControls()
  placeFinale()
  drawAll(true)
})
for (const v of views) v.scene.resize()
placeBoardButton()
placeControls()
placeFinale()
drawAll(true)
syncControls()
