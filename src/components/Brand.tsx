import { cx } from './ui';

/** Zipper-tooth "Z": two rails joined by a diagonal of interlocking teeth. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx('h-8 w-8', className)} role="img" aria-label="ZIPORA">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 9.5h14M9 22.5h14" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M22 10.5 10 21.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="1.6 3.2" />
    </svg>
  );
}

export const Logo = ({ className }: { className?: string }) => (
  <span className={cx('inline-flex items-center gap-2.5', className)}>
    <LogoMark />
    <span className="text-lg font-semibold tracking-[0.14em]">ZIPORA</span>
  </span>
);

/** GitHub mark (lucide dropped brand icons). */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx('h-5 w-5', className)} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const AVATAR_HOST = 'https://avatars.githubusercontent.com/';

/** Only GitHub's avatar host is ever used as an image source; anything else falls back to initials. */
export function Avatar({ src, login, size = 32 }: { src?: string; login: string; size?: number }) {
  const ok = !!src && src.startsWith(AVATAR_HOST);
  return ok ? (
    <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full bg-secondary" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-accent/20 text-xs font-semibold uppercase text-accent-fg" style={{ width: size, height: size }}>{login.slice(0, 2)}</span>
  );
}
