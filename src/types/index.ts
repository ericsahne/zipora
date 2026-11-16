import type { DeployEvent, DeployResult, ZipInspection } from '../engine';

export interface Repo {
  id: number;
  name: string;
  owner: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  htmlUrl: string;
  /** False only when GitHub says the user lacks push access. */
  canPush: boolean;
  archived: boolean;
  fork: boolean;
  updatedAt: string;
}

export interface Branch { name: string; sha: string; protected: boolean }

export type ThemePreference = 'dark' | 'light' | 'system';

export interface Preferences {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
  defaultCommitMessage: string;
  replaceExisting: boolean;
  deleteMissing: boolean;
  clearHistoryOnSignOut: boolean;
}

export interface DeployConfig {
  targetDir: string;
  replaceExisting: boolean;
  deleteMissing: boolean;
  message: string;
}

export interface ArchiveState { name: string; size: number; inspection: ZipInspection }

export interface HistoryRecord {
  id: string;
  createdAt: string;
  durationMs: number;
  status: DeployResult['status'];
  owner: string;
  repo: string;
  branch: string;
  targetDir: string;
  message: string;
  archiveName: string;
  fileCount: number;
  counts: DeployResult['counts'];
  commitSha?: string;
  commitUrl?: string;
  error?: { code: string; message: string; hint?: string };
  logs: DeployEvent[];
}
