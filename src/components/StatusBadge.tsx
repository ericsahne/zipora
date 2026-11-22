import { CheckCircle2, MinusCircle, Slash, XCircle } from 'lucide-react';
import type { DeployResult } from '../engine';
import { Badge } from './ui';

export function StatusBadge({ status }: { status: DeployResult['status'] }) {
  switch (status) {
    case 'success': return <Badge tone="success" icon={CheckCircle2}>Deployed</Badge>;
    case 'no-changes': return <Badge tone="accent" icon={MinusCircle}>No changes</Badge>;
    case 'cancelled': return <Badge tone="warn" icon={Slash}>Cancelled</Badge>;
    default: return <Badge tone="danger" icon={XCircle}>Failed</Badge>;
  }
}
