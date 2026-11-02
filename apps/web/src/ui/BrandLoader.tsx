import { useTranslation } from 'react-i18next';
import { APP_NAME } from '../lib/brand.ts';
import { BRAND_LOADER_CSS, brandLoaderSvg, splitName } from './brandLoaderMarkup.ts';
import { cn } from './cn.ts';

// Built once: the markup is static (no user input), shared with the index.html splash.
const SVG = brandLoaderSvg('bl-app');

/**
 * Loading animation: a rider seen from above rides straight, turns right at a junction, and the
 * camera rotates to follow, like turn-by-turn navigation. The same picture is inlined in
 * index.html, so the splash and this loader are one continuous animation.
 */
export function BrandLoader({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  const { t } = useTranslation();
  const [a, b] = splitName(APP_NAME);
  return (
    <div className={cn('bl-root', className)} role="status" aria-live="polite">
      <style>{BRAND_LOADER_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: SVG }} />
      {showText && (
        <div className="bl-text">
          <p className="text-[26px] font-bold tracking-tight">
            <span className="text-ink">{a}</span>
            <span className="text-accent">{b}</span>
          </p>
          <p className="mx-auto mt-1 max-w-[16rem] text-sm text-ink-3">{t('common.tagline')}</p>
        </div>
      )}
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}
