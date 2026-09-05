import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { normalizeSheetName, parseOfficeDraft, renderXlsxArtifact } from '../../marketplaces/office/plugins/whale-office-assistant/ui-src/src/office-artifact';

const base = {
  taskId: 'task-1',
  title: '服务方向综合对比表.xlsx',
  format: 'xlsx',
  summary: '共两项服务方向。',
  content: '结构化服务方向对比。',
} as const;

describe('office Excel artifacts', () => {
  it('normalizes array rows and renders the requested workbook dimensions and sheet name', () => {
    const draft = parseOfficeDraft({
      ...base,
      sheetName: '服务方向综合对比表',
      columns: ['序号', '服务方向', '总分'],
      rows: [[1, 'AI 自动化顾问', 92], [2, '知识库实施', 86]],
    });

    expect(draft.rows).toEqual([
      { 序号: 1, 服务方向: 'AI 自动化顾问', 总分: 92 },
      { 序号: 2, 服务方向: '知识库实施', 总分: 86 },
    ]);
    const workbook = XLSX.read(renderXlsxArtifact(draft), { type: 'array', cellStyles: true });
    expect(workbook.SheetNames).toEqual(['服务方向综合对比表']);
    const sheet = workbook.Sheets['服务方向综合对比表'];
    expect(sheet['!ref']).toBe('A1:C3');
    expect(sheet['!cols']).toEqual(expect.arrayContaining([expect.objectContaining({ wch: expect.any(Number) })]));
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      ['序号', '服务方向', '总分'],
      [1, 'AI 自动化顾问', 92],
      [2, '知识库实施', 86],
    ]);
  });

  it('preserves a 12 by 15 matrix without adding a fallback content column', () => {
    const columns = Array.from({ length: 15 }, (_, index) => `列${index + 1}`);
    const rows = Array.from({ length: 12 }, (_, rowIndex) => columns.map((_, columnIndex) => `${rowIndex + 1}-${columnIndex + 1}`));
    const draft = parseOfficeDraft({ ...base, columns, rows });
    const workbook = XLSX.read(renderXlsxArtifact(draft), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    expect(sheet['!ref']).toBe('A1:O13');
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toHaveLength(13);
    expect(sheet.P1).toBeUndefined();
  });

  it('accepts object rows whose keys exactly match columns', () => {
    const draft = parseOfficeDraft({ ...base, columns: ['名称', '启用'], rows: [{ 名称: '方案 A', 启用: true }] });
    expect(draft.rows).toEqual([{ 名称: '方案 A', 启用: true }]);
  });

  it.each([
    [{ ...base, columns: ['A', 'B'], rows: [[1]] }, '第 1 行有 1 个单元格，应为 2 个'],
    [{ ...base, columns: ['A', 'B'], rows: [{ A: 1 }] }, '第 1 行与 columns 不匹配'],
    [{ ...base, columns: ['A'], rows: [] }, '必须提供非空 rows'],
    [{ ...base, rows: [{ A: 1 }] }, '必须提供非空 columns'],
  ])('rejects invalid spreadsheet data instead of silently generating content rows', (input, message) => {
    expect(() => parseOfficeDraft(input)).toThrow(message);
  });

  it('sanitizes invalid and overlong worksheet names', () => {
    expect(normalizeSheetName('分析/结果:2026.xlsx')).toBe('分析 结果 2026');
    expect(normalizeSheetName('a'.repeat(40))).toHaveLength(31);
  });
});

describe('office PowerPoint drafts', () => {
  const powerpointBase = {
    taskId: 'task-pptx', title: '季度复盘.pptx', format: 'pptx', summary: '季度经营复盘。', content: '演示稿摘要。',
  } as const;

  it('accepts ordered structured slides with notes', () => {
    const draft = parseOfficeDraft({
      ...powerpointBase,
      slides: [
        { title: '季度复盘', body: '2026 Q3' },
        { title: '关键进展', bullets: ['收入增长 18%', '交付周期缩短 12%'], notes: '强调增长来自续约。' },
      ],
    });
    expect(draft.slides?.[1]).toEqual({ title: '关键进展', bullets: ['收入增长 18%', '交付周期缩短 12%'], notes: '强调增长来自续约。' });
  });

  it('rejects empty or overfull presentation pages', () => {
    expect(() => parseOfficeDraft({ ...powerpointBase, slides: [{ title: '封面' }, { title: '空白页' }] })).toThrow('缺少正文或要点');
    expect(() => parseOfficeDraft({ ...powerpointBase, slides: [{ title: '封面', bullets: Array.from({ length: 13 }, () => '要点') }] })).toThrow('要点过多或过长');
  });
});

describe('multi-sheet workbook integrity', () => {
  it('exports exactly the worksheets and cells used by the preview', () => {
    const draft = parseOfficeDraft({ ...base, sheets: [
      { sheetName: '原始数据', columns: ['产品', '销量'], rows: [['A', 12], ['B', 20]] },
      { sheetName: '产品排名', columns: ['名次', '产品'], rows: [[1, 'B'], [2, 'A']] },
    ] });
    const workbook = XLSX.read(renderXlsxArtifact(draft), { type: 'array' });
    expect(workbook.SheetNames).toEqual(['原始数据', '产品排名']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['产品排名'], { header: 1 })).toEqual([['名次', '产品'], [1, 'B'], [2, 'A']]);
  });
  it('rejects colliding normalized sheet names and conflicting single-sheet input', () => {
    const sheet = { sheetName: 'Data', columns: ['A'], rows: [[1]] };
    expect(() => parseOfficeDraft({ ...base, sheets: [sheet, { ...sheet, sheetName: 'data' }] })).toThrow('不能重复');
    expect(() => parseOfficeDraft({ ...base, sheets: [sheet], columns: ['A'] })).toThrow('不能同时提供');
  });
});
