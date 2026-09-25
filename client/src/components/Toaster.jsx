import { Toaster as Sonner } from 'sonner';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useThemeStore } from '../store/themeStore';

/** Toast host (sonner), themed with the design tokens. Mounted once at the root. */
export default function Toaster() {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Sonner
      theme={theme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      visibleToasts={5}
      gap={8}
      icons={{
        success: <CheckCircle2 className="h-4 w-4 text-success" />,
        error: <XCircle className="h-4 w-4 text-danger" />,
        warning: <AlertTriangle className="h-4 w-4 text-warning" />,
        info: <Info className="h-4 w-4 text-info" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-card border border-default bg-surface-raised px-3.5 py-3 text-sm text-fg shadow-popover',
          title: 'leading-snug',
          description: 'text-xs text-muted',
          icon: 'mt-0.5 shrink-0',
          actionButton: 'ml-auto shrink-0 text-xs font-semibold text-accent hover:underline',
          closeButton: 'text-subtle',
        },
      }}
    />
  );
}
