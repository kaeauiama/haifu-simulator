/**
 * YCOA を模した架空の勘定科目表（F1-02、3.1 の表）。
 * 番号の体系は YCOA に寄せているが、実在の科目番号とは一致しない「もどき」。
 */
import type { GLAccount } from '../model/types.ts';

export const YCOA_MOCK_ACCOUNTS: readonly GLAccount[] = [
  { id: '41000000', name: '製品売上高', category: 'REVENUE' },
  { id: '41200000', name: '役務売上高', category: 'REVENUE' },
  { id: '50000000', name: '売上原価', category: 'PRIMARY' },
  { id: '61000000', name: '給与手当', category: 'PRIMARY' },
  { id: '61200000', name: '法定福利費', category: 'PRIMARY' },
  { id: '63000000', name: '旅費交通費', category: 'PRIMARY' },
  { id: '64000000', name: '地代家賃', category: 'PRIMARY' },
  { id: '65000000', name: '減価償却費', category: 'PRIMARY' },
  { id: '66000000', name: '外注費', category: 'PRIMARY' },
  { id: '67000000', name: '通信費', category: 'PRIMARY' },
  { id: '68000000', name: '運賃', category: 'PRIMARY' },
  { id: '94100000', name: '配賦（間接費配賦）', category: 'SEC42' },
  { id: '94200000', name: '間接費計算', category: 'SEC41' },
  { id: '94300000', name: '活動配分', category: 'SEC43' },
  { id: '94900000', name: '決済', category: 'SEC21' },
];

/** よく使う勘定範囲 */
export const ACCOUNT_RANGES = {
  revenue: { from: '41000000', to: '49999999' },
  /** 一次原価と二次原価のすべて */
  allCosts: { from: '50000000', to: '99999999' },
  primaryCosts: { from: '50000000', to: '89999999' },
} as const;
