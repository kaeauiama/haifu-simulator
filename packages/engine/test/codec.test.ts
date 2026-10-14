import { describe, expect, it } from 'vitest';
import { formatAccountRanges, formatStructure, parseAccountRanges, parseIdList, parseStructure } from '../src/edit/codec.ts';
import { sampleProject } from '../src/seed/sampleCompany.ts';

describe('表のセルのテキスト表記', () => {
  it('勘定範囲：書き出して読むと元に戻る。単独の勘定と全角の区切りも読める', () => {
    const sel = [{ from: '41000000', to: '49999999' }, { from: '68000000', to: '68000000' }];
    expect(formatAccountRanges(sel)).toBe('41000000-49999999, 68000000');
    expect(parseAccountRanges('41000000-49999999、68000000')).toEqual({ ok: true, value: sel });
    expect(parseAccountRanges('41000000～49999999')).toEqual({ ok: true, value: [sel[0]] });
    expect(parseAccountRanges('')).toEqual({ ok: true, value: [] });
    expect(parseAccountRanges('1-2-3').ok).toBe(false);
  });

  it('決済構造：サンプルの決済プロファイルを往復できる。決済先の欠けは誤り', () => {
    const s = sampleProject().master.settlementProfiles[0]!.structure;
    expect(formatStructure(s)).toBe('41000000-49999999:KEEP; 50000000-99999999:94900000');
    expect(parseStructure(formatStructure(s))).toEqual({ ok: true, value: s });
    expect(parseStructure('50000000-99999999:keep')).toEqual({ ok: true, value: [{ accounts: [{ from: '50000000', to: '99999999' }], settleAccount: 'KEEP' }] });
    expect(parseStructure('50000000-99999999').ok).toBe(false);
  });

  it('ID の一覧', () => {
    expect(parseIdList(' 1000, 1100、2000 ')).toEqual(['1000', '1100', '2000']);
  });
});
