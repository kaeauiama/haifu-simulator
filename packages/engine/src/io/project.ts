/**
 * プロジェクト JSON の保存と読み込み（F9-01）。保存形式は Project 型をそのまま JSON にしたもの。
 */
import { ProjectSchema } from '../model/schema.ts';
import type { Project } from '../model/types.ts';

export const CURRENT_SCHEMA_VERSION = 1;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function serializeProject(p: Project): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}

export function parseProject(input: unknown): ParseResult<Project> {
  const version = (input as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== CURRENT_SCHEMA_VERSION) {
    return { ok: false, errors: [`schemaVersion が ${String(version)} です。このツールは ${CURRENT_SCHEMA_VERSION} だけを読めます`] };
  }
  const r = ProjectSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.slice(0, 50).map((e) => `${e.path.join('.') || '(ルート)'}：${e.message}`) };
  if (!r.data.scenarios.length) return { ok: false, errors: ['シナリオが1つもありません'] };
  return { ok: true, value: r.data };
}

export function parseProjectJson(text: string): ParseResult<Project> {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    return { ok: false, errors: [`JSONとして読めません：${(e as Error).message}`] };
  }
  return parseProject(json);
}
