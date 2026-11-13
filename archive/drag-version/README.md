# Archive: the drag version (retired 2026-11-13)

**Not part of the project.** An alternative to the scroll page where the title
board itself is the control: pull it down with the pointer (or press Enter /
click) and it lies down into the island. Built with React 19 and Dragology 0.2.0
(`d.between([BOARD, ISLAND])`, the canvas receiving the blended `t` via
`dragologyLerpProps`). Retired in favour of the scroll version, which got damped
progress and a clickable board, giving the controlled smoothness this one had.

- `drag-test.html`: the last self-contained build (morph, 2×2 split, Game of Life
  at 12 gen/s). Open it directly; this is the working record.
- `drag.html`, `src/drag.tsx`: the source, for reference only. It imported the
  live `src/scene.ts` and `src/life-clock.ts`, which keep evolving, and the React
  and Dragology dependencies have been removed from the project, so it no longer
  builds as is.
