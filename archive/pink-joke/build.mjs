// Build the archived joke as ONE self-contained HTML file: archive/pink-joke/pink-test.html
//
//   node archive/pink-joke/build.mjs
import { build } from 'vite'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const fontsDir = join(here, '..', '..', 'vendor', 'fonts') // shared with the real project
const tmp = join(here, '.tmp')

await build({
  root: here,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: { input: join(here, 'index.html') },
  },
})

let html = readFileSync(join(tmp, 'index.html'), 'utf8')
const asset = (path) => readFileSync(join(tmp, path.replace(/^\//, '')), 'utf8')
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) =>
  `<script type="module">${asset(src).replaceAll('</script', '<\\/script')}</script>`,
)
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${asset(href)}</style>`)

const font = (family, weight, file) => {
  const data = readFileSync(join(fontsDir, file)).toString('base64')
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2')}`
}
html = html.replace(/\s*<link rel="preconnect"[^>]*>/g, '')
html = html.replace(/\s*<link\s+href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '')
html = html.replace('</head>', `<style>${[
  font('IBM Plex Mono', 400, 'IBMPlexMono-400-latin.woff2'),
  font('IBM Plex Mono', 500, 'IBMPlexMono-500-latin.woff2'),
  font('IBM Plex Sans', 400, 'IBMPlexSans-400-latin.woff2'),
].join('\n')}</style>\n</head>`)
html = html.replace(/<link rel="icon"[^>]*>/, '<link rel="icon" href="data:," />')

writeFileSync(join(here, 'pink-test.html'), html)
rmSync(tmp, { recursive: true, force: true })
console.log(`${join(here, 'pink-test.html')} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`)
