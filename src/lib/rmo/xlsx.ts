import ExcelJS from 'exceljs';
import { formatIstDateTime, formatIstFilenameTimestamp } from '@/lib/rmo/datetime';

export interface WorkbookColumn {
  key: string;
  header: string;
  width?: number;
}

export interface WorkbookSheetData {
  key: string;
  name: string;
  columns: WorkbookColumn[];
  rows: Record<string, unknown>[];
}

export interface WorkbookPreview {
  title: string;
  generated_at: string;
  filename: string;
  filters: Record<string, string | null>;
  sheets: Array<{
    key: string;
    name: string;
    columns: WorkbookColumn[];
    rows: Record<string, unknown>[];
    row_count: number;
    column_count: number;
  }>;
}

export function formatCellDate(value: Date | string | null | undefined): string {
  return formatIstDateTime(value);
}

export function sanitizeExportFilenamePart(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'all';
}

export function formatExportFilenameTimestamp(d: Date): string {
  return formatIstFilenameTimestamp(d);
}

export function safeExcelCell(value: unknown): string | number | boolean {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text =
    typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : JSON.stringify(value);
  if (/^[=+\-@]/.test(text)) return `'${text}`;
  return text;
}

function sheetName(name: string): string {
  return name.replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
}

export function buildWorkbookPreview(input: {
  title: string;
  filename: string;
  exportedAt: Date;
  filters: Record<string, string | null>;
  sheets: WorkbookSheetData[];
}): WorkbookPreview {
  return {
    title: input.title,
    generated_at: formatCellDate(input.exportedAt),
    filename: input.filename,
    filters: input.filters,
    sheets: input.sheets.map(sheet => ({
      key: sheet.key,
      name: sheet.name,
      columns: sheet.columns,
      rows: sheet.rows.map(row => {
        const out: Record<string, unknown> = {};
        for (const col of sheet.columns) {
          out[col.key] = safeExcelCell(row[col.key]);
        }
        return out;
      }),
      row_count: sheet.rows.length,
      column_count: sheet.columns.length,
    })),
  };
}

export async function writeWorkbookBuffer(input: {
  title: string;
  creator: string;
  exportedAt: Date;
  infoRows: Array<{ field: string; value: string | number | boolean }>;
  sheets: WorkbookSheetData[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.creator;
  workbook.lastModifiedBy = input.creator;
  workbook.title = input.title;
  workbook.created = input.exportedAt;
  workbook.modified = input.exportedAt;

  const info = workbook.addWorksheet('Export info', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  info.columns = [
    { header: 'field', key: 'field', width: 30 },
    { header: 'value', key: 'value', width: 56 },
  ];
  info.getRow(1).font = { bold: true };
  for (const row of input.infoRows) {
    info.addRow({ field: row.field, value: safeExcelCell(row.value) });
  }

  const usedNames = new Set<string>(['Export info']);
  for (const sheetData of input.sheets) {
    let name = sheetName(sheetData.name);
    let suffix = 1;
    while (usedNames.has(name)) {
      const base = sheetName(sheetData.name).slice(0, 28);
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = sheetData.columns.map(col => ({
      header: col.header,
      key: col.key,
      width: col.width ?? Math.max(14, Math.min(48, col.header.length + 6)),
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of sheetData.rows) {
      const out: Record<string, string | number | boolean> = {};
      for (const col of sheetData.columns) {
        out[col.key] = safeExcelCell(row[col.key]);
      }
      sheet.addRow(out);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
