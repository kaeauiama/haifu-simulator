/**
 * 締めステップ（F4-01〜F4-03）と、1ステップずつの実行（F5-02）。
 * エンジンは常に全ステップを計算し、ここで選んだ時点の残高を画面に出す。戻るのは時点を選び直すだけ。
 */
import { PRIMARY_STEP_ID, type ClosingStep, type Project, type Scenario, type StepKind, type StepRow } from '@alloc-sim/engine';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from 'cn';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, GripVertical, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { TextCell } from '@/components/cells';
import { confirmDialog } from '@/components/dialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ja } from '@/i18n/ja';
import { useProjectStore, useScenario } from '@/store/project';
import { useCursorStepId, useRunStore } from '@/store/run';
import { addStep, applyTemplate, moveStep, removeStep, toggleStep } from '@/store/scenarioOps';
import { useUiStore } from '@/store/ui';

const KINDS: StepKind[] = ['ACTIVITY_ALLOC', 'OVERHEAD_CALC', 'SETTLEMENT', 'ALLOC_CYCLE', 'ACTUAL_RATE_REVAL', 'TDD'];

export function StepPanel() {
  const scenario = useScenario();
  const editScenario = useProjectStore((s) => s.editScenario);
  const summary = useRunStore((s) => s.summary);
  const cursorId = useCursorStepId();
  const setUi = useUiStore((s) => s.set);
  const selectedStepId = useUiStore((s) => s.selectedStepId);

  const order = [PRIMARY_STEP_ID, ...scenario.steps.map((s) => s.id)];
  const cursorIndex = Math.max(0, order.indexOf(cursorId));
  const rowOf = new Map((summary?.steps ?? []).map((r) => [r.id, r]));
  const goTo = (i: number) => {
    const id = order[Math.min(order.length - 1, Math.max(0, i))]!;
    setUi({ cursor: id, selectedStepId: id === PRIMARY_STEP_ID ? null : id });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = scenario.steps.findIndex((s) => s.id === e.active.id);
    const to = scenario.steps.findIndex((s) => s.id === e.over!.id);
    editScenario((s) => moveStep(s, from, to));
  };

  const selected = scenario.steps.find((s) => s.id === selectedStepId);

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{ja.steps.heading}</h2>
        <div className="flex gap-0.5">
          <Button size="icon-sm" variant="ghost" title={ja.steps.toStart} aria-label={ja.steps.toStart} onClick={() => goTo(0)}>
            <ChevronFirst />
          </Button>
          <Button size="icon-sm" variant="ghost" title={ja.steps.back} aria-label={ja.steps.back} onClick={() => goTo(cursorIndex - 1)}>
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" variant="ghost" title={ja.steps.forward} aria-label={ja.steps.forward} onClick={() => goTo(cursorIndex + 1)}>
            <ChevronRight />
          </Button>
          <Button size="icon-sm" variant="ghost" title={ja.steps.toEnd} aria-label={ja.steps.toEnd} onClick={() => goTo(order.length - 1)}>
            <ChevronLast />
          </Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        <TextCell value={scenario.name} commit={(v) => editScenario((s) => void (s.name = v || s.name))} className="text-sm font-medium text-foreground" />
      </div>

      <ol className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        <StepItemShell
          index={0}
          active={cursorIndex === 0}
          future={false}
          onClick={() => goTo(0)}
          title={ja.steps.primary}
          row={rowOf.get(PRIMARY_STEP_ID)}
        />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={scenario.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {scenario.steps.map((st, i) => (
              <SortableStep
                key={st.id}
                step={st}
                index={i + 1}
                row={rowOf.get(st.id)}
                active={cursorIndex === i + 1}
                future={i + 1 > cursorIndex}
                selected={selectedStepId === st.id}
                onClick={() => setUi({ cursor: st.id, selectedStepId: st.id })}
                onToggle={() => editScenario((s) => toggleStep(s, st.id))}
              />
            ))}
          </SortableContext>
        </DndContext>
      </ol>

      <div className="flex flex-wrap gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus />
              {ja.steps.add}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {KINDS.map((k) => (
              <DropdownMenuItem
                key={k}
                onSelect={() => {
                  let id = '';
                  editScenario((s) => {
                    id = addStep(s, k, ja.steps.newStepName(ja.stepKind[k]));
                  });
                  setUi({ selectedStepId: id, cursor: id });
                }}
              >
                {ja.stepKind[k]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (await confirmDialog(ja.steps.confirmTemplate)) editScenario((s) => applyTemplate(s));
          }}
        >
          <LayoutTemplate />
          {ja.steps.applyTemplate}
        </Button>
      </div>

      {selected && <StepDetail step={selected} />}
    </section>
  );
}

function IssueBadges({ row }: { row: StepRow | undefined }) {
  if (!row) return null;
  const { ERROR, WARNING } = row.issueCounts;
  return (
    <span className="flex gap-0.5">
      {ERROR > 0 && <Badge variant="destructive">{`${ja.severity.ERROR}${ERROR}`}</Badge>}
      {WARNING > 0 && <Badge className="bg-amber-100 text-amber-900">{`${ja.severity.WARNING}${WARNING}`}</Badge>}
    </span>
  );
}

function StepItemShell({ index, active, future, onClick, title, row }: { index: number; active: boolean; future: boolean; onClick: () => void; title: string; row: StepRow | undefined }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn('flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm', active ? 'border-primary bg-primary/5' : 'hover:bg-muted', future && 'opacity-50')}
      >
        <span className="w-5 text-right tabular-nums text-muted-foreground">{index}</span>
        <span className="flex-1">{title}</span>
        <IssueBadges row={row} />
        <span className="text-xs text-muted-foreground">{row ? ja.steps.lines(row.lineCount) : ''}</span>
      </button>
    </li>
  );
}

