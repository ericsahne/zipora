import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { executeDeployment, type DeployEvent, type DeployResult } from '../engine';
import { useHistory } from '../hooks/useHistory';
import { toRecord } from '../services/history';
import type { ArchiveState, DeployConfig, Repo } from '../types';
import { useAuth } from './AuthContext';
import { usePrefs } from './PreferencesContext';

export interface RunState { phase: 'idle' | 'running' | 'done'; events: DeployEvent[]; result?: DeployResult; recordId?: string }

interface DraftApi {
  archive?: ArchiveState;
  setArchive: (a?: ArchiveState) => void;
  repo?: Repo;
  setRepo: (r?: Repo) => void;
  branch?: string;
  setBranch: (b?: string) => void;
  config: DeployConfig;
  setConfig: (patch: Partial<DeployConfig>) => void;
  run: RunState;
  startDeployment: () => Promise<void>;
  cancelDeployment: () => void;
  /** Clears the finished run so the same selection can be deployed again. */
  resetRun: () => void;
  /** Clears archive, repository, branch and run: a fresh deployment. */
  resetAll: () => void;
}

const Ctx = createContext<DraftApi | null>(null);
const IDLE: RunState = { phase: 'idle', events: [] };

/** Holds the in-progress deployment (archive, target, options) and runs it, so it survives page navigation. */
export function DraftProvider({ children }: { children: ReactNode }) {
  const { github } = useAuth();
  const { prefs } = usePrefs();
  const { store } = useHistory();
  const [archive, setArchive] = useState<ArchiveState>();
  const [repo, setRepoState] = useState<Repo>();
  const [branch, setBranch] = useState<string>();
  const [config, setConfigState] = useState<DeployConfig>(() => ({ targetDir: '', replaceExisting: prefs.replaceExisting, deleteMissing: prefs.deleteMissing, message: prefs.defaultCommitMessage }));
  const [run, setRun] = useState<RunState>(IDLE);
  const controller = useRef<AbortController | undefined>(undefined);
  const running = useRef(false);

  const setRepo = useCallback((r?: Repo) => {
    setRepoState((prev) => { if (prev?.id !== r?.id) setBranch(undefined); return r; });
  }, []);
  const setConfig = useCallback((patch: Partial<DeployConfig>) => setConfigState((c) => ({ ...c, ...patch })), []);

  const startDeployment = useCallback(async () => {
    if (running.current || !archive || !repo || !branch || archive.inspection.blocking) return;
    running.current = true;
    const ctl = new AbortController();
    controller.current = ctl;
    setRun({ phase: 'running', events: [] });
    const started = Date.now();
    const options = { targetDir: config.targetDir, replaceExisting: config.replaceExisting, deleteMissing: config.deleteMissing, message: config.message.trim() };
    try {
      const result = await executeDeployment({
        client: github,
        target: { owner: repo.owner, repo: repo.name, branch },
        files: archive.inspection.files,
        options,
        signal: ctl.signal,
        onEvent: (e) => setRun((r) => ({ ...r, events: [...r.events.slice(-999), e] })),
      });
      const record = toRecord(result, {
        createdAt: new Date(started).toISOString(), durationMs: Date.now() - started, owner: repo.owner, repo: repo.name, branch,
        targetDir: options.targetDir, message: options.message, archiveName: archive.name, fileCount: archive.inspection.files.length,
      });
      store?.add(record);
      setRun((r) => ({ ...r, phase: 'done', result, recordId: record.id }));
    } finally {
      running.current = false;
    }
  }, [archive, repo, branch, config, github, store]);

  const cancelDeployment = useCallback(() => controller.current?.abort(), []);
  const resetRun = useCallback(() => setRun(IDLE), []);
  const resetAll = useCallback(() => { setArchive(undefined); setRepoState(undefined); setBranch(undefined); setRun(IDLE); }, []);

  useEffect(() => {
    if (run.phase !== 'running') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [run.phase]);

  const value = useMemo<DraftApi>(() => ({ archive, setArchive, repo, setRepo, branch, setBranch, config, setConfig, run, startDeployment, cancelDeployment, resetRun, resetAll }),
    [archive, repo, setRepo, branch, config, setConfig, run, startDeployment, cancelDeployment, resetRun, resetAll]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDraft(): DraftApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDraft must be used inside <DraftProvider>');
  return v;
}
