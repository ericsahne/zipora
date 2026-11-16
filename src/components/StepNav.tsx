import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cx } from './ui';

const STEPS = [{ to: '/new', label: 'ZIP archive' }, { to: '/new/repository', label: 'Repository' }, { to: '/new/workspace', label: 'Deploy' }];

/** Compact on phones (only the current step is labelled), fully labelled from the sm breakpoint up. */
export function StepNav({ current, reached }: { current: 0 | 1 | 2; reached: number }) {
  return (
    <ol aria-label="Deployment steps" className="mb-5 flex items-center text-sm">
      {STEPS.map((s, i) => {
        const isCurrent = i === current;
        const circle = (
          <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold', i < current ? 'bg-success text-bg' : isCurrent ? 'bg-accent text-on-accent' : 'bg-secondary text-muted')}>
            {i < current ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
          </span>
        );
        const label = <span className={cx(!isCurrent && 'sr-only sm:not-sr-only')}>{s.label}</span>;
        const cls = 'tap gap-2 rounded-lg px-1.5';
        return (
          <li key={s.to} className="flex items-center">
            {i > 0 && <span aria-hidden className="mx-1 h-px w-5 bg-border sm:w-8" />}
            {i <= reached && !isCurrent
              ? <Link to={s.to} className={cx(cls, 'hover:bg-secondary')}>{circle}{label}</Link>
              : <span aria-current={isCurrent ? 'step' : undefined} className={cx(cls, !isCurrent && 'text-muted')}>{circle}{label}</span>}
          </li>
        );
      })}
    </ol>
  );
}
