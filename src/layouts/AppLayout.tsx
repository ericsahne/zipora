import { BookOpen, ChevronDown, History, LayoutDashboard, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Rocket, Settings, Sun, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Avatar, Logo, LogoMark } from '../components/Brand';
import { cx } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { usePrefs } from '../contexts/PreferencesContext';
import { useSignOut } from '../hooks/useSignOut';

const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/new', label: 'New deployment', icon: Rocket },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/docs', label: 'Documentation', icon: BookOpen },
];

function SideNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} onClick={onNavigate} title={collapsed ? label : undefined}
          className={({ isActive }) => cx('flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors', isActive ? 'bg-accent/15 text-accent-fg' : 'text-muted hover:bg-secondary hover:text-fg', collapsed && 'justify-center px-0')}>
          <Icon className="h-5 w-5 shrink-0" aria-hidden />
          <span className={cx(collapsed && 'sr-only')}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Thumb-reach navigation for phones. The drawer (menu button) still holds documentation and account actions. */
const BOTTOM: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/new', label: 'Deploy', icon: Rocket },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];
function BottomNav() {
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {BOTTOM.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => cx('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors', isActive ? 'text-accent-fg' : 'text-muted active:text-fg')}>
          <Icon className="h-5 w-5" aria-hidden /><span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function ThemeToggle() {
  const { prefs, setPrefs, resolvedTheme } = usePrefs();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" onClick={() => setPrefs({ theme: next })} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}
      className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-secondary hover:text-fg" data-theme-pref={prefs.theme}>
      {resolvedTheme === 'dark' ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
    </button>
  );
}

function UserMenu() {
  const { user } = useAuth();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-11 items-center gap-2 rounded-lg pl-1 pr-2 hover:bg-secondary">
        <Avatar src={user.avatarUrl} login={user.login} />
        <span className="sr-only">Account menu, {user.login}</span>
        <span aria-hidden className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">{user.login}</span>
        <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-border bg-card p-1.5 shadow-xl">
          <div className="border-b border-border px-3 py-2"><p className="truncate text-sm font-medium">{user.name ?? user.login}</p><p className="truncate text-xs text-muted">@{user.login}</p></div>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className="mt-1 flex h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-secondary"><Settings className="h-4 w-4" aria-hidden />Settings</Link>
          <button role="menuitem" type="button" onClick={() => void signOut()} className="flex h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-danger hover:bg-danger/10"><LogOut className="h-4 w-4" aria-hidden />Sign out</button>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { prefs, setPrefs } = usePrefs();
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(drawerRef, drawer);
  const { pathname } = useLocation();
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [drawer]);

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">Skip to content</a>
      <aside className={cx('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card transition-[width] md:flex', prefs.sidebarCollapsed ? 'w-[68px]' : 'w-60')}>
        <Link to="/dashboard" className={cx('flex h-14 items-center border-b border-border', prefs.sidebarCollapsed ? 'justify-center' : 'px-4')} aria-label="ZIPORA dashboard">{prefs.sidebarCollapsed ? <LogoMark /> : <Logo />}</Link>
        <SideNav collapsed={prefs.sidebarCollapsed} />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <aside ref={drawerRef} role="dialog" aria-modal="true" aria-label="Navigation" className="absolute left-0 top-0 h-full w-72 max-w-[85vw] border-r border-border bg-card pt-[env(safe-area-inset-top)]">
            <div className="flex h-14 items-center justify-between border-b border-border px-4"><Logo /><button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-secondary"><X className="h-5 w-5" aria-hidden /></button></div>
            <SideNav onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-bg/90 px-2 pt-[env(safe-area-inset-top)] backdrop-blur md:px-4">
          <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-secondary md:hidden"><Menu className="h-5 w-5" aria-hidden /></button>
          <Link to="/dashboard" className="tap ml-1 md:hidden" aria-label="ZIPORA dashboard"><LogoMark /></Link>
          <button type="button" aria-label={prefs.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })} className="hidden h-11 w-11 place-items-center rounded-lg text-muted hover:bg-secondary md:grid">
            {prefs.sidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />}
          </button>
          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu />
        </header>
        <main id="main" className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-5 pb-24 md:px-8 md:py-8 md:pb-8"><div key={pathname} className="page-enter"><Outlet /></div></main>
        <BottomNav />
      </div>
    </div>
  );
}
