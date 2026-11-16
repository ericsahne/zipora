import { normalizeTargetDir } from '../engine';
import type { DeployConfig } from '../types';

export interface ConfigProblems { targetDir?: string; message?: string }

export function validateConfig(c: DeployConfig): ConfigProblems {
  const p: ConfigProblems = {};
  try { normalizeTargetDir(c.targetDir); } catch (e) { p.targetDir = e instanceof Error ? e.message : 'Invalid target directory.'; }
  const m = c.message.trim();
  if (!m) p.message = 'Enter a commit message.';
  else if (m.length > 500) p.message = 'Use 500 characters or fewer.';
  return p;
}
