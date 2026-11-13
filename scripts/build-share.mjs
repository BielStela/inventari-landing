// Build the page as ONE self-contained HTML file (JS, CSS and fonts inlined),
// for sharing. Output: dist-share/scroll-test.html
//
//   pnpm build:share
import { build } from 'vite'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'dist-share')

const ENTRY = 'index.html'
const OUT = 'scroll-test.html'

// Vendored fonts, embedded as base64 @font-face rules.
const font = (family, weight, file) => {
  const data = readFileSync(join(root, 'vendor', 'fonts', file)).toString('base64')
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2')}`
}
const FONTS = [
  font('IBM Plex Sans', 400, 'IBMPlexSans-400-latin.woff2'),
].join('\n')

mkdirSync(outDir, { recursive: true })
const tmp = join(outDir, '.tmp')
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: { input: join(root, ENTRY) },
  },
})

let html = readFileSync(join(tmp, ENTRY), 'utf8')
const asset = (path) => readFileSync(join(tmp, path.replace(/^\//, '')), 'utf8')

// Inline the bundled JS and CSS.
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) =>
  `<script type="module">${asset(src).replaceAll('</script', '<\\/script')}</script>`,
)
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${asset(href)}</style>`)

// Replace Google Fonts with the vendored, embedded ones.
html = html.replace(/\s*<link rel="preconnect"[^>]*>/g, '')
html = html.replace(/\s*<link\s+href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '')
html = html.replace('</head>', `<style>${FONTS}</style>\n</head>`)

// The favicon points to a file that won't exist.
html = html.replace(/<link rel="icon"[^>]*>/, '<link rel="icon" href="data:," />') // no favicon request

if (/\b(src|href)="\/(?!\/)/.test(html)) throw new Error(`${OUT}: a local file reference survived inlining`)
if (/<script[^>]+src=|<link[^>]+stylesheet[^>]+href="http/.test(html)) throw new Error(`${OUT}: external script or stylesheet`)

writeFileSync(join(outDir, OUT), html)
rmSync(tmp, { recursive: true, force: true })
console.log(`${join(outDir, OUT)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`)
