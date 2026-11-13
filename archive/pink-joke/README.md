# Archive: the pink joke (quarantined)

**Not part of the project.** A throwaway joke variant of the pixel-letters experiment, kept for the record only.

What it is: the scroll page re-skinned in hot pink. The board reads "UMUWUWU / UWU UWU / UMUWUWU!!" in 💎 emoji, and the LEDs
fly into a fairytale castle with a scroll-driven rainbow, shooting stars and hearts rising from the towers.
A synthesised bubblegum-pop loop plays after the first click (`src/music.ts`).

It is fully self-contained: its own copy of the renderer (`src/scene.ts`, which includes the joke-only
theme, emoji, castle/heart targets and effects), page, styles and build. Nothing in the real project
imports from here, the main `tsc` only covers `/src`, and the main build only lists its own pages.

- Built file: `pink-test.html` (open it directly, no server needed)
- Rebuild: `node archive/pink-joke/build.mjs` (from the project root)
- Typecheck: `npx tsc --noEmit -p archive/pink-joke`

Do not copy code from here into `/src`.
