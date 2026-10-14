import { describe, expect, it } from 'vitest';
import { allocate, normalizeWeights, roundYen } from '../src/ledger/rounding.ts';

describe('端数処理（5.4）', () => {
  it('T-03 1,000,000円を3者に均等配布：端数1円はIDが最小の受信者へ', () => {
    const parts = allocate(1_000_000, [
      { key: 'CCTR:2100', weight: 1 },
      { key: 'CCTR:2000', weight: 1 },
      { key: 'CCTR:3000', weight: 1 },
    ]);
    expect(parts).toEqual([333_333, 333_334, 333_333]);
  });

  it('識別子は数値として比べる（900 < 1000）', () => {
    const parts = allocate(1, [
      { key: 'CCTR:1000', weight: 1 },
      { key: 'CCTR:900', weight: 1 },
    ]);
    expect(parts).toEqual([0, 1]);
  });

  it('マイナスの額も同じ規則で按分し、合計が一致する', () => {
    const parts = allocate(-100, [
      { key: 'A', weight: 1 },
      { key: 'B', weight: 1 },
      { key: 'C', weight: 1 },
    ]);
    expect(parts).toEqual([-34, -33, -33]);
  });

  it('割り切れる按分は浮動小数の誤差で崩れない（60:40）', () => {
    expect(allocate(1_000_000, [{ key: 'a', weight: 0.6 }, { key: 'b', weight: 0.4 }])).toEqual([600_000, 400_000]);
    expect(allocate(300_000, [{ key: 'a', weight: 6 }, { key: 'b', weight: 3 }, { key: 'c', weight: 1 }])).toEqual([180_000, 90_000, 30_000]);
  });

  it('乱数の重みでも合計は必ず一致する', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 500; t++) {
      const n = 1 + Math.floor(rnd() * 12);
      const shares = Array.from({ length: n }, (_, i) => ({ key: `K${i}`, weight: rnd() * 1000 }));
      const total = Math.floor((rnd() - 0.3) * 10_000_000);
      const parts = allocate(total, shares);
      expect(parts.reduce((s, v) => s + v, 0)).toBe(total);
      parts.forEach((p, i) => expect(Math.abs(p - (total * shares[i]!.weight) / shares.reduce((s, x) => s + x.weight, 0))).toBeLessThan(1));
    }
  });

  it('roundYen は0から遠い側へ丸める', () => {
    expect(roundYen(2.5)).toBe(3);
    expect(roundYen(-2.5)).toBe(-3);
    expect(roundYen(0.1 + 0.2 - 0.3)).toBe(0);
    expect(Object.is(roundYen(-0.2), 0)).toBe(true);
  });

  it('P-07 配分基準は合計の符号にそろえ、逆符号は外す。合計0は null', () => {
    expect(normalizeWeights([{ key: 'a', weight: -6 }, { key: 'b', weight: -4 }])?.shares).toEqual([
      { key: 'a', weight: 6 },
      { key: 'b', weight: 4 },
    ]);
    expect(normalizeWeights([{ key: 'a', weight: 10 }, { key: 'b', weight: -2 }])?.dropped).toEqual(['b']);
    expect(normalizeWeights([{ key: 'a', weight: 0 }])).toBeNull();
  });
});
