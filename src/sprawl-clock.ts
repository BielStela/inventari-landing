// The projection's clock.
// Runs only while the page says the map is fully formed and on screen, the tab
// is visible, and it isn't paused. Readers who prefer reduced motion start
// paused (they can press Play). Steps at a fixed rate; frames in between draw
// nothing. It never catches up on missed time.
export function createSprawlClock(
  step: () => void, // advance one generation and redraw
  mapShown: () => boolean,
  gensPerSec = 12, // while the formed map is on screen
) {
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches
  const allowed = () => !paused && !document.hidden && mapShown()
  let running = false
  let lastTick = 0

  function tick(now: number) {
    if (!allowed()) { running = false; return }
    if (now - lastTick >= 1000 / gensPerSec) {
      lastTick = now
      step()
    }
    requestAnimationFrame(tick)
  }

  /** Start if allowed and not already running. Cheap; call it whenever things change. */
  function poke() {
    if (running || !allowed()) return
    running = true
    lastTick = -Infinity // first generation on the very first frame: no pause after landing
    requestAnimationFrame(tick)
  }

  // Coming back to the tab, or scrolling the map back into view, restarts it.
  document.addEventListener('visibilitychange', poke)
  addEventListener('scroll', poke, { passive: true })

  return {
    poke,
    get paused() { return paused },
    setPaused(value: boolean) { paused = value; poke() },
  }
}
