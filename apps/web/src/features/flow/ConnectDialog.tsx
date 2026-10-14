/**
 * ノード間に線を引いたときの手法の候補（6章）。組み合わせに合う手法と、足せる既存のルールだけを出す。
 */
import { applyDrag, dragOptions, type CreatedRule, type DragTarget, type ObjRef } from '@alloc-sim/engine';
import { alertDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ja } from '@/i18n/ja';
import { useProjectStore } from '@/store/project';
import { useUiStore } from '@/store/ui';
import { METHOD_COLOR } from './style';

export interface PendingConnection {
  sender: ObjRef;
  receiver: ObjRef;
  senderLabel: string;
  receiverLabel: string;
}

const optionLabel = (t: DragTarget): string => {
  switch (t.kind) {
    case 'NEW':
      return ja.flow.newRule(ja.method[t.method]);
    case 'ADD_TO_SEGMENT':
      return ja.flow.addToSegment(t.label);
    case 'ADD_TO_SETTLEMENT':
      return ja.flow.addToSettlement(t.ruleId);
    case 'ADD_TO_COSTING':
      return ja.flow.addToCosting(t.sheetId);
  }
};

export function ConnectDialog({ pending, onClose }: { pending: PendingConnection | null; onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const scenarioId = useProjectStore((s) => s.scenarioId);
  const setUi = useUiStore((s) => s.set);
  const options = pending ? dragOptions(project, scenarioId, pending.sender, pending.receiver) : [];

  const choose = async (target: DragTarget) => {
    if (!pending) return;
    onClose();
    let created: CreatedRule | undefined;
    try {
      useProjectStore.getState().edit((p) => {
        created = applyDrag(p, scenarioId, pending.sender, pending.receiver, target, { stepName: (m) => ja.method[m] });
      });
    } catch (e) {
      await alertDialog(ja.flow.createError, [e instanceof Error ? e.message : String(e)]);
      return;
    }
    if (created) setUi({ selectedRule: created.id, editingRule: created });
  };

  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && onClose()}>
      {pending && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-6">{ja.flow.connectTitle(pending.senderLabel, pending.receiverLabel)}</DialogTitle>
          </DialogHeader>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ja.flow.noMethod}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {options.map((o, i) => (
                <Button key={i} variant="outline" className="justify-start" onClick={() => void choose(o)}>
                  <span className="size-3 rounded-sm" style={{ background: METHOD_COLOR[o.method] }} />
                  {optionLabel(o)}
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
