/**
 * 同梱のサンプル（F2-03）。CLI の --sample と入出力画面は、この一覧から選ぶ。
 */
import type { Project } from '../model/types.ts';
import { consultingProject } from './consulting.ts';
import { railwayProject } from './railway.ts';
import { sampleProject } from './sampleCompany.ts';
import { utilityProject } from './utility.ts';

export const SAMPLE_PROJECTS = {
  /** サンプル商事（8.1）。テストの基準 */
  company: sampleProject,
  /** みどり川電鉄（8.1.1）。駅別の収益性 */
  railway: railwayProject,
  /** さざなみ電力（8.1.2）。社内カンパニー制と社内取引 */
  utility: utilityProject,
  /** みずなぎコンサルティング（8.1.3）。案件・顧客別の収益性 */
  consulting: consultingProject,
} as const satisfies Record<string, () => Project>;

export type SampleId = keyof typeof SAMPLE_PROJECTS;
export const SAMPLE_IDS = Object.keys(SAMPLE_PROJECTS) as SampleId[];
