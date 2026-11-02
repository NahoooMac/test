// The rider loading animation as plain HTML/SVG strings. One source for two places:
//  - index.html (via the Vite plugin), so it shows the instant the page arrives, before any JS
//  - <BrandLoader/> in the app, for session restore and screen loads
// Colours use the theme variables with literal fallbacks, because the splash renders before the
// app's stylesheet has loaded. Static markup only: nothing user-supplied ever goes in here.

// The city is a square grid of roads every BLOCK units; the rider starts AHEAD units before a
// junction. One loop = ride AHEAD to the junction, turn right (the camera rotates -90° to follow),
// ride BLOCK - AHEAD on the new road. A grid rotated by 90° looks the same, and the rider ends
// AHEAD before the next junction — exactly the first frame — so the loop never jumps.
const BLOCK = 240;
const AHEAD = 120;
const ROAD = 46;
const RANGE = [-2, -1, 0, 1, 2];
const CX = 120;
const CY = 150;

const C = {
  navy: 'var(--c-navy,#0f172a)',
  accent: 'var(--c-accent,#2563eb)',
  road: 'var(--c-surface-3,#e2e8f0)',
  block: 'var(--c-line-strong,#cbd5e1)',
  dash: 'var(--c-surface,#ffffff)',
};

function city(): string {
  const span = BLOCK * 2.5;
  const s = BLOCK - ROAD - 44;
  let blocks = '';
  let roads = '';
  let dashes = '';
  for (const k of RANGE) {
    for (const m of RANGE) {
      const x = k * BLOCK + ROAD / 2 + 22;
      const y = -AHEAD + m * BLOCK + ROAD / 2 + 22;
      blocks +=
        `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="6" opacity=".8"/>` +
        `<path d="M${x + s / 2} ${y}V${y + s}M${x} ${y + s / 2}H${x + s}" opacity=".45"/>`;
    }
    roads +=
      `<rect x="${k * BLOCK - ROAD / 2}" y="${-AHEAD - span}" width="${ROAD}" height="${span * 2}"/>` +
      `<rect x="${-span}" y="${-AHEAD + k * BLOCK - ROAD / 2}" width="${span * 2}" height="${ROAD}"/>`;
    // Dashes are phased from the junctions so the turn stays seamless.
    dashes +=
      `<line x1="${k * BLOCK}" y1="${-AHEAD - 2 * BLOCK}" x2="${k * BLOCK}" y2="${-AHEAD + 2 * BLOCK}"/>` +
      `<line x1="${-2 * BLOCK}" y1="${-AHEAD + k * BLOCK}" x2="${2 * BLOCK}" y2="${-AHEAD + k * BLOCK}"/>`;
  }
  return (
    `<g stroke="${C.block}" stroke-width="3" fill="none" stroke-linecap="round">${blocks}</g>` +
    `<g fill="${C.road}">${roads}</g>` +
    `<g stroke="${C.dash}" stroke-width="2.5" stroke-dasharray="12 18">${dashes}</g>`
  );
}

const RIDER =
  `<ellipse cx="0" cy="24" rx="15" ry="6" fill="#0f172a" opacity=".12"/>` +
  `<rect x="-17" y="-24" width="34" height="3.5" rx="1.75" fill="${C.navy}"/>` +
  `<circle cx="-17" cy="-22.2" r="3" fill="${C.navy}"/><circle cx="17" cy="-22.2" r="3" fill="${C.navy}"/>` +
  `<rect x="-3" y="-34" width="6" height="11" rx="3" fill="${C.navy}"/>` +
  `<path d="M-13 -21L-11 -6M13 -21L11 -6" stroke="${C.accent}" stroke-width="4.5" stroke-linecap="round"/>` +
  `<ellipse cx="0" cy="-4" rx="12" ry="9" fill="${C.accent}"/>` +
  `<circle cx="0" cy="-8" r="7.5" fill="#fff" stroke="${C.navy}" stroke-width="2"/>` +
  `<rect x="-9.5" y="6" width="19" height="17" rx="3" fill="#fff" stroke="${C.navy}" stroke-width="2"/>` +
  `<path d="M-4 14.5h6m-2.5-3 3 3-3 3" stroke="${C.accent}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The animated picture (no text). `id` keeps gradient/mask ids unique if two are on a page. */
export function brandLoaderSvg(id = 'bl'): string {
  return (
    `<svg viewBox="0 0 240 300" class="bl-svg" aria-hidden="true">` +
    `<defs><radialGradient id="${id}-g" cx="50%" cy="50%" r="50%">` +
    `<stop offset="55%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient>` +
    `<mask id="${id}-m"><rect width="240" height="300" fill="url(#${id}-g)"/></mask></defs>` +
    `<g mask="url(#${id}-m)"><g class="bl-cam"><g transform="translate(${CX} ${CY})">` +
    `<g class="bl-move">${city()}</g></g></g></g>` +
    `<g transform="translate(${CX} ${CY})"><g class="bl-lean"><g class="bl-bob">${RIDER}</g></g></g>` +
    `</svg>`
  );
}

// 5 s loop: 0–40% straight to the junction, 40–64% turn right (camera -90°), 64–100% straight on.
export const BRAND_LOADER_CSS = `
.bl-root{display:flex;flex-direction:column;align-items:center}
.bl-svg{width:15rem;max-width:70vw;height:auto;animation:bl-in .5s ease-out both}
.bl-cam{transform-box:view-box;transform-origin:${CX}px ${CY}px;animation:bl-cam 5s infinite}
.bl-move{animation:bl-move 5s infinite}
.bl-lean{animation:bl-lean 5s infinite}
.bl-bob{animation:bl-bob .6s ease-in-out infinite alternate}
.bl-text{margin-top:-1.5rem;text-align:center;animation:bl-in .6s ease-out .6s both}
@keyframes bl-cam{0%,38%{transform:rotate(0deg);animation-timing-function:ease-in-out}64%,100%{transform:rotate(-90deg)}}
@keyframes bl-move{0%{transform:translate(0px,0px);animation-timing-function:linear}40%{transform:translate(0px,${AHEAD}px);animation-timing-function:ease-in-out}64%{transform:translate(-14px,${AHEAD + 4}px);animation-timing-function:linear}100%{transform:translate(${-(BLOCK - AHEAD)}px,${AHEAD}px)}}
@keyframes bl-lean{0%,34%{transform:rotate(0deg);animation-timing-function:ease-out}46%{transform:rotate(24deg);animation-timing-function:ease-in-out}68%,100%{transform:rotate(0deg)}}
@keyframes bl-bob{from{transform:translateY(-.6px)}to{transform:translateY(.6px)}}
@keyframes bl-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.bl-root *{animation:none!important}}
`;

/** Two-tone wordmark split, e.g. "Cour" + "ier". */
export function splitName(name: string): [string, string] {
  const i = Math.ceil(name.length / 2);
  return [name.slice(0, i), name.slice(i)];
}
