import {
  CheckCircle2, XCircle, Loader2, Clock, PauseCircle, MinusCircle, Ban, ShieldAlert, AlertTriangle, CircleDashed,
} from 'lucide-react';
/** One mapping for every run and node status in the app. */
export const STATUS_META = {
  pending: { tone: 'neutral', icon: CircleDashed, label: 'Pending' },
  queued: { tone: 'neutral', icon: Clock, label: 'Queued' },
  running: { tone: 'info', icon: Loader2, label: 'Running', spin: true },
  waiting: { tone: 'warning', icon: PauseCircle, label: 'Waiting' },
  success: { tone: 'success', icon: CheckCircle2, label: 'Succeeded' },
  failed: { tone: 'danger', icon: XCircle, label: 'Failed' },
  cancelled: { tone: 'neutral', icon: Ban, label: 'Cancelled' },
  skipped: { tone: 'neutral', icon: MinusCircle, label: 'Skipped' },
  handled: { tone: 'warning', icon: ShieldAlert, label: 'Handled' },
  interrupted: { tone: 'danger', icon: AlertTriangle, label: 'Interrupted' },
};

