// 大きい規模のデータをプロジェクト JSON に書き出す（画面の性能確認用）。pnpm --filter @alloc-sim/engine exec tsx bench/dump-large.ts <出力先>
import { writeFileSync } from 'node:fs';
import { serializeProject } from '../src/io/project.ts';
import { largeProject } from './large.ts';

const out = process.argv[2];
if (!out) throw new Error('出力先を指定してください');
writeFileSync(out, serializeProject(largeProject()), 'utf8');
console.log(`書き出しました：${out}`);
