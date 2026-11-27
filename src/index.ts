import { Hono } from 'hono';
import { Env, ParsedForm } from './types';

type UploadedFileLike = { name: string; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> };

function getUploadedFile(fd: FormData, field = 'file'): UploadedFileLike | null {
  const raw = fd.get(field) as unknown;
  if (!raw || typeof raw === 'string' || typeof (raw as UploadedFileLike).arrayBuffer !== 'function') return null;
  return raw as UploadedFileLike;
}
import {
  aiDesignForm,
  aiDistributeForm,
  aiGenerateFullAutoRespondents,
  aiSuggestLogicRules,
  aiSuggestResearchModel,
  generateAiTextPoolForQuestion,
} from './lib/ai';
import { buildExcelTemplate, parseAndValidateExcelUpload, readTabularBuffer, writeXlsxBuffer } from './lib/excel';
import {
  cleanGoogleFormUrl,
  detectPlatform,
  parseGoogleForm,
  parseMicrosoftForm,
  syncFormStructures,
} from './lib/forms';
import { buildSchedule, formatViDateTime, generateCampaignDataset, validateLogicRules } from './lib/logicScheduler';
import {
  analyzeResearchDataset,
  exportApaReportDoc,
  exportCodedCsv,
  exportLabelledCsv,
  exportSpssSyntax,
  exportStataDo,
  generateResearchDataset,
  parseAndValidateResearchCsv,
} from './lib/research';
import {
  createCampaign,
  getCampaignStatus,
  getSupabase,
  processDueCampaignItems,
  skipWaitActiveCampaign,
  stopActiveCampaign,
} from './lib/supabase';

const app = new Hono<{ Bindings: Env }>();

function formatPreviewValue(val: unknown): string {
  if (val == null) return '(Bỏ qua theo nhánh)';
  if (Array.isArray(val)) return val.map(String).join(', ');
  if (typeof val === 'object') return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join('; ');
  return String(val);
}

function parseRowSelection(selMode: string, rangeStr: string, totalRows: number): number[] {
  if (selMode === 'all') return Array.from({ length: totalRows }, (_, i) => i);
  const chosen = new Set<number>();
  for (const part of (rangeStr || '').trim().split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Math.max(1, Math.min(Number(m[1]), Number(m[2])));
      const b = Math.min(totalRows, Math.max(Number(m[1]), Number(m[2])));
      for (let idx = a; idx <= b; idx++) chosen.add(idx - 1);
    } else if (/^\d+$/.test(part)) {
      const idx = Number(part) - 1;
      if (idx >= 0 && idx < totalRows) chosen.add(idx);
    }
  }
  return Array.from(chosen).sort((a, b) => a - b);
}

// ==============================================================================
// HEALTH & SUPABASE CHECK
// ==============================================================================
app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    runtime: 'cloudflare-workers-hono',
    supabase_configured: Boolean(getSupabase(c.env)),
  });
});

// ==============================================================================
// FORM PARSE & SYNC
// ==============================================================================
app.post('/api/parse', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  const rawUrl = String(data.url || '').trim();
  if (!rawUrl) return c.json({ error: 'Đường dẫn biểu mẫu không được để trống.' }, 400);
  try {
    const parsed = detectPlatform(rawUrl) === 'microsoft' ? await parseMicrosoftForm(rawUrl) : await parseGoogleForm(rawUrl);
    return c.json(parsed);
  } catch (e: any) {
    return c.json({ error: `Không thể phân tích biểu mẫu: ${e?.message || e}` }, 500);
  }
});

app.post('/api/sync', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  const oldForm = (data.old_form || {}) as ParsedForm;
  const url = String(data.url || oldForm.url || '').trim();
  if (!url) return c.json({ error: 'Thiếu đường dẫn biểu mẫu để đồng bộ.' }, 400);
  try {
    const newForm = detectPlatform(url) === 'microsoft' ? await parseMicrosoftForm(url) : await parseGoogleForm(url);
    const diff = syncFormStructures(oldForm, newForm);
    return c.json({ form: newForm, diff });
  } catch (e: any) {
    return c.json({ error: `Không thể đồng bộ biểu mẫu: ${e?.message || e}` }, 500);
  }
});

