/**
 * 主要な流れの E2E。毎回まっさらなブラウザで、サンプル商事から始まる。
 * どのテストでも、コンソールのエラーとページの例外（CSP 違反を含む）が出ないことを確かめる。
 */
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const flowNode = (page: Page, text: string) => page.locator('.react-flow__node', { hasText: text });
const stepRow = (page: Page, name: RegExp) => page.locator('ol li').filter({ hasText: name });

test('起動するとサンプル商事を計算し、ゼロサム検査が一致する', async ({ page }) => {
  await page.getByRole('tab', { name: '集計' }).click();
  await expect(page.getByText('ゼロサム検査：一致')).toBeVisible();
  await expect(page.getByRole('row', { name: /PC30 サービス事業/ })).toContainText('7,005,000');
});

test('1ステップずつ進めると、その時点の残高に変わる（巻き戻しも）', async ({ page }) => {
  await stepRow(page, /決済①/).getByRole('button').last().click();
  await expect(flowNode(page, '1100 IT部')).toContainText('8,000,000');
  await page.getByRole('button', { name: '先頭へ' }).click();
  await expect(flowNode(page, '1100 IT部')).toContainText('5,000,000');
  await page.getByRole('button', { name: '最後まで実行' }).click();
  await expect(flowNode(page, '1100 IT部').locator('.font-semibold')).toHaveText('0');
});

test('間接費計算を配賦の後ろへ並べ替えると V-15 が出て、元に戻すで消える', async ({ page }) => {
  const grip = stepRow(page, /間接費計算/).getByRole('button', { name: 'ドラッグで並べ替え' });
  await grip.focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');
  }
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await expect(stepRow(page, /間接費計算/)).toContainText('5');
  await page.getByRole('tab', { name: /検証/ }).click();
  await expect(page.getByText('V-15')).toBeVisible();
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.getByText('V-15')).toHaveCount(0);
});

test('フロー図でノード間に線を引くと、選べる手法が出て、配賦サイクルを作れる', async ({ page }) => {
  const from = await page.locator('[data-id="CCTR:2100"] .react-flow__handle.source').boundingBox();
  const to = await page.locator('[data-id="CCTR:3000"] .react-flow__handle.target').boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button')).toContainText(['配布（新規）', '配賦（新規）', '直接活動配分（新規）']);
  await dialog.getByRole('button', { name: '配賦（新規）' }).click();
  await expect(page.getByRole('dialog')).toContainText('配賦サイクル CY-01');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /CY-01/ })).toContainText('原価センタ間の配賦');
});

test('手法別ビュー（決済）で線をクリックして%を直すと、V-06 が出る', async ({ page }) => {
  await page.getByRole('button', { name: '決済', exact: true }).click();
  const edge = page.locator('.react-flow__edge').first();
  await expect(edge).toBeVisible();
  const box = (await edge.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const input = page.getByRole('dialog').getByRole('textbox');
  await input.fill('70');
  await input.press('Enter');
  await page.getByRole('tab', { name: /検証/ }).click();
  await expect(page.getByText('V-06')).toBeVisible();
});

test('シナリオ比較：S-LATE と比べると、PC10 に 2,850,000 の差が出て、結果が変わったステップに印が付く', async ({ page }) => {
  await page.getByRole('button', { name: 'シナリオ比較' }).click();
  await expect(page.getByRole('row', { name: /PC10 本社/ })).toContainText('2,850,000');
  await expect(page.getByRole('row', { name: /原価センタ間の配賦/ })).toContainText('結果が変わった');
  await expect(page.locator('svg path').first()).toBeVisible();
});

test('入出力：JSON を保存して読み込み直せる。設定一覧を Excel で書き出せる', async ({ page }, info) => {
  await page.getByRole('button', { name: '入出力' }).click();

  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSONで保存' }).click()]);
  const jsonPath = info.outputPath('project.json');
  await json.saveAs(jsonPath);
  expect(JSON.parse(readFileSync(jsonPath, 'utf8')).scenarios).toHaveLength(3);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'JSONを読み込む' }).click()]);
  await chooser.setFiles(jsonPath);
  await expect(page.locator('#scenario-select option')).toHaveCount(3);

  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excelで書き出す' }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^settings-S-DEFAULT-.*\.xlsx$/);
  const xlsxPath = info.outputPath('settings.xlsx');
  await xlsx.saveAs(xlsxPath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['締めステップ', 'サイクル', '決済規則', '直接活動配分', '原価計算シート', 'TDD']);
});

