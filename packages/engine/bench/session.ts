import { largeProject } from './large.ts';
import { SimSession } from '../src/session.ts';

const p = largeProject();
const sid = p.scenarios[0]!.id;
const time = <T>(label: string, f: () => T): T => {
  const t0 = performance.now();
  const r = f();
  console.log(`${label}: ${(performance.now() - t0).toFixed(0)}ms`);
  return r;
};
new SimSession(p, sid); // warm up
const s = time('SimSession（runAll）', () => new SimSession(p, sid));
time('summary', () => s.summary());
const last = s.result.stepOrder.at(-1)!;
time('stepView', () => s.stepView(last));
const g = time('flowGraph', () => s.flowGraph(last));
console.log(`flowGraph nodes=${g.nodes.length} edges=${g.edges.length}`);
for (const m of ['CCTR_ALLOC', 'MA', 'SETTLEMENT', 'TDD'] as const) {
  const v = time(`methodView ${m}`, () => s.methodView(m, last));
  console.log(`  left=${v.left.length} right=${v.right.length} edges=${v.edges.length}`);
}
const sk = time('sankey', () => s.sankey());
console.log(`sankey nodes=${sk.nodes.length} links=${sk.links.length} omitted=${sk.omitted}`);
time('composition SOURCE', () => s.composition(last, 'SOURCE'));
const co = time('composition ORIGIN', () => s.composition(last, 'ORIGIN'));
console.log(`composition rows=${co.rows.length}`);