// ==============================================================================
// AI ENDPOINTS
// ==============================================================================
app.post('/api/ai-generate-text', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  const qName = String(data.question_name || '').trim();
  if (!qName) return c.json({ error: 'Thiếu tên câu hỏi cần sinh dữ liệu.' }, 400);
  try {
    const res = await generateAiTextPoolForQuestion(c.env, {
      formTitle: data.form_title || '',
      formDescription: data.form_description || '',
      qName,
      qDesc: data.question_description || '',
      qType: data.question_type || 'Short',
      userPrompt: data.prompt || '',
      count: Number(data.count || 20),
      customKey: data.custom_api_key || '',
    });
    return c.json({ success: true, ...res });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

app.post('/api/ai-distribute', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  const questions = data.questions || [];
  if (!questions.length) return c.json({ error: 'Không có câu hỏi nào để AI phân bổ.' }, 400);
  try {
    const res = await aiDistributeForm(
      c.env,
      data.form_title || '',
      data.form_description || '',
      questions,
      data.prompt || '',
      Number(data.count || 20),
      data.custom_api_key || '',
    );
    return c.json({ success: true, ...res });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

app.post('/api/ai-full-auto-preview', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  if (!data.form_data) return c.json({ error: 'Chưa tải biểu mẫu.' }, 400);
  try {
    const count = Math.min(Math.max(Number(data.count || 3), 1), 15);
    const res = await aiGenerateFullAutoRespondents(
      c.env,
      data.form_data,
      data.persona_prompt || '',
      data.trend || 'natural',
      count,
      data.custom_api_key || '',
    );
    return c.json({ success: true, ...res });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

// ==============================================================================
// LOGIC RULES & PREVIEW
// ==============================================================================
app.post('/api/rules/suggest', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  if (!data.form_data) return c.json({ error: 'Chưa tải biểu mẫu.' }, 400);
  try {
    const rules = await aiSuggestLogicRules(c.env, data.form_data, data.custom_api_key || '');
    return c.json({ success: true, rules });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

app.post('/api/rules/validate', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  return c.json(validateLogicRules(data.form_data || { pages: [] }, data.rules || []));
});

app.post('/api/campaign/preview', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  const formData = data.form_data as ParsedForm | undefined;
  if (!formData) return c.json({ error: 'Chưa có dữ liệu biểu mẫu.' }, 400);

  const count = Math.max(1, Math.min(5000, Number(data.count || 10)));
  const fields = data.fields || {};
  const distMode = data.distribution_mode || 'absolute';
  const rules = data.rules || [];
  const scheduleCfg = data.schedule || {};

  const ruleCheck = validateLogicRules(formData, rules);
  if (!ruleCheck.valid) {
    return c.json({ error: `Quy tắc logic đang có mâu thuẫn: ${ruleCheck.errors.join(' | ')}` }, 400);
  }

  try {
    const sampleN = Math.min(count, 8);
    const rows = await generateCampaignDataset(c.env, formData, fields, sampleN, distMode, rules);
    const timestamps = buildSchedule(count, scheduleCfg);
    const estStart = timestamps.length ? formatViDateTime(timestamps[0]) : '';
    const estEnd = timestamps.length ? formatViDateTime(timestamps[timestamps.length - 1]) : '';

    const qHeaders: Array<{ id: string; name: string }> = [];
    for (const p of formData.pages || []) {
      for (const el of p.elements || []) qHeaders.push({ id: String(el.id), name: el.name || 'Câu hỏi' });
    }

    const previewRows = rows.map((row, idx) => {
      const out: Record<string, string> = {};
      for (const qh of qHeaders) out[qh.id] = formatPreviewValue(row[qh.id]);
      out._ts = timestamps[idx] ? formatViDateTime(timestamps[idx]) : '';
      return out;
    });

    return c.json({
      success: true,
      headers: qHeaders,
      rows: previewRows,
      estimated_start: estStart,
      estimated_end: estEnd,
      warnings: ruleCheck.warnings || [],
    });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

// ==============================================================================
// EXCEL / CSV BATCH
// ==============================================================================
app.post('/api/excel/template', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  if (!data.form_data) return c.json({ error: 'Chưa có biểu mẫu.' }, 400);
  const bytes = buildExcelTemplate(data.form_data);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="autofillform_mau.xlsx"',
    },
  });
});

app.post('/api/excel/parse', async (c) => {
  const fd = await c.req.formData();
  const formDataRaw = fd.get('form_data');
  const mappingRaw = fd.get('mapping');
  const file = getUploadedFile(fd, 'file');
  if (!formDataRaw || typeof formDataRaw !== 'string') return c.json({ error: 'Thiếu cấu trúc biểu mẫu.' }, 400);
  if (!file) return c.json({ error: 'Vui lòng chọn file .xlsx hoặc .csv.' }, 400);

  const formData = JSON.parse(formDataRaw) as ParsedForm;
  const customMapping = mappingRaw && typeof mappingRaw === 'string' ? JSON.parse(mappingRaw) : null;
  try {
    const buf = await file.arrayBuffer();
    return c.json(parseAndValidateExcelUpload(buf, file.name, formData, customMapping));
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 400);
  }
});

// ==============================================================================
// CAMPAIGN RUNNER (SUPABASE + CRON + INTERACTIVE POLL TICK)
// ==============================================================================
app.post('/api/start', async (c) => {
  const currentStatus = await getCampaignStatus(c.env);
  if (currentStatus.active) {
    return c.json({ error: 'Đang có một chiến dịch điền form đang chạy.' }, 400);
  }

  const data = (await c.req.json().catch(() => ({}))) as any;
  const formData = (data.form_data || {}) as ParsedForm;
  const url = formData.url || cleanGoogleFormUrl(data.url || '');
  if (!url) return c.json({ error: 'Đường dẫn biểu mẫu trống.' }, 400);
  formData.url = url;

  const runMode = data.run_mode || 'standard';
  const scheduleCfg = data.schedule || { mode: 'immediate', delay_sec: Number(data.delay || 1.0) };

  let preRows: Array<Record<string, any>> = [];
  let modeLabel = 'Chuẩn';

  try {
    if (runMode === 'excel') {
      const excelRows = (data.excel_rows || []) as Array<Record<string, any>>;
      if (!excelRows.length) return c.json({ error: 'Không có dòng dữ liệu hợp lệ từ file Excel/CSV.' }, 400);
      const fallback = await generateCampaignDataset(c.env, formData, data.fields || {}, excelRows.length, 'absolute', data.rules || []);
      preRows = excelRows.map((er, i) => ({ ...fallback[i], ...er }));
      modeLabel = 'Điền từ Excel/CSV';
    } else if (runMode === 'full_ai') {
      const count = Math.max(1, Math.min(1000, Number(data.count || 10)));
      const aiRes = await aiGenerateFullAutoRespondents(
        c.env,
        formData,
        data.persona_prompt || '',
        data.ai_trend || 'natural',
        count,
        data.custom_api_key || '',
      );
      preRows = aiRes.respondents.map((r) => r.answers);
      modeLabel = 'Tự động hoàn toàn bằng AI';
    } else if (runMode === 'research_push') {
      const resRows = (data.research_rows || []) as Array<Record<string, any>>;
      if (!resRows.length) return c.json({ error: 'Chưa có dữ liệu mô phỏng SPSS để gửi.' }, 400);
      const fallback = await generateCampaignDataset(c.env, formData, data.fields || {}, resRows.length, 'absolute', data.rules || []);
      preRows = resRows.map((rr, i) => ({ ...fallback[i], ...rr }));
      modeLabel = 'Đẩy dữ liệu Nghiên cứu SPSS';
    } else {
      const count = Math.max(1, Math.min(5000, Number(data.count || 10)));
      const fields = data.fields || data.config || {};
      const distMode = data.distribution_mode || 'absolute';
      const rules = data.rules || [];
      const ruleCheck = validateLogicRules(formData, rules);
      if (!ruleCheck.valid) return c.json({ error: `Lỗi quy tắc logic: ${ruleCheck.errors.join(' | ')}` }, 400);
      preRows = await generateCampaignDataset(c.env, formData, fields, count, distMode, rules);
      modeLabel = distMode === 'absolute' ? 'Chia Tuyệt Đối 100%' : 'Phân Phối Tự Nhiên';
    }

    const timestamps = buildSchedule(preRows.length, scheduleCfg);
    const estEnd = timestamps.length ? formatViDateTime(timestamps[timestamps.length - 1]) : '';
    const created = await createCampaign(c.env, {
      formData,
      rows: preRows,
      timestamps,
      modeLabel,
      estimatedEnd: estEnd,
    });

    // Trigger first immediate step if schedule is immediate
    if ((scheduleCfg.mode || 'immediate') === 'immediate') {
      c.executionCtx.waitUntil(processDueCampaignItems(c.env, 1));
    }

    return c.json({ status: 'started', campaign_id: created.id, backend: created.backend, total: preRows.length, estimated_end: estEnd });
  } catch (e: any) {
    return c.json({ error: `Lỗi chuẩn bị dữ liệu chạy: ${e?.message || e}` }, 400);
  }
});

app.post('/api/stop', async (c) => {
  await stopActiveCampaign(c.env);
  return c.json({ status: 'stopping' });
});

app.post('/api/skip-wait', async (c) => {
  await skipWaitActiveCampaign(c.env);
  await processDueCampaignItems(c.env, 1);
  return c.json({ status: 'skipped' });
});

app.get('/api/status', async (c) => {
  await processDueCampaignItems(c.env, 2);
  return c.json(await getCampaignStatus(c.env));
});

// ==============================================================================
// AI FORM DESIGNER
// ==============================================================================
app.post('/api/designer/generate', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  try {
    const spec = await aiDesignForm(c.env, {
      purpose: data.purpose,
      topic: data.topic,
      audience: data.audience,
      length: data.length,
      language: data.language,
      constructs: data.constructs,
      customKey: data.custom_api_key,
    });
    return c.json({ success: true, spec });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

app.post('/api/designer/apps-script', async (c) => {
  const spec = ((await c.req.json().catch(() => ({}))) as any).spec;
  if (!spec) return c.json({ error: 'Thiếu cấu trúc form.' }, 400);
  const specJson = JSON.stringify(spec, null, 2);
  const gsCode = `// Google Apps Script tự động tạo Google Form từ AutoFillForm Studio
function createMyGoogleForm() {
  var spec = ${specJson};
  var form = FormApp.create(spec.title || 'Khảo sát mới');
  form.setDescription(spec.description || '');
  if (spec.purpose === 'quiz') form.setIsQuiz(true);
  var sectionBreaks = [null];
  var choiceItems = [];
  (spec.sections || []).forEach(function(sec, si) {
    if (si > 0) {
      var sb = form.addPageBreakItem().setTitle(sec.title || ('Phần ' + (si + 1)));
      if (sec.description) sb.setHelpText(sec.description);
      sectionBreaks.push(sb);
    }
    (sec.questions || []).forEach(function(q) {
      var prefix = '';
      if (q.code && spec.code_style) {
        if (spec.code_style === 'bracket') prefix = '[' + q.code + '] ';
        else if (spec.code_style === 'dot') prefix = q.code + '. ';
        else if (spec.code_style === 'dash') prefix = q.code + ' - ';
      }
      var title = prefix + (q.title || 'Câu hỏi');
      var item = null;
      if (q.type === 'RADIO') { item = form.addMultipleChoiceItem().setTitle(title); choiceItems.push({ item: item, q: q }); }
      else if (q.type === 'CHECKBOX') { item = form.addCheckboxItem().setTitle(title); item.setChoiceValues(q.options || ['Lựa chọn 1']); if (q.other) item.showOtherOption(true); }
      else if (q.type === 'DROP_DOWN') { item = form.addListItem().setTitle(title); choiceItems.push({ item: item, q: q }); }
      else if (q.type === 'SCALE') { var sc = q.scale || { min: 1, max: 5, low: '', high: '' }; item = form.addScaleItem().setTitle(title).setBounds(sc.min === 0 ? 0 : 1, sc.max || 5).setLabels(sc.low || '', sc.high || ''); }
      else if (q.type === 'GRID') { item = form.addGridItem().setTitle(title).setRows(q.rows || ['Hàng 1']).setColumns(q.options || ['Cột 1']); }
      else if (q.type === 'PARAGRAPH') { item = form.addParagraphTextItem().setTitle(title); }
      else if (q.type === 'DATE') { item = form.addDateItem().setTitle(title); }
      else if (q.type === 'TIME') { item = form.addTimeItem().setTitle(title); }
      else { item = form.addTextItem().setTitle(title); }
      if (item && q.required && typeof item.setRequired === 'function') item.setRequired(true);
    });
  });
  choiceItems.forEach(function(entry) {
    var q = entry.q, item = entry.item, map = {};
    (q.branch || []).forEach(function(b) { map[b.option] = b.go; });
    var choices = (q.options || []).map(function(lbl, oi) {
      var go = map[oi];
      if (go === 'submit') return item.createChoice(lbl, FormApp.PageNavigationType.SUBMIT);
      if (go && go.indexOf('section:') === 0) {
        var idx = parseInt(go.split(':')[1], 10);
        if (sectionBreaks[idx]) return item.createChoice(lbl, sectionBreaks[idx]);
      }
      return item.createChoice(lbl, FormApp.PageNavigationType.CONTINUE);
    });
    item.setChoices(choices);
  });
  Logger.log('Edit URL: ' + form.getEditUrl());
  Logger.log('Published URL: ' + form.getPublishedUrl());
}`;
  return c.json({ success: true, script: gsCode });
});

// ==============================================================================
// RESEARCH SPSS / SMARTPLS / AMOS / STATA
// ==============================================================================
app.post('/api/research/suggest-model', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  if (!data.form_data) return c.json({ error: 'Chưa có biểu mẫu để AI gợi ý mô hình.' }, 400);
  try {
    const res = await aiSuggestResearchModel(c.env, data.form_data, data.custom_api_key || '');
    return c.json({ success: true, ...res });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 500);
  }
});

app.post('/api/research/generate', async (c) => {
  const modelSpec = ((await c.req.json().catch(() => ({}))) as any).model || {};
  try {
    const dataset = generateResearchDataset(modelSpec);
    const analysis = analyzeResearchDataset(dataset);
    return c.json({ success: true, dataset, analysis });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 400);
  }
});

app.post('/api/research/import-csv', async (c) => {
  const fd = await c.req.formData();
  const modelRaw = fd.get('model');
  const file = getUploadedFile(fd, 'file');
  if (!modelRaw || typeof modelRaw !== 'string') return c.json({ error: 'Thiếu cấu trúc mô hình nghiên cứu.' }, 400);
  if (!file) return c.json({ error: 'Vui lòng chọn file CSV.' }, 400);
  const mappingRaw = fd.get('mapping');
  const mapping = mappingRaw && typeof mappingRaw === 'string' ? JSON.parse(mappingRaw) : null;
  const excludeSpec = String(fd.get('exclude_rows') || '');
  try {
    const csvText = await file.text();
    const res = parseAndValidateResearchCsv(csvText, JSON.parse(modelRaw), mapping, excludeSpec);
    const analysis = res.valid_count >= 10 ? analyzeResearchDataset(res.dataset) : null;
    return c.json({ success: true, ...res, analysis });
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 400);
  }
});

app.post('/api/research/export', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  const fmt = data.format || 'coded_csv';
  const dataset = data.dataset || {};
  let analysis = data.analysis || {};
  try {
    if (fmt === 'coded_csv') {
      return new Response('\uFEFF' + exportCodedCsv(dataset), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="spss_coded_data.csv"' },
      });
    }
    if (fmt === 'labelled_csv') {
      return new Response('\uFEFF' + exportLabelledCsv(dataset), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="spss_labelled_data.csv"' },
      });
    }
    if (fmt === 'spss_sps') {
      return new Response(exportSpssSyntax(dataset), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="autofillform_spss.sps"' },
      });
    }
    if (fmt === 'stata_do') {
      return new Response(exportStataDo(dataset), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="autofillform_stata.do"' },
      });
    }
    if (fmt === 'apa_doc') {
      if (!analysis.n && dataset.rows?.length) analysis = analyzeResearchDataset(dataset);
      return new Response(exportApaReportDoc(analysis), {
        headers: { 'Content-Type': 'application/msword; charset=utf-8', 'Content-Disposition': 'attachment; filename="bao_cao_apa_spss.doc"' },
      });
    }
    return c.json({ error: 'Định dạng xuất không hợp lệ.' }, 400);
  } catch (e: any) {
    return c.json({ error: e?.message || String(e) }, 400);
  }
});

