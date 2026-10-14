/**
 * 確認とお知らせのダイアログ。await confirmDialog(...) で使える。
 */
import { create } from 'zustand';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ja } from '@/i18n/ja';

interface Pending {
  kind: 'confirm' | 'alert';
  title: string;
  lines: string[];
  resolve: (ok: boolean) => void;
}

const useDialogStore = create<{ pending: Pending | null }>(() => ({ pending: null }));

function open(kind: Pending['kind'], title: string, lines: string[]): Promise<boolean> {
  return new Promise((resolve) => useDialogStore.setState({ pending: { kind, title, lines, resolve } }));
}

export const confirmDialog = (title: string, lines: string[] = []) => open('confirm', title, lines);
export const alertDialog = (title: string, lines: string[] = []) => open('alert', title, lines).then(() => undefined);

export function DialogHost() {
  const pending = useDialogStore((s) => s.pending);
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    useDialogStore.setState({ pending: null });
  };
  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && close(false)}>
      {pending && (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{pending.title}</DialogTitle>
            {pending.lines.length > 0 && (
              <DialogDescription asChild>
                <ul className="max-h-80 list-disc space-y-1 overflow-auto pl-5">
                  {pending.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            {pending.kind === 'confirm' && (
              <Button variant="outline" onClick={() => close(false)}>
                {ja.dialog.cancel}
              </Button>
            )}
            <Button onClick={() => close(true)} autoFocus>
              {ja.dialog.ok}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
