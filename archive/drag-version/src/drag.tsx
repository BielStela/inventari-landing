// Drag version: the title board itself is the control. Pull it down and it
// lies down into the island; let go and it snaps to whichever end is closer.
// Once on the island, the Game of Life runs until the board is lifted back.
import './style.css'
import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DraggableRenderer, translate, type Draggable } from 'dragology'
import { createScene, boardBox, MAP_SETTLED_AT, type Scene } from './scene.ts'
import { createLifeClock } from './life-clock.ts'
import content from './content.html?raw'

document.querySelector('#content')!.innerHTML = content

/** 0 = the title board, 1 = the island. Dragology blends between the two. */
type State = { t: number }
const BOARD: State = { t: 0 }
const ISLAND: State = { t: 1 }

const status = document.querySelector<HTMLElement>('#status')!

// ─── Canvas ──────────────────────────────────────────────────────────────────
// A React component is opaque to Dragology: it isn't interpolated as SVG, it
// just receives props. With dragologyLerpProps={['t']}, it receives the
// *blended* t on every drag frame, so thousands of dots cost Dragology nothing.
function SceneCanvas({ t, width, height }: { t: number; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const lifeRef = useRef<ReturnType<typeof createLifeClock> | null>(null)
  const tRef = useRef(t)
  tRef.current = t

  // Build the scene once per size, then draw only when t changes.
  // Outside of Life, nothing runs at rest.
  useLayoutEffect(() => {
    const canvas = canvasRef.current!
    sceneRef.current ??= createScene(canvas)
    if (import.meta.env.DEV) Object.assign(window, { __scene: sceneRef.current }) // for dev checks in the console
    sceneRef.current.resize()
    // Game of Life: runs once the last LED has landed (t past MAP_SETTLED_AT, including
    // the elastic overshoot past 1) and the canvas is on screen. Pulling the board
    // back up stops it, and the letters re-form from whatever is alive.
    lifeRef.current ??= createLifeClock(
      sceneRef.current,
      () => tRef.current >= MAP_SETTLED_AT && canvas.getBoundingClientRect().bottom > 0,
    )
  }, [width, height])

  useLayoutEffect(() => {
    sceneRef.current?.draw(t)
    lifeRef.current?.poke()
    const settled = t < 0.01 ? 'Showing the title.' : t > 0.99 ? 'Showing a map of rural construction in Mallorca.' : null
    if (settled && status.textContent !== settled) status.textContent = settled
  }, [t, width, height])

  return <canvas ref={canvasRef} style={{ width, height, display: 'block' }} aria-hidden="true" />
}

// ─── Draggable ───────────────────────────────────────────────────────────────
function makeDraggable(w: number, h: number): Draggable<State> {
  const box = boardBox(w, h)
  const pad = Math.max(16, box.P * 2)
  const pull = Math.min(h * 0.34, 320) // how far down the word must travel
  const gripY = box.y + box.h + Math.max(36, box.P * 5)
  const toggle = (s: State) => (s.t > 0.5 ? BOARD : ISLAND)

  return ({ state, d, draggedId, setState }) => (
    <g>
      <foreignObject width={w} height={h}>
        <SceneCanvas t={state.t} width={w} height={h} dragologyLerpProps={['t']} />
      </foreignObject>

      {/* The grab area travels from the word down by `pull`. Its position in
          each state is all Dragology needs to map the pointer to a blend. */}
      <g
        id="grab"
        className="grab"
        transform={translate(0, state.t * pull)}
        style={{ cursor: draggedId ? 'grabbing' : 'grab' }}
        role="button"
        tabIndex={0}
        // Must be identical in both states: Dragology blends every attribute,
        // and two different strings can't be blended.
        aria-label="Switch between the title and the map"
        onClick={() => setState(toggle(state), { transition: { easing: 'cubic-out', duration: 1600 } })}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          setState(toggle(state), { transition: { easing: 'cubic-out', duration: 1600 } })
        }}
        dragologyOnDrag={() =>
          d
            .between([BOARD, ISLAND])
            .withDropTransition({ easing: 'elastic-out', duration: 900 })
            .withOverlay(
              <line
                x1={w / 2} y1={gripY} x2={w / 2} y2={gripY + pull}
                stroke="#efe9da" strokeOpacity={0.25} strokeDasharray="2 6"
              />,
            )
        }
      >
        <rect
          className="grab-hit"
          transform={translate(box.x - pad, box.y - pad)}
          width={box.w + pad * 2}
          height={box.h + pad * 2}
          rx={6}
          fill="transparent"
        />
        <g transform={translate(w / 2, gripY)}>
          {/* A 2×4 braille cell as the grip glyph. */}
          {[0, 1].map((c) =>
            [0, 1, 2, 3].map((r) => (
              <rect
                id={`grip-${c}-${r}`}
                transform={translate(c * 6 - 4.5, r * 6 - 10.5)}
                width={3}
                height={3}
                fill="#efe9da"
                opacity={0.8}
              />
            )),
          )}
          <text
            transform={translate(14, 4)}
            className="grip-label"
            opacity={draggedId ? 0 : 1 - state.t}
          >
            PULL DOWN
          </text>
          <text transform={translate(14, 4)} className="grip-label" opacity={draggedId ? 0 : state.t}>
            LIFT BACK
          </text>
        </g>
      </g>
    </g>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────
function App({ container }: { container: HTMLElement }) {
  // Size from the container itself, not window.innerWidth/Height.
  const [size, setSize] = useState({ w: container.clientWidth, h: container.clientHeight })
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [container])

  // Dev-only: ?t=0.5 starts at a given blend, for screenshots.
  const start = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('t') ?? 0) : 0
  const draggable = makeDraggable(size.w, size.h)

  return (
    <DraggableRenderer
      key={`${size.w}x${size.h}`}
      draggable={draggable}
      initialState={{ t: start }}
      width={size.w}
      height={size.h}
    />
  )
}

const container = document.querySelector<HTMLElement>('#root')!
createRoot(container).render(
  <StrictMode>
    <App container={container} />
  </StrictMode>,
)
