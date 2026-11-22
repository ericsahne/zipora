import { useMemo } from 'react';
import type { DeployConfig } from '../types';
import { validateConfig } from '../utils/config';
import { Alert, Field, inputClass } from './ui';

export function DeployConfigForm({ config, onChange, disabled }: { config: DeployConfig; onChange: (patch: Partial<DeployConfig>) => void; disabled?: boolean }) {
  const problems = useMemo(() => validateConfig(config), [config]);
  return (
    <div className="space-y-4">
      <Field label="Target directory" hint="Folder inside the repository. Leave empty for the repository root." error={problems.targetDir}>
        {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!problems.targetDir} disabled={disabled} value={config.targetDir} onChange={(e) => onChange({ targetDir: e.target.value })} placeholder="e.g. docs or apps/site" spellCheck={false} autoCapitalize="off" className={`${inputClass} font-mono`} />}
      </Field>
      <Field label="Commit message" error={problems.message}>
        {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!problems.message} disabled={disabled} value={config.message} onChange={(e) => onChange({ message: e.target.value })} className={inputClass} />}
      </Field>
      <div className="space-y-3">
        <label className="flex min-h-10 items-start gap-3 text-sm">
          <input type="checkbox" disabled={disabled} checked={config.replaceExisting} onChange={(e) => onChange({ replaceExisting: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
          <span><span className="font-medium">Replace existing files</span><span className="block text-muted">Overwrite files that already exist with different content. When off, they are left untouched and listed as skipped.</span></span>
        </label>
        <label className="flex min-h-10 items-start gap-3 text-sm">
          <input type="checkbox" disabled={disabled} checked={config.deleteMissing} onChange={(e) => onChange({ deleteMissing: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
          <span><span className="font-medium">Delete files that are not in the archive</span><span className="block text-muted">Only inside the target directory. Off by default.</span></span>
        </label>
        {config.deleteMissing && <Alert tone="warn" title="Deletions are included in the commit">Every file under {config.targetDir.trim() ? <code>{config.targetDir.trim()}</code> : 'the repository root'} that is not in this archive will be removed. Use “Preview changes” to see exactly what.</Alert>}
      </div>
    </div>
  );
}
