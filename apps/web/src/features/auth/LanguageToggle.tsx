import { useTranslation } from 'react-i18next';
import { cn } from '../../ui/index.ts';

export function LanguageToggle({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const options = [
    { value: 'en', label: 'EN' },
    { value: 'am', label: 'አማ' },
  ];
  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={cn('flex rounded-full bg-surface-2 p-0.5', className)}
    >
      {options.map((o) => {
        const active = i18n.language === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => void i18n.changeLanguage(o.value)}
            className={cn(
              'h-8 min-w-11 rounded-full px-3 text-sm font-semibold transition-all duration-[var(--dur-fast)]',
              active ? 'bg-surface text-ink shadow-[var(--shadow-sm)]' : 'text-ink-3 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
