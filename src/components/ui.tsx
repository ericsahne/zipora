import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, type LucideIcon } from 'lucide-react';
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { describeError } from '../services/errors';

export const cx = (...a: Array<string | false | null | undefined>): string => a.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50',
  secondary: 'border border-border bg-secondary text-fg hover:border-accent disabled:opacity-50',
  ghost: 'text-muted hover:bg-secondary hover:text-fg disabled:opacity-50',
  danger: 'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-50',
};
const SIZE: Record<Size, string> = { sm: 'h-11 px-3 text-sm md:h-10', md: 'h-11 px-4 text-sm', lg: 'h-12 px-6 text-base' };

/** Class string so router <Link>s and <a>s can look like buttons. Min 36px high; 40px+ on md/lg for touch. */
export const buttonClass = (variant: Variant = 'secondary', size: Size = 'md', extra?: string): string =>
  cx('inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed', VARIANT[variant], SIZE[size], extra);

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return <section {...rest} className={cx('min-w-0 rounded-xl border border-border bg-card', className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
      <div className="min-w-0"><h2 className="text-base font-semibold">{title}</h2>{description && <p className="mt-0.5 text-sm text-muted">{description}</p>}</div>
      {action}
    </div>
  );
}

const TONES = {
  neutral: 'bg-secondary text-muted', success: 'bg-success/15 text-success', danger: 'bg-danger/15 text-danger',
  warn: 'bg-warn/15 text-warn', accent: 'bg-accent/15 text-accent-fg',
} as const;
export type Tone = keyof typeof TONES;
export function Badge({ tone = 'neutral', icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium', TONES[tone])}>{Icon && <Icon className="h-3 w-3" aria-hidden />}{children}</span>;
}

const ALERT: Record<'info' | 'success' | 'warn' | 'danger', { cls: string; Icon: LucideIcon }> = {
  info: { cls: 'border-accent/40 bg-accent/10', Icon: Info },
  success: { cls: 'border-success/40 bg-success/10', Icon: CheckCircle2 },
  warn: { cls: 'border-warn/40 bg-warn/10', Icon: AlertTriangle },
  danger: { cls: 'border-danger/40 bg-danger/10', Icon: XCircle },
};
export function Alert({ tone = 'info', title, children, action }: { tone?: keyof typeof ALERT; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const { cls, Icon } = ALERT[tone];
  return (
    <div role={tone === 'danger' || tone === 'warn' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-lg border p-4 text-sm', cls)}>
      <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : tone === 'warn' ? 'text-warn' : 'text-accent-fg')} aria-hidden />
      <div className="min-w-0 flex-1">{title && <p className="font-medium">{title}</p>}{children && <div className={cx('break-words text-muted', !!title && 'mt-1')}>{children}</div>}</div>
      {action}
    </div>
  );
}

export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const d = describeError(error);
  return (
    <Alert tone="danger" title={d.title} action={onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}>
      <p>{d.message}</p>{d.hint && <p className="mt-1">{d.hint}</p>}{d.code && <p className="mt-1 font-mono text-xs">{d.code}</p>}
    </Alert>
  );
}

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <span role="status" className="inline-flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{label}…</span>
);

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-secondary text-muted"><Icon className="h-5 w-5" aria-hidden /></span>
      <h3 className="font-medium">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const inputClass = 'h-11 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-fg placeholder:text-muted disabled:opacity-60';

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string, describedBy: string | undefined) => ReactNode }) {
  const id = useId();
  const desc = error || hint ? `${id}-d` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      {children(id, desc)}
      {(error || hint) && <p id={desc} className={cx('mt-1.5 text-xs', error ? 'text-danger' : 'text-muted')}>{error || hint}</p>}
    </div>
  );
}

export function Stat({ label, value, caption }: { label: string; value: ReactNode; caption?: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-sm text-muted">{label}</p>
      <p data-stat-value className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">{value}</p>
      {caption && <p className="mt-1 text-xs text-muted">{caption}</p>}
    </Card>
  );
}

export const PageHeader = ({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-1 text-sm text-muted">{description}</p>}</div>
    {action}
  </div>
);
