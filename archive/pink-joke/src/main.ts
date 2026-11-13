// Scroll version: native scroll position drives the transition.
// Draws only when the scroll position or the size changes; nothing runs at rest.
import './style.css'
import { createScene, clamp, smooth, type Theme } from './scene.ts'
import content from './content.html?raw'
import { createSong } from './music.ts'

const contentEl = document.querySelector('#content')
if (contentEl) contentEl.innerHTML = content

const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const stage = document.querySelector<HTMLElement>('#stage')!
const hint = document.querySelector<HTMLElement>('#hint')!

// <body data-theme="pink"> switches to the pink, diamond-dot variant.
const PINK: Theme = {
  bg: [24, 5, 18],
  block: [46, 12, 36],
  off: [78, 28, 62],
  on: [255, 105, 180], // hot pink
  coast: [150, 66, 124],
  shape: 'emoji',
  emoji: '💎',
  target: 'castle',
  lines: ['UMUWUWU', 'UWU UWU', 'UMUWUWU!!'],
  rainbow: true,
  fx: true,
}
const pink = document.body.dataset.theme === 'pink'
const scene = createScene(canvas, pink ? PINK : undefined)

// Pink variant: a synthesised cheesy loop, always on. Browsers block sound until
// the first click/key/tap, so we try right away and again on the first gesture.
// A small ♪ pulses until it is actually playing, then disappears.
const music = document.querySelector<HTMLButtonElement>('#music')
if (music) {
  const song = createSong()
  const sync = () => { music.hidden = song.started }
  const tryStart = () => song.start().then(sync, sync)
  tryStart()
  for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, tryStart, { once: true })
  music.addEventListener('click', tryStart)
}

// Dev-only: ?p=0.5 pins the progress, for screenshots.
const forcedP = import.meta.env.DEV ? new URLSearchParams(location.search).get('p') : null

// The last part of the stage is a hold: the finished map stays put before the text arrives.
const HOLD_VH = pink ? 120 : 30 // the pink variant lingers on the castle for the effects

function progress() {
  if (forcedP !== null) return Number(forcedP)
  const r = stage.getBoundingClientRect()
  const transition = r.height - innerHeight - (HOLD_VH / 100) * innerHeight
  return clamp(-r.top / transition)
}

// Rainbow phase: follows the scroll through the whole stage, hold included.
function rainbow() {
  const r = stage.getBoundingClientRect()
  return clamp(-r.top / (r.height - innerHeight)) * 1.5
}
// Effects phase: same scroll position, 0 → 1 over the whole stage.
const fxPhase = () => rainbow() / 1.5

let lastP = -1
let lastRainbow = -1
let queued = false
function render(force = false) {
  queued = false
  const p = progress()
  const rb = rainbow()
  if (!force && p === lastP && rb === lastRainbow) return
  lastP = p
  lastRainbow = rb
  scene.draw(p, rb, fxPhase())
  hint.style.opacity = String(1 - smooth(0, 0.04, p))
}
function schedule() {
  if (!queued) { queued = true; requestAnimationFrame(() => render()) }
}

addEventListener('scroll', schedule, { passive: true })
addEventListener('resize', () => { scene.resize(); render(true) })
scene.resize()
render(true)
