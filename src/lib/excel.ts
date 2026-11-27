import * as XLSX from 'xlsx';
import { ParsedForm } from '../types';
import { backendFuzzyMatch } from './ai';
import { parseCsvLine } from './research';

export function buildExcelTemplate(formData: ParsedForm): Uint8Array {
  const headers: string[] = [];
  const sampleRow: string[] = [];
  const guideRows: string[][] = [['Tên câu hỏi (Cột Excel)', 'Loại câu hỏi', 'Bắt buộc', 'Các lựa chọn hợp lệ']];

  for (const p of formData.pages || []) {
    for (const el of p.elements || []) {
      const choices = el.choices || [];
      if (['RadioGrid', 'CheckboxGrid'].includes(el.type) && el.rows?.length) {
        for (const r of el.rows) {
          const colName = `${el.name} [${r}]`;
          headers.push(colName);
          sampleRow.push(choices[0] || '');
          guideRows.push([colName, el.type, el.required ? 'Có' : 'Không', choices.join(' | ')]);
        }
      } else {
        headers.push(el.name);
        if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(el.type)) sampleRow.push(choices[0] || '');
        else if (el.type === 'UserEmail') sampleRow.push('nguyenvana2003@gmail.com');
        else if (el.type === 'Date') sampleRow.push('2026-10-15');
        else sampleRow.push('Câu trả lời mẫu');
        guideRows.push([el.name, el.type, el.required ? 'Có' : 'Không', choices.join(' | ')]);
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  XLSX.utils.book_append_sheet(wb, wsData, 'DuLieuKhaoSat');
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HuongDan_ViDu');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export function readTabularBuffer(buf: ArrayBufferLike, filename: string): string[][] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buf)).replace(/^\uFEFF/, '');
    return text.split(/\r?\n/).filter((l) => l.trim()).map(parseCsvLine);
  }
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
  return aoa.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
}

export function writeXlsxBuffer(headers: string[], rows: string[][], sheetName = 'Sheet1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

export function parseAndValidateExcelUpload(
  buf: ArrayBuffer,
  filename: string,
  formData: ParsedForm,
  customMapping?: Record<string, string> | null,
) {
  const rawRows = readTabularBuffer(buf, filename);
  if (rawRows.length < 2) throw new Error('File cần có ít nhất 1 dòng tiêu đề và 1 dòng dữ liệu.');
  if (rawRows.length - 1 > 5000) throw new Error('File vượt quá giới hạn 5.000 dòng.');

  const headers = rawRows[0];
  const dataRows = rawRows.slice(1);
  const targets: any[] = [];

  for (const p of formData.pages || []) {
    for (const el of p.elements || []) {
      const eid = String(el.id);
      if (['RadioGrid', 'CheckboxGrid'].includes(el.type) && el.rows?.length) {
        el.rows.forEach((rName, rIdx) => {
          targets.push({
            key: `${eid}::row::${rIdx}`,
            eid,
            row_idx: rIdx,
            row_name: rName,
            label: `${el.name} [${rName}]`,
            type: el.type,
            choices: el.choices || [],
            has_other: false,
            required: el.required,
          });
        });
      } else {
        targets.push({
          key: eid,
          eid,
          label: el.name,
          type: el.type,
          choices: el.choices || [],
          has_other: Boolean(el.has_other),
          required: el.required,
        });
      }
    }
  }

  const tByKey = new Map(targets.map((t) => [t.key, t]));
  const mapping = customMapping || {};
  if (!customMapping) {
    const used = new Set<string>();
    for (const h of headers) {
      let matched = '';
      for (const t of targets) {
        if (!used.has(t.key) && backendFuzzyMatch(h, t.label)) {
          matched = t.key;
          used.add(matched);
          break;
        }
      }
      mapping[h] = matched;
    }
  }

  const validRecords: Array<Record<string, any>> = [];
  const errorRows: Array<{ row: number; reasons: string[] }> = [];

  dataRows.forEach((rVals, idx) => {
    const rowNum = idx + 2;
    const record: Record<string, any> = {};
    const gridAcc: Record<string, Record<number, any>> = {};
    const errs: string[] = [];

    headers.forEach((h, colIdx) => {
      const tKey = mapping[h] || '';
      const t = tByKey.get(tKey);
      if (!t) return;
      const cell = (rVals[colIdx] || '').trim();
      if (!cell) {
        if (t.required) errs.push(`Thiếu '${t.label}'`);
        return;
      }

      if (['Radio', 'Dropdown', 'Scale'].includes(t.type)) {
        const m = t.choices.find((c: string) => backendFuzzyMatch(c, cell));
        if (m) record[t.eid] = m;
        else if (t.has_other) record[t.eid] = cell;
        else errs.push(`'${t.label}': '${cell}' không khớp lựa chọn`);
      } else if (t.type === 'Checkboxes') {
        const parts = cell.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
        const ml: string[] = [];
        for (const pt of parts) {
          const mc = t.choices.find((c: string) => backendFuzzyMatch(c, pt));
          if (mc) ml.push(mc);
          else if (t.has_other) ml.push(pt);
          else errs.push(`'${t.label}': '${pt}' không hợp lệ`);
        }
        record[t.eid] = ml;
      } else if (['RadioGrid', 'CheckboxGrid'].includes(t.type)) {
        gridAcc[t.eid] = gridAcc[t.eid] || {};
        if (t.type === 'RadioGrid') {
          const mc = t.choices.find((c: string) => backendFuzzyMatch(c, cell));
          if (mc) gridAcc[t.eid][t.row_idx] = mc;
          else errs.push(`'${t.label}': '${cell}' không hợp lệ`);
        } else {
          const parts = cell.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
          const ml = t.choices.filter((c: string) => parts.some((pt) => backendFuzzyMatch(c, pt)));
          if (ml.length) gridAcc[t.eid][t.row_idx] = ml;
          else errs.push(`'${t.label}': '${cell}' không hợp lệ`);
        }
      } else {
        record[t.eid] = cell;
      }
    });

    for (const p of formData.pages || []) {
      for (const el of p.elements || []) {
        const eid = String(el.id);
        if (gridAcc[eid]) record[eid] = (el.rows || []).map((_, ri) => gridAcc[eid][ri] || '');
      }
    }

    if (errs.length) errorRows.push({ row: rowNum, reasons: errs });
    else validRecords.push(record);
  });

  return {
    success: true,
    headers,
    targets: targets.map((t) => ({ key: t.key, label: t.label })),
    mapping,
    total_rows: dataRows.length,
    valid_count: validRecords.length,
    error_count: errorRows.length,
    error_rows: errorRows.slice(0, 50),
    valid_records: validRecords,
  };
}