// ==============================================================================
// GOOGLE SHEET TIMESTAMP EDITOR
// ==============================================================================
app.post('/api/timestamp/load', async (c) => {
  let rows: string[][] = [];
  try {
    const ct = c.req.header('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const fd = await c.req.formData();
      const file = getUploadedFile(fd, 'file');
      if (!file) return c.json({ error: 'Vui lòng chọn file CSV hoặc XLSX.' }, 400);
      rows = readTabularBuffer(await file.arrayBuffer(), file.name);
    } else {
      const body = (await c.req.json().catch(() => ({}))) as any;
      const sheetUrl = String(body.sheet_url || '').trim();
      const m = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (!m) return c.json({ error: 'Link Google Sheet không hợp lệ.' }, 400);
      const gidM = sheetUrl.match(/gid=(\d+)/);
      const gid = gidM ? gidM[1] : '0';
      const exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
      const resp = await fetch(exportUrl);
      const txt = await resp.text();
      if (!resp.ok || txt.slice(0, 200).includes('<!DOCTYPE html>')) {
        return c.json({ error: "Không đọc được Google Sheet. Hãy mở quyền 'Bất kỳ ai có liên kết đều có thể xem'." }, 400);
      }
      rows = readTabularBuffer(new TextEncoder().encode(txt).buffer, 'sheet.csv');
    }

    if (rows.length < 2) return c.json({ error: 'Bảng tính cần có hàng tiêu đề và ít nhất 1 dòng phản hồi.' }, 400);
    if (rows.length - 1 > 20000) return c.json({ error: 'Vượt quá giới hạn 20.000 dòng.' }, 400);

    const headers = rows[0];
    let tsColIdx = 0;
    headers.forEach((h, idx) => {
      const hl = h.toLowerCase();
      if (hl.includes('timestamp') || hl.includes('dấu thời gian') || hl.includes('thời gian')) tsColIdx = idx;
    });

    return c.json({ success: true, headers, ts_col_idx: tsColIdx, total_rows: rows.length - 1, rows: rows.slice(1) });
  } catch (e: any) {
    return c.json({ error: `Lỗi đọc dữ liệu Sheet: ${e?.message || e}` }, 400);
  }
});

