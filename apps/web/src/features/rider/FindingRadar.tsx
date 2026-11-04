/**
 * "Looking for jobs" effect while the rider is online: a beam of light sweeping round the rider,
 * with rings pulsing outward. It is drawn inside the rider's own map marker (see MapView's
 * `radar` option), so it stays on the rider's exact position while the map is panned or zoomed.
 * CSS only; still with reduced motion.
 */

/** Markup centred on the marker's anchor point; never takes taps. */
export const RADAR_HTML =
  '<div class="fr-center" aria-hidden="true">' +
  '<span class="fr-ring"></span>' +
  '<span class="fr-ring" style="animation-delay:1s"></span>' +
  '<span class="fr-ring" style="animation-delay:2s"></span>' +
  '<span class="fr-sweep"></span>' +
  '</div>';

export const RADAR_CSS = `
.fr-center{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.fr-ring{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:999px;
  border:2px solid var(--c-accent);background:color-mix(in srgb,var(--c-accent) 10%,transparent);
  animation:fr-ring 3s cubic-bezier(.2,.6,.3,1) infinite;opacity:0}
.fr-sweep{position:absolute;left:-150px;top:-150px;width:300px;height:300px;border-radius:999px;
  background:conic-gradient(from 0deg,transparent 0deg,transparent 270deg,
    color-mix(in srgb,var(--c-accent) 8%,transparent) 300deg,
    color-mix(in srgb,var(--c-accent) 38%,transparent) 359deg,transparent 360deg);
  -webkit-mask:radial-gradient(circle,#000 0 55%,transparent 72%);
  mask:radial-gradient(circle,#000 0 55%,transparent 72%);
  animation:fr-spin 2.4s linear infinite}
@keyframes fr-ring{0%{transform:scale(1);opacity:.55}100%{transform:scale(9);opacity:0}}
@keyframes fr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.fr-center *{animation:none!important}.fr-ring{opacity:.25}}
`;
