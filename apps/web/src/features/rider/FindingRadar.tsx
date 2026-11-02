/**
 * "Looking for jobs" effect over the map while the rider is online: a beam of light sweeping round
 * the rider, with rings pulsing outward. Sits at the map's centre (the map is centred on the rider)
 * and never takes taps. CSS only; still with reduced motion.
 */
export function FindingRadar() {
  return (
    <div className="fr-root pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <style>{CSS}</style>
      <div className="fr-center">
        <span className="fr-ring" />
        <span className="fr-ring" style={{ animationDelay: '1s' }} />
        <span className="fr-ring" style={{ animationDelay: '2s' }} />
        <span className="fr-sweep" />
      </div>
    </div>
  );
}

const CSS = `
.fr-center{position:absolute;left:50%;top:50%;width:0;height:0}
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
@media (prefers-reduced-motion:reduce){.fr-root *{animation:none!important}.fr-ring{opacity:.25}}
`;
