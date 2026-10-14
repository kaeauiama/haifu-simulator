/**
 * 中央の図。全体のフロー図と、手法ごとの関係ビューを切り替える。
 */
import { VIEW_METHODS } from '@alloc-sim/engine';
import { cn } from 'cn';
import { ja } from '@/i18n/ja';
import { useUiStore, type FlowLayout, type FlowViewKind } from '@/store/ui';
import { FlowView } from './FlowView';
import { MethodView } from './MethodView';

const VIEWS: FlowViewKind[] = ['ALL', ...VIEW_METHODS];
const LAYOUTS: FlowLayout[] = ['auto', 'columns'];

export function FlowPanel() {
  const view = useUiStore((s) => s.flowView);
  const layout = useUiStore((s) => s.flowLayout);
  const setUi = useUiStore((s) => s.set);
  const seg = (active: boolean) => cn('rounded-md px-2 py-0.5 text-sm whitespace-nowrap', active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
        {VIEWS.map((v) => (
          <button key={v} type="button" className={seg(view === v)} onClick={() => setUi({ flowView: v })}>
            {ja.view[v]}
          </button>
        ))}
        {view === 'ALL' && (
          <div className="ml-auto flex gap-1 rounded-md border p-0.5">
            {LAYOUTS.map((l) => (
              <button key={l} type="button" className={seg(layout === l)} onClick={() => setUi({ flowLayout: l })}>
                {ja.layout[l]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">{view === 'ALL' ? <FlowView /> : <MethodView />}</div>
    </div>
  );
}
