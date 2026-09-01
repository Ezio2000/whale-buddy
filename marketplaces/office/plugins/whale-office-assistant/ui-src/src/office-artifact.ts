import * as XLSX from 'xlsx';
import type { JsonValue } from '@whale-buddy/plugin-sdk/ui';

export type OfficeFormat = 'html' | 'docx' | 'xlsx' | 'pptx';
export type OfficeCell = string | number | boolean | null;

export interface OfficeSlide {
  title: string;
  body?: string;
  bullets?: string[];
  notes?: string;
}

export interface OfficeDraft {
  taskId: string;
  title: string;
  format: OfficeFormat;
  summary: string;
  content: string;
  sheetName?: string;
  columns?: string[];
  rows?: Array<Record<string, OfficeCell>>;
  slides?: OfficeSlide[];
}

export function parseOfficeDraft(value: JsonValue): OfficeDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('办公成果参数无效');
  const record = value as Record<string, JsonValue>;
  const format = record.format;
  if (format !== 'html' && format !== 'docx' && format !== 'xlsx' && format !== 'pptx') throw new Error('办公成果格式无效');
  const required = (key: string) => {
    const result = record[key];
    if (typeof result !== 'string' || !result.trim()) throw new Error(`办公成果缺少 ${key}`);
    return result;
  };
  const base: OfficeDraft = {
    taskId: required('taskId'),
    title: required('title'),
    format,
    summary: required('summary'),
    content: required('content'),
  };
  if (format === 'pptx') return { ...base, slides: parseSlides(record.slides) };
  if (format !== 'xlsx') return base;

  const columns = parseColumns(record.columns);
  const rows = parseRows(record.rows, columns);
  return {
    ...base,
    sheetName: normalizeSheetName(typeof record.sheetName === 'string' ? record.sheetName : base.title),
    columns,
    rows,
  };
}

export function renderXlsxArtifact(draft: OfficeDraft): Uint8Array {
  if (draft.format !== 'xlsx' || !draft.columns?.length || !draft.rows?.length) {
    throw new Error('Excel 成果缺少有效的 columns 或 rows，无法生成文件');
  }
  const sheet = XLSX.utils.json_to_sheet(draft.rows, { header: draft.columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, normalizeSheetName(draft.sheetName ?? draft.title));
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}

export function normalizeSheetName(value: string): string {
  const normalized = value.replace(/\.xlsx$/i, '').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31).trim();
  return normalized || '成果';
}

function parseColumns(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Excel 成果必须提供非空 columns');
  const columns = value.map((column, index) => {
    if (typeof column !== 'string' || !column.trim()) throw new Error(`Excel 第 ${index + 1} 列名称无效`);
    return column;
  });
  if (new Set(columns).size !== columns.length) throw new Error('Excel columns 不能包含重复列名');
  return columns;
}

function parseRows(value: JsonValue | undefined, columns: string[]): Array<Record<string, OfficeCell>> {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Excel 成果必须提供非空 rows');
  return value.map((row, rowIndex) => {
    if (Array.isArray(row)) {
      if (row.length !== columns.length) {
        throw new Error(`Excel 第 ${rowIndex + 1} 行有 ${row.length} 个单元格，应为 ${columns.length} 个`);
      }
      return Object.fromEntries(columns.map((column, columnIndex) => [column, parseCell(row[columnIndex], rowIndex, column)]));
    }
    if (!row || typeof row !== 'object') throw new Error(`Excel 第 ${rowIndex + 1} 行格式无效`);
    const rowRecord = row as Record<string, JsonValue>;
    const keys = Object.keys(rowRecord);
    const missing = columns.filter((column) => !Object.hasOwn(rowRecord, column));
    const extra = keys.filter((key) => !columns.includes(key));
    if (missing.length || extra.length) {
      const details = [missing.length ? `缺少：${missing.join('、')}` : '', extra.length ? `多出：${extra.join('、')}` : ''].filter(Boolean).join('；');
      throw new Error(`Excel 第 ${rowIndex + 1} 行与 columns 不匹配（${details}）`);
    }
    return Object.fromEntries(columns.map((column) => [column, parseCell(rowRecord[column], rowIndex, column)]));
  });
}

function parseCell(value: JsonValue, rowIndex: number, column: string): OfficeCell {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  throw new Error(`Excel 第 ${rowIndex + 1} 行“${column}”单元格必须是文本、数字、布尔值或空值`);
}

function parseSlides(value: JsonValue | undefined): OfficeSlide[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('PowerPoint 成果必须提供非空 slides');
  if (value.length > 50) throw new Error('PowerPoint 成果不能超过 50 页');
  return value.map((slide, index) => {
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)) throw new Error(`PowerPoint 第 ${index + 1} 页格式无效`);
    const record = slide as Record<string, JsonValue>;
    if (typeof record.title !== 'string' || !record.title.trim()) throw new Error(`PowerPoint 第 ${index + 1} 页缺少标题`);
    if (record.title.length > 160) throw new Error(`PowerPoint 第 ${index + 1} 页标题过长`);
    const body = typeof record.body === 'string' && record.body.trim() ? record.body : undefined;
    const notes = typeof record.notes === 'string' && record.notes.trim() ? record.notes : undefined;
    if (body && body.length > 2000) throw new Error(`PowerPoint 第 ${index + 1} 页正文过长`);
    let bullets: string[] | undefined;
    if (record.bullets !== undefined) {
      if (!Array.isArray(record.bullets) || !record.bullets.every((item) => typeof item === 'string' && item.trim())) {
        throw new Error(`PowerPoint 第 ${index + 1} 页 bullets 必须是非空文本数组`);
      }
      bullets = record.bullets as string[];
      if (bullets.length > 12 || bullets.some((item) => item.length > 500)) throw new Error(`PowerPoint 第 ${index + 1} 页要点过多或过长`);
    }
    if (!body && !bullets?.length && index > 0) throw new Error(`PowerPoint 第 ${index + 1} 页缺少正文或要点`);
    return { title: record.title, ...(body ? { body } : {}), ...(bullets ? { bullets } : {}), ...(notes ? { notes } : {}) };
  });
}