function SortableStep(props: {
  step: ClosingStep;
  index: number;
  row: StepRow | undefined;
  active: boolean;
  future: boolean;
  selected: boolean;
  onClick: () => void;
  onToggle: () => void;
}) {
  const { step, index, row, active, future, selected, onClick, onToggle } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'relative z-10')}>
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 text-sm',
          active ? 'border-primary bg-primary/5' : selected ? 'border-ring' : 'hover:bg-muted',
          isDragging && 'shadow-lg',
          !step.enabled && 'border-dashed',
        )}
      >
        <button type="button" className="cursor-grab touch-none text-muted-foreground" aria-label={ja.steps.drag} title={ja.steps.drag} {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
        <Checkbox checked={step.enabled} onCheckedChange={onToggle} aria-label={ja.steps.toggle} title={step.enabled ? ja.steps.enabled : ja.steps.disabled} />
        <button type="button" onClick={onClick} className={cn('flex min-w-0 flex-1 items-center gap-2 text-left', future && 'opacity-50')}>
          <span className="w-5 text-right tabular-nums text-muted-foreground">{index}</span>
          <span className={cn('min-w-0 flex-1 truncate', !step.enabled && 'line-through')} title={step.name}>
            {step.name}
          </span>
          <IssueBadges row={row} />
          <span className="text-xs whitespace-nowrap text-muted-foreground">{future ? ja.steps.notYet : row ? ja.steps.lines(row.lineCount) : ''}</span>
        </button>
      </div>
    </li>
  );
}

/** ステップの種類ごとに、割り当てられるジョブの一覧 */
function jobsOf(kind: StepKind, s: Scenario, p: Project): { id: string; label: string }[] {
  switch (kind) {
    case 'ALLOC_CYCLE':
      return s.cycles.map((c) => ({ id: c.id, label: `${c.id} ${c.name}` }));
    case 'TDD':
      return s.tddRules.map((r) => ({ id: r.id, label: `${r.id} ${r.name}` }));
    case 'SETTLEMENT':
      return s.settlementRules.map((r) => ({ id: r.id, label: `${r.id}（${r.sender.id}）` }));
    case 'ACTIVITY_ALLOC':
      return s.activityAllocs.map((a) => ({ id: a.id, label: `${a.id}（${a.senderCctr} → ${a.receiver.id}、${a.quantity}）` }));
    case 'OVERHEAD_CALC':
      return s.costingSheets.map((c) => ({ id: c.id, label: `${c.id}（${c.targets.map((t) => t.id).join('、')}）` }));
    case 'ACTUAL_RATE_REVAL':
      return p.master.activityTypes.map((a) => ({ id: a.id, label: `${a.id} ${a.name}` }));
    case 'MANUAL_REPOST':
      return [];
  }
}

function StepDetail({ step }: { step: ClosingStep }) {
  const editScenario = useProjectStore((s) => s.editScenario);
  const scenario = useScenario();
  const project = useProjectStore((s) => s.project);
  const setUi = useUiStore((s) => s.set);
  const jobs = jobsOf(step.kind, scenario, project);
  const edit = (recipe: (st: ClosingStep) => void) =>
    editScenario((s) => {
      const st = s.steps.find((x) => x.id === step.id);
      if (st) recipe(st);
    });

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{ja.steps.detail}</span>
        <Badge variant="outline">{ja.stepKind[step.kind]}</Badge>
      </div>
      <label className="block">
        <span className="text-xs text-muted-foreground">{ja.steps.name}</span>
        <TextCell value={step.name} commit={(v) => edit((st) => void (st.name = v || st.name))} className="border-border bg-background" />
      </label>
      <div>
        <span className="text-xs text-muted-foreground">{ja.steps.jobs}</span>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{ja.steps.noJobs}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {jobs.map((j) => (
              <li key={j.id}>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={step.itemIds.includes(j.id)}
                    onCheckedChange={(c) =>
                      edit((st) => {
                        st.itemIds = c === true ? [...st.itemIds.filter((x) => x !== j.id), j.id] : st.itemIds.filter((x) => x !== j.id);
                      })
                    }
                  />
                  <span>{j.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button
        size="sm"
        variant="destructive"
        onClick={async () => {
          if (!(await confirmDialog(ja.steps.confirmRemove(step.name)))) return;
          editScenario((s) => removeStep(s, step.id));
          setUi({ selectedStepId: null, cursor: null });
        }}
      >
        <Trash2 />
        {ja.steps.remove}
      </Button>
    </div>
  );
}