test('金額の構成：役割ごとに対象の残高を積み上げで見せ、左右の意味を示す。計上の元に切り替えられ、表でも見られる', async ({ page }) => {
  await page.getByRole('button', { name: '金額の構成', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'コーポ部門' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ゴール' })).toBeVisible();
  await expect(page.getByText('← 収益・配った額（貸方）')).toBeVisible();
  await expect(page.getByText('費用・受け取った額（借方） →')).toBeVisible();
  const rowA = page.getByRole('button', { name: /顧客A×PG1×PC20/ });
  await expect(rowA).toContainText('-2,103,000');
  await page.getByRole('button', { name: '最初にどこで計上されたか', exact: true }).click();
  await expect(page.getByRole('img', { name: /顧客A×PG1×PC20：.*プロジェクトから：P-100 社内システム刷新 1,260,000.*売上 -6,000,000/ })).toBeVisible();
  await page.getByRole('button', { name: '表', exact: true }).click();
  await expect(page.getByRole('cell', { name: /プロジェクトから：P-100 社内システム刷新/ }).first()).toBeVisible();
});

test('金額の流れ：列の役割と種類、区間の手法を出す。1つ進めると、そのステップで増えた流れを強調する', async ({ page }) => {
  await page.getByRole('button', { name: '金額の流れ', exact: true }).click();
  const svg = page.getByRole('img', { name: 'サンキー図' });
  const box = page.locator('div.relative.w-full').filter({ has: svg });
  await expect(svg).toBeVisible();
  await expect(box.getByTitle('プロジェクト（WBS）')).toBeVisible();
  await expect(box.getByText('マージン分析への配賦・配布')).toBeVisible();
  await page.getByRole('button', { name: '1つ戻る' }).click();
  await page.getByRole('button', { name: '1つ進む' }).click();
  // TDD で増えた3本（全社×PG1 → 顧客A・B・C）だけを強く描く
  await expect(svg.locator('path[stroke-opacity="0.8"]')).toHaveCount(3);
});

test('マスタ：セルを書き換えて Tab を押すと、右のセルへ移る（識別子を変えても）', async ({ page }) => {
  await page.getByRole('button', { name: 'マスタ', exact: true }).click();
  const row = page.locator('tbody tr').first();
  await row.locator('input').nth(0).fill('41000001');
  await page.keyboard.press('Tab');
  await expect(row.locator('input').nth(1)).toBeFocused();
  await page.keyboard.type('売上高');
  await page.keyboard.press('Tab');
  await expect(row.locator('select').first()).toBeFocused();
  await expect(row.locator('input').nth(0)).toHaveValue('41000001');
  await expect(row.locator('input').nth(1)).toHaveValue('売上高');
});

test('入出力：みどり川電鉄（鉄道）を生成すると、駅別の収支が金額の構成に出る', async ({ page }) => {
  await page.getByRole('button', { name: '入出力' }).click();
  await page.getByRole('button', { name: 'みどり川電鉄（鉄道）を生成' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: '締め検討' }).click();
  await page.getByRole('button', { name: '金額の構成', exact: true }).click();
  await page.getByRole('button', { name: '最初にどこで計上されたか', exact: true }).click();
  await expect(page.getByRole('button', { name: /^中央駅 / })).toContainText('-179,060,678');
  await expect(page.getByRole('button', { name: /^工業団地駅 / })).toContainText('46,931,016');
  await page.getByRole('tab', { name: '集計' }).click();
  await expect(page.getByText('ゼロサム検査：一致')).toBeVisible();
});
