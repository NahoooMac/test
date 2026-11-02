import { useTranslation } from 'react-i18next';
import { APP_NAME } from '../lib/brand.ts';
import { cn } from './cn.ts';

// The city is a square grid of roads every BLOCK units; the rider starts AHEAD units before a
// junction. One loop = ride AHEAD to the junction, turn right (the camera rotates -90° to follow),
// ride BLOCK - AHEAD on the new road. A grid rotated by 90° looks the same, and the rider ends
// AHEAD before the next junction — exactly the first frame — so the loop never jumps.
const BLOCK = 240;
const AHEAD = 120;
const ROAD = 46;
const RANGE = [-2, -1, 0, 1, 2];
// Rider (and camera pivot) position in the 240×300 picture.
const CX = 120;
const CY = 150;

/**
 * Splash/loading animation: a rider seen from above rides straight, turns right at a junction, and
 * the camera rotates to follow, like turn-by-turn navigation. Pure SVG + CSS, so it is tiny and
 * sharp at any size; with reduced motion it shows a still frame.
 */
export function BrandLoader({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  const { t } = useTranslation();
  const split = Math.ceil(APP_NAME.length / 2);
  const span = BLOCK * 2.5;
  return (
    <div
      className={cn('bl-root flex flex-col items-center', className)}
      role="status"
      aria-live="polite"
    >
      <style>{CSS}</style>
      <svg viewBox="0 0 240 300" className="bl-fade h-auto w-60 max-w-[70vw]" aria-hidden>
        <defs>
          <radialGradient id="bl-fade" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="#fff" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
          <mask id="bl-mask">
            <rect width="240" height="300" fill="url(#bl-fade)" />
          </mask>
        </defs>

        <g mask="url(#bl-mask)">
          {/* Camera: rotates around the rider when they turn. */}
          <g className="bl-cam">
            <g transform={`translate(${CX} ${CY})`}>
              {/* The city slides under the rider. Coordinates are relative to the rider. */}
              <g className="bl-move">
                {/* City blocks: square outlines with a cross, so a 90° turn looks identical. */}
                <g stroke="var(--c-line-strong)" strokeWidth="3" fill="none" strokeLinecap="round">
                  {RANGE.flatMap((k) =>
                    RANGE.map((m) => {
                      const x = k * BLOCK + ROAD / 2 + 22;
                      const y = -AHEAD + m * BLOCK + ROAD / 2 + 22;
                      const s = BLOCK - ROAD - 44;
                      return (
                        <g key={`${k}:${m}`}>
                          <rect x={x} y={y} width={s} height={s} rx="6" opacity="0.8" />
                          <path
                            d={`M${x + s / 2} ${y}V${y + s}M${x} ${y + s / 2}H${x + s}`}
                            opacity="0.45"
                          />
                        </g>
                      );
                    }),
                  )}
                </g>
                {/* Roads */}
                <g fill="var(--c-surface-3)">
                  {RANGE.map((k) => (
                    <rect
                      key={`v${k}`}
                      x={k * BLOCK - ROAD / 2}
                      y={-AHEAD - span}
                      width={ROAD}
                      height={span * 2}
                    />
                  ))}
                  {RANGE.map((m) => (
                    <rect
                      key={`h${m}`}
                      x={-span}
                      y={-AHEAD + m * BLOCK - ROAD / 2}
                      width={span * 2}
                      height={ROAD}
                    />
                  ))}
                </g>
                {/* Centre-line dashes, phased from the junctions so the turn stays seamless. */}
                <g stroke="var(--c-surface)" strokeWidth="2.5" strokeDasharray="12 18">
                  {RANGE.map((k) => (
                    <line
                      key={`dv${k}`}
                      x1={k * BLOCK}
                      y1={-AHEAD - 2 * BLOCK}
                      x2={k * BLOCK}
                      y2={-AHEAD + 2 * BLOCK}
                    />
                  ))}
                  {RANGE.map((m) => (
                    <line
                      key={`dh${m}`}
                      x1={-2 * BLOCK}
                      y1={-AHEAD + m * BLOCK}
                      x2={2 * BLOCK}
                      y2={-AHEAD + m * BLOCK}
                    />
                  ))}
                </g>
              </g>
            </g>
          </g>
        </g>

        {/* The rider holds the centre, facing up; they lean into the turn a moment before the camera. */}
        <g transform={`translate(${CX} ${CY})`}>
          <g className="bl-lean">
            <g className="bl-bob">
              <ellipse cx="0" cy="24" rx="15" ry="6" fill="#0f172a" opacity="0.12" />
              {/* Handlebar with grips */}
              <rect x="-17" y="-24" width="34" height="3.5" rx="1.75" fill="var(--c-navy)" />
              <circle cx="-17" cy="-22.2" r="3" fill="var(--c-navy)" />
              <circle cx="17" cy="-22.2" r="3" fill="var(--c-navy)" />
              {/* Front wheel */}
              <rect x="-3" y="-34" width="6" height="11" rx="3" fill="var(--c-navy)" />
              {/* Arms and shoulders */}
              <path
                d="M-13 -21L-11 -6M13 -21L11 -6"
                stroke="var(--c-accent)"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
              <ellipse cx="0" cy="-4" rx="12" ry="9" fill="var(--c-accent)" />
              {/* Helmet */}
              <circle cx="0" cy="-8" r="7.5" fill="#fff" stroke="var(--c-navy)" strokeWidth="2" />
              {/* Delivery box */}
              <rect
                x="-9.5"
                y="6"
                width="19"
                height="17"
                rx="3"
                fill="#fff"
                stroke="var(--c-navy)"
                strokeWidth="2"
              />
              <path
                d="M-4 14.5h6m-2.5-3 3 3-3 3"
                stroke="var(--c-accent)"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </g>
        </g>
      </svg>

      {showText && (
        <div className="bl-text -mt-6 text-center">
          <p className="text-[26px] font-bold tracking-tight">
            <span className="text-ink">{APP_NAME.slice(0, split)}</span>
            <span className="text-accent">{APP_NAME.slice(split)}</span>
          </p>
          <p className="mx-auto mt-1 max-w-[16rem] text-sm text-ink-3">{t('common.tagline')}</p>
        </div>
      )}
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

// 5 s loop: 0–40% straight to the junction, 40–64% turn right (camera -90°), 64–100% straight on.
const CSS = `
.bl-root .bl-cam { transform-box: view-box; transform-origin: ${CX}px ${CY}px; animation: bl-cam 5s infinite; }
.bl-root .bl-move { animation: bl-move 5s infinite; }
.bl-root .bl-lean { animation: bl-lean 5s infinite; }
.bl-root .bl-bob { animation: bl-bob 0.6s ease-in-out infinite alternate; }
.bl-root .bl-fade { animation: bl-in 0.5s ease-out both; }
.bl-root .bl-text { animation: bl-in 0.6s ease-out 0.6s both; }
@keyframes bl-cam {
  0%, 38% { transform: rotate(0deg); animation-timing-function: ease-in-out; }
  64%, 100% { transform: rotate(-90deg); }
}
@keyframes bl-move {
  0% { transform: translate(0px, 0px); animation-timing-function: linear; }
  40% { transform: translate(0px, ${AHEAD}px); animation-timing-function: ease-in-out; }
  64% { transform: translate(-14px, ${AHEAD + 4}px); animation-timing-function: linear; }
  100% { transform: translate(${-(BLOCK - AHEAD)}px, ${AHEAD}px); }
}
@keyframes bl-lean {
  0%, 34% { transform: rotate(0deg); animation-timing-function: ease-out; }
  46% { transform: rotate(24deg); animation-timing-function: ease-in-out; }
  68%, 100% { transform: rotate(0deg); }
}
@keyframes bl-bob { from { transform: translateY(-0.6px); } to { transform: translateY(0.6px); } }
@keyframes bl-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .bl-root * { animation: none !important; }
}
`;