app.post('/api/timestamp/preview', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  const rows = (data.rows || []) as string[][];
  const tsColIdx = Number(data.ts_col_idx || 0);
  const selMode = data.selection_mode || 'all';
  const rangeStr = data.range_spec || '';
  const scheduleCfg = data.schedule || {};
  if (!rows.length) return c.json({ error: 'Chưa có dữ liệu Sheet để tạo xem trước.' }, 400);

  const selectedIndices = parseRowSelection(selMode, rangeStr, rows.length);
  if (!selectedIndices.length) return c.json({ error: 'Không có dòng nào khớp với phạm vi đã chọn.' }, 400);

  let baseDate = new Date();
  if (scheduleCfg.start_at) {
    const parsed = new Date(scheduleCfg.start_at);
    if (!Number.isNaN(parsed.getTime())) baseDate = parsed;
  }

  const newDts = buildSchedule(selectedIndices.length, scheduleCfg, baseDate);
  const preview: any[] = [];
  const updatedMap: Record<string, string> = {};
  const gsUpdates: Array<[number, string]> = [];

  selectedIndices.forEach((rIdx, pos) => {
    const newStr = formatViDateTime(newDts[pos]);
    updatedMap[String(rIdx)] = newStr;
    gsUpdates.push([rIdx + 2, newStr]);
    preview.push({
      row: rIdx + 1,
      old_ts: rows[rIdx][tsColIdx] || '',
      new_ts: newStr,
      sample: rows[rIdx][1] || '',
    });
  });

  const appsScript =
    '// Dán vào Extensions -> Apps Script trong Google Sheet của bạn và bấm Run\n' +
    'function applyNewTimestamps() {\n' +
    '  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();\n' +
    `  var col = ${tsColIdx + 1};\n` +
    `  var updates = ${JSON.stringify(gsUpdates)};\n` +
    '  updates.forEach(function(u) { sheet.getRange(u[0], col).setValue(u[1]); });\n' +
    '}\n';

  return c.json({
    success: true,
    updated_count: selectedIndices.length,
    preview: preview.slice(0, 200),
    updated_map: updatedMap,
    apps_script: appsScript,
  });
});

app.post('/api/timestamp/export', async (c) => {
  const data = (await c.req.json().catch(() => ({}))) as any;
  const headers = (data.headers || []) as string[];
  const rows = (data.rows || []) as string[][];
  const tsColIdx = Number(data.ts_col_idx || 0);
  const updatedMap = (data.updated_map || {}) as Record<string, string>;
  const fmt = data.format || 'csv';

  const outRows = rows.map((r, idx) => {
    const nr = [...r];
    if (String(idx) in updatedMap && tsColIdx < nr.length) nr[tsColIdx] = updatedMap[String(idx)];
    return nr;
  });

  if (fmt === 'xlsx') {
    const bytes = writeXlsxBuffer(headers, outRows, 'Responses');
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="sheet_updated_timestamps.xlsx"',
      },
    });
  }

  const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csvStr = [headers.map(csvCell).join(','), ...outRows.map((r) => r.map(csvCell).join(','))].join('\n');
  return new Response('\uFEFF' + csvStr, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sheet_updated_timestamps.csv"' },
  });
});

// Serve static assets from ./dist via Cloudflare Worker Assets binding
app.all('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processDueCampaignItems(env, 5));
  },
};
