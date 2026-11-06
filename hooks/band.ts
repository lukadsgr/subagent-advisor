import type { Assessment, Plan, Spending, Verdict } from '../types'
import { formatTime, formatTokens, formatUsd } from './estimate'

export const HEADLINE: Record<Verdict, string> = {
  use: 'Subagentes recomendados',
  maybe: 'Subagentes: você decide',
  skip: 'Subagentes não recomendados',
}

export const COLOR: Record<Verdict, string> = { use: '#3fb950', maybe: '#e3b341', skip: '#f85149' }

export const CREDIT = 'Created by LUKADSGR'

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const CELL = 4
const PAD = 12
const CARD_W = 158
const CARD_H = 74
const GAP = 8
const LEFT_H = 92
// Below this the two cards leave the text no room, so they move under it.
const NARROW = 640

export const heightOf = (W: number): number => (W < NARROW ? LEFT_H + CARD_H + GAP + 4 : LEFT_H)

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// Rough advance of system UI text, in em: enough to wrap a line.
const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.55)

const widthOf = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

const fit = (s: string, size: number, maxW: number): string => {
  if (widthOf(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (widthOf(`${out}${ch}…`, size) > maxW) break
    out += ch
  }
  return `${out}…`
}

const wrap = (s: string, size: number, maxW: number, maxLines: number): string[] => {
  const lines: string[] = []
  let line = ''
  const words = s.split(' ')
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (widthOf(next, size) <= maxW) {
      line = next
      continue
    }
    if (lines.length === maxLines - 1) return [...lines, fit(words.slice(i - (line ? line.split(' ').length : 0)).join(' '), size, maxW)]
    lines.push(line)
    line = words[i]
  }
  return line ? [...lines, line] : lines
}

// Dithered dots, sparse on the left and dense on the right, in four twinkling groups.
// One path per group keeps a wide band to a few tens of kilobytes.
const dots = (W: number, H: number): string[] => {
  const groups = ['', '', '', '']
  const cols = Math.floor(W / CELL)
  const rows = Math.floor(H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.12 + 0.6 * Math.pow(c / Math.max(1, cols), 1.3)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) groups[Math.floor(noise(r, c) * 4)] += `M${c * CELL + 1} ${r * CELL + 1}h2v2h-2z`
    }
  }
  return groups
}

const card = (x: number, y: number, label: string, p: Plan, color: string, isBest: boolean): string => `
<g transform="translate(${x},${y})">
<rect class="sa-card" width="${CARD_W}" height="${CARD_H}" rx="8"${isBest ? ` stroke="${color}" stroke-width="2"` : ''}/>
<text class="sa-t" x="12" y="19" font-family="${FONT}" font-size="11.5" font-weight="700" letter-spacing="0.4">${label}</text>
<text class="sa-t" x="12" y="41" font-family="${FONT}" font-size="17" font-weight="700">${xml(formatTokens(p.tokens))} tokens</text>
<text fill="${color}" x="12" y="63" font-family="${FONT}" font-size="17" font-weight="700">${xml(formatUsd(p.usd))}</text>
<text class="sa-m" x="${CARD_W - 12}" y="63" text-anchor="end" font-family="${FONT}" font-size="12">~${xml(formatTime(p.seconds))}</text>
</g>`

export const bandSvg = (a: Assessment, spent: Spending, W: number): string => {
  const H = heightOf(W)
  const color = COLOR[a.verdict]
  const isNarrow = W < NARROW
  const cardsW = CARD_W * 2 + GAP
  const textW = (isNarrow ? W : W - cardsW - PAD) - PAD * 2
  const cardY = isNarrow ? LEFT_H : (H - CARD_H) / 2
  const soloX = isNarrow ? PAD : W - cardsW - PAD
  const delegatedX = soloX + CARD_W + GAP

  const headlineW = widthOf(HEADLINE[a.verdict], 15)
  const title = fit(a.title, 12, Math.max(0, textW - headlineW - 12))
  const reason = wrap(a.reason, 12.5, textW, 2)
  const real = `Real até agora: ${formatTokens(spent.tokens)} tokens · ${formatUsd(spent.usd)} · ${spent.workers} subagentes`
  const creditW = widthOf(CREDIT, 10)
  const [g0, g1, g2, g3] = dots(W, H)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.sa-bg{fill:#f6f6f4}.sa-card{fill:#ffffff}.sa-t{fill:#1f1f1f}.sa-m{fill:#6e6e6e}
.sa-h{paint-order:stroke;stroke:#f6f6f4;stroke-width:4px;stroke-linejoin:round}
@media (prefers-color-scheme: dark){.sa-bg{fill:#1b1b1b}.sa-card{fill:#262626}.sa-t{fill:#ececec}.sa-m{fill:#a0a0a0}.sa-h{stroke:#1b1b1b}}
.sa-d0,.sa-d1,.sa-d2,.sa-d3{animation:sa-tw 2.4s ease-in-out infinite}
.sa-d1{animation-duration:3s;animation-delay:-.7s}.sa-d2{animation-duration:2s;animation-delay:-1.3s}.sa-d3{animation-duration:3.4s;animation-delay:-.4s}
@keyframes sa-tw{0%,100%{opacity:.55}50%{opacity:.2}}
@media (prefers-reduced-motion: reduce){.sa-d0,.sa-d1,.sa-d2,.sa-d3{animation:none;opacity:.4}}
</style>
<defs><clipPath id="sa-clip-${W}-${H}"><rect width="${W}" height="${H}" rx="10"/></clipPath></defs>
<g clip-path="url(#sa-clip-${W}-${H})">
<rect class="sa-bg" width="${W}" height="${H}"/>
<g fill="${color}"><path class="sa-d0" d="${g0}"/><path class="sa-d1" d="${g1}"/><path class="sa-d2" d="${g2}"/><path class="sa-d3" d="${g3}"/></g>
</g>
<text class="sa-h" fill="${color}" x="${PAD}" y="23" font-family="${FONT}" font-size="15" font-weight="700">${xml(HEADLINE[a.verdict])}</text>
<text class="sa-m sa-h" x="${PAD + headlineW + 12}" y="23" font-family="${FONT}" font-size="12">${xml(title)}</text>
${reason.map((line, i) => `<text class="sa-t sa-h" x="${PAD}" y="${44 + i * 17}" font-family="${FONT}" font-size="12.5">${xml(line)}</text>`).join('')}
<text class="sa-m sa-h" x="${PAD}" y="82" font-family="${FONT}" font-size="11">${xml(fit(real, 11, textW - creditW - 12))}</text>
<text class="sa-m sa-h" x="${PAD + textW}" y="82" text-anchor="end" font-family="${FONT}" font-size="10" opacity="0.8">${CREDIT}</text>
${card(soloX, cardY, 'SEM SUBAGENTES', a.solo, color, a.verdict === 'skip')}
${card(delegatedX, cardY, 'COM SUBAGENTES', a.delegated, color, a.verdict === 'use')}
</svg>`
}
