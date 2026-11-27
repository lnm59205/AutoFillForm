import { Env, FormElement, LogicRule, ParsedForm, ScheduleConfig } from '../types';
import { backendFuzzyMatch, generateAiTextPoolForQuestion } from './ai';
import {
  computeVisitedPages,
  generateClassCodePool,
  generateUniqueEmailPool,
  generateUniqueMssvPool,
  generateUniquePhonePool,
  generateUniqueViNamePool,
  generateViAddressPool,
  parseCustomListValues,
} from './forms';

const randUniform = (a: number, b: number) => a + Math.random() * (b - a);
const randChoice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function weightedRandomChoice<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return randChoice(items);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ==============================================================================
// 1. NATURAL SENTIMENT WEIGHTS
// ==============================================================================

export function scoreChoiceSentiment(choiceStr: string, index = 0, total = 1): number {
  const s = String(choiceStr).toLowerCase().trim();
  if (/^(\d+)(?:[./\-]|\s*$)/.test(s) && total > 1) {
    return -1 + 2 * (index / (total - 1));
  }
  const negStrong = ['rất không hài lòng', 'hoàn toàn không đồng ý', 'rất không đồng ý', 'rất tệ', 'rất kém', 'không bao giờ'];
  const negMild = ['không hài lòng', 'không đồng ý', 'tệ', 'kém', 'không thích', 'ít khi', 'hiếm khi', 'disagree', 'poor'];
  const posStrong = ['rất hài lòng', 'hoàn toàn đồng ý', 'rất đồng ý', 'rất tốt', 'tuyệt vời', 'luôn luôn', 'rất thường xuyên'];
  const posMild = ['hài lòng', 'đồng ý', 'tốt', 'thích', 'thường xuyên', 'hiệu quả', 'agree', 'good'];
  const neutral = ['bình thường', 'trung bình', 'trung lập', 'không ý kiến', 'thỉnh thoảng', 'neutral'];

  if (negStrong.some((p) => s.includes(p))) return -1;
  if (posStrong.some((p) => s.includes(p))) return 1;
  if (negMild.some((p) => s.includes(p))) return -0.6;
  if (posMild.some((p) => s.includes(p))) return 0.6;
  if (neutral.some((p) => s.includes(p))) return 0;
  return total > 1 ? -0.5 + index / (total - 1) : 0;
}

export function calculateNaturalWeights(options: string[], trend = 'natural_positive'): Record<string, number> {
  const n = options.length;
  if (!n) return {};
  if (n === 1) return { [options[0]]: 100 };
  const scores = options.map((o, i) => scoreChoiceSentiment(o, i, n));
  const weights = scores.map((s) =>
    trend === 'natural_negative' ? Math.exp(-2 * s) : trend === 'natural_neutral' ? Math.exp(-3.2 * s * s) : Math.exp(2 * s),
  );
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  options.forEach((o, i) => (out[o] = (weights[i] / total) * 100));
  return out;
}

// ==============================================================================
// 2. LOGIC RULES VALIDATOR
// ==============================================================================

export function validateLogicRules(formData: ParsedForm, rules: LogicRule[]) {
  const qMap = new Map<string, FormElement>();
  for (const p of formData?.pages || []) {
    for (const el of p.elements || []) qMap.set(String(el.id), el);
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const seenPairs = new Map<string, { op: string; tc: string[] }>();
  const adj = new Map<string, Set<string>>();

  (rules || []).forEach((r, idx) => {
    if (r.enabled === false) return;
    const sid = String(r.source_id || '');
    const tid = String(r.target_id || '');
    const sChoice = String(r.source_choice || '');
    const op = r.operator || 'require';
    const tChoices = (r.target_choices || []).map(String).filter(Boolean);

    if (!qMap.has(sid) || !qMap.has(tid)) {
      errors.push(`Quy tắc #${idx + 1}: Câu hỏi nguồn hoặc đích không còn tồn tại.`);
      return;
    }
    if (sid === tid) {
      errors.push(`Quy tắc #${idx + 1}: Câu nguồn và câu đích không thể giống nhau.`);
      return;
    }
    if (!sChoice || !tChoices.length) {
      errors.push(`Quy tắc #${idx + 1}: Thiếu đáp án điều kiện hoặc đáp án bắt buộc.`);
      return;
    }

    const key = `${sid}|||${sChoice}|||${tid}`;
    const prev = seenPairs.get(key);
    if (prev) {
      const sameSet = prev.tc.length === tChoices.length && prev.tc.every((x) => tChoices.includes(x));
      const intersects = prev.tc.some((x) => tChoices.includes(x));
      if (prev.op === op && sameSet) {
        warnings.push(`Quy tắc #${idx + 1} bị trùng lặp với quy tắc trước đó.`);
      } else if (prev.op === 'require' && op === 'require' && !intersects) {
        errors.push(`Mâu thuẫn quy tắc #${idx + 1}: '${qMap.get(sid)?.name} = ${sChoice}' ép '${qMap.get(tid)?.name}' chọn hai tập đáp án không giao nhau.`);
      } else if (prev.op !== op && sameSet) {
        errors.push(`Mâu thuẫn quy tắc #${idx + 1}: Vừa bắt buộc vừa loại trừ cùng đáp án trên '${qMap.get(tid)?.name}'.`);
      }
    } else {
      seenPairs.set(key, { op, tc: tChoices });
    }

    if (!adj.has(sid)) adj.set(sid, new Set());
    adj.get(sid)!.add(tid);
  });

  // Cycle detection DFS
  const state = new Map<string, number>();
  const dfs = (node: string): boolean => {
    state.set(node, 1);
    for (const nxt of adj.get(node) || []) {
      if (state.get(nxt) === 1) return true;
      if (!state.get(nxt) && dfs(nxt)) return true;
    }
    state.set(node, 2);
    return false;
  };
  for (const node of adj.keys()) {
    if (!state.get(node) && dfs(node)) {
      errors.push('Phát hiện vòng lặp phụ thuộc giữa các quy tắc (A -> B -> ... -> A). Vui lòng gỡ bớt 1 quy tắc.');
      break;
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ==============================================================================
// 3. HAMILTON ABSOLUTE + NATURAL CAMPAIGN GENERATOR
// ==============================================================================

function findMatchingCfgKey(choicesCfg: Record<string, any>, optVal: string): string | null {
  if (!choicesCfg) return null;
  const optStr = String(optVal).trim();
  if (optStr in choicesCfg) return optStr;
  for (const k of Object.keys(choicesCfg)) {
    if (backendFuzzyMatch(k, optVal)) return k;
  }
  return null;
}

function findOtherCfgKey(choicesCfg: Record<string, any>): string | null {
  if (!choicesCfg) return null;
  for (const k of Object.keys(choicesCfg)) {
    if (k === '__other_option__' || backendFuzzyMatch(k, 'khác') || backendFuzzyMatch(k, 'mục khác')) return k;
  }
  return null;
}

function hamiltonPool(activeChoices: Record<string, number>, count: number): string[] {
  const totalWeight = Object.values(activeChoices).reduce((a, b) => a + b, 0) || 100;
  const options = Object.keys(activeChoices);
  const counts: Record<string, number> = {};
  const remainders: Record<string, number> = {};

  for (const opt of options) {
    const target = (activeChoices[opt] / totalWeight) * count;
    counts[opt] = Math.floor(target);
    remainders[opt] = target - counts[opt];
  }
  const unallocated = count - Object.values(counts).reduce((a, b) => a + b, 0);
  const sortedOpts = [...options].sort((a, b) => remainders[b] - remainders[a]);
  for (let i = 0; i < unallocated; i++) {
    counts[sortedOpts[i % sortedOpts.length]] += 1;
  }

  const pool: string[] = [];
  for (const [opt, cnt] of Object.entries(counts)) {
    const val = opt === '__other_option__' ? 'Ý kiến khác' : opt;
    for (let i = 0; i < cnt; i++) pool.push(val);
  }
  return shuffle(pool).slice(0, count);
}

export async function generateCampaignDataset(
  env: Env,
  formData: ParsedForm,
  fieldsConfig: Record<string, any>,
  count: number,
  distributionMode = 'absolute',
  rules: LogicRule[] = [],
): Promise<Array<Record<string, any>>> {
  const safeCount = Math.max(1, Number(count) || 1);
  const cfgAll = fieldsConfig || {};
  const pregenerated: Record<string, any[]> = {};
  const elemMap = new Map<string, FormElement>();

  for (const page of formData.pages || []) {
    for (const elem of page.elements || []) {
      const eid = String(elem.id);
      elemMap.set(eid, elem);
      const etype = elem.type;
      const cfg = cfgAll[eid] || {};

      if (['Radio', 'Dropdown', 'Scale'].includes(etype)) {
        const opts = [...(elem.choices || [])];
        const choicesCfg = cfg.choices || cfg.options || {};
        let active: Record<string, number> = {};
        for (const o of opts) {
          const mk = findMatchingCfgKey(choicesCfg, o);
          if (mk !== null) {
            const w = Number(choicesCfg[mk]);
            if (w > 0) active[o] = w;
          }
        }
        if (elem.has_other) {
          const ok = findOtherCfgKey(choicesCfg);
          if (ok !== null && Number(choicesCfg[ok]) > 0) active.__other_option__ = Number(choicesCfg[ok]);
        }
        if (!Object.keys(active).length && opts.length) {
          if (distributionMode.startsWith('natural_')) active = calculateNaturalWeights(opts, distributionMode);
          else opts.forEach((o) => (active[o] = 100 / opts.length));
        }

        if (!Object.keys(active).length) {
          pregenerated[eid] = Array(safeCount).fill('');
        } else if (distributionMode === 'absolute') {
          pregenerated[eid] = hamiltonPool(active, safeCount);
        } else {
          const oList = Object.keys(active);
          const wList = oList.map((k) => Math.max(0.1, active[k] * randUniform(0.88, 1.12)));
          pregenerated[eid] = Array.from({ length: safeCount }, () => {
            const ch = weightedRandomChoice(oList, wList);
            return ch === '__other_option__' ? 'Ý kiến khác' : ch;
          });
        }
      } else if (etype === 'Checkboxes') {
        const opts = [...(elem.choices || [])];
        const choicesCfg = cfg.choices || cfg.options || {};
        const active: Record<string, number> = {};
        for (const o of opts) {
          const mk = findMatchingCfgKey(choicesCfg, o);
          if (mk !== null && Number(choicesCfg[mk]) > 0) active[o] = Number(choicesCfg[mk]);
        }
        if (!Object.keys(active).length) opts.forEach((o) => (active[o] = 50));

        const valRule = elem.validation || {};
        const minSel = valRule.exact_select || valRule.min_select || (elem.required ? 1 : 0);
        const maxSel = valRule.exact_select || valRule.max_select || opts.length;

        const pools: Record<string, boolean[]> = {};
        for (const [cv, w] of Object.entries(active)) {
          const ty = Math.min(safeCount, Math.max(0, Math.round((w / 100) * safeCount)));
          pools[cv] = shuffle([...Array(ty).fill(true), ...Array(safeCount - ty).fill(false)]);
        }

        const oKeys = Object.keys(active);
        const wKeys = oKeys.map((k) => active[k]);
        const vals: string[][] = [];
        for (let idx = 0; idx < safeCount; idx++) {
          let sel = oKeys.filter((cv) => pools[cv][idx]);
          if (maxSel && sel.length > maxSel) sel = shuffle(sel).slice(0, maxSel);
          while (sel.length < minSel && sel.length < oKeys.length) {
            const cand = weightedRandomChoice(oKeys, wKeys);
            if (!sel.includes(cand)) sel.push(cand);
          }
          vals.push(sel);
        }
        pregenerated[eid] = vals;
      } else if (['RadioGrid', 'CheckboxGrid'].includes(etype)) {
        const rows = elem.rows || [];
        const cols = elem.choices || [];
        const rowsCfg = cfg.rows || {};
        const rowPools: Record<string, any[]> = {};

        for (const r of rows) {
          const rk = Object.keys(rowsCfg).find((k) => backendFuzzyMatch(k, r));
          const rcfg = rk ? rowsCfg[rk] : {};
          const ccfg = (rcfg && typeof rcfg === 'object' ? rcfg.choices || rcfg.options || rcfg : {}) as Record<string, any>;
          let active: Record<string, number> = {};
          for (const c of cols) {
            const mk = findMatchingCfgKey(ccfg, c);
            if (mk !== null && Number(ccfg[mk]) > 0) active[c] = Number(ccfg[mk]);
          }
          if (!Object.keys(active).length && cols.length) {
            if (distributionMode.startsWith('natural_')) active = calculateNaturalWeights(cols, distributionMode);
            else cols.forEach((c) => (active[c] = 100 / cols.length));
          }
          if (etype === 'RadioGrid') {
            rowPools[r] = Object.keys(active).length ? hamiltonPool(active, safeCount) : Array(safeCount).fill('');
          } else {
            const pools: Record<string, boolean[]> = {};
            for (const [cv, w] of Object.entries(active)) {
              const ty = Math.min(safeCount, Math.max(0, Math.round((w / 100) * safeCount)));
              pools[cv] = shuffle([...Array(ty).fill(true), ...Array(safeCount - ty).fill(false)]);
            }
            rowPools[r] = Array.from({ length: safeCount }, (_, i) => {
              const s = Object.keys(active).filter((cv) => pools[cv][i]);
              if (elem.required && !s.length && Object.keys(active).length) s.push(randChoice(Object.keys(active)));
              return s;
            });
          }
        }
        pregenerated[eid] = Array.from({ length: safeCount }, (_, i) => rows.map((r) => rowPools[r][i]));
      } else if (['Short', 'Paragraph', 'UserEmail'].includes(etype)) {
        const strategy = cfg.strategy || (etype === 'UserEmail' ? 'email' : 'custom_list');
        if (strategy === 'custom_list') {
          let items = parseCustomListValues(cfg.static_value || '');
          if (!items.length) {
            try {
              const aiRes = await generateAiTextPoolForQuestion(env, {
                formTitle: formData.title || '',
                formDescription: formData.description || '',
                qName: elem.name || '',
                qDesc: elem.description || '',
                qType: etype,
                userPrompt: cfg.ai_prompt || '',
                count: Math.min(safeCount, 35),
              });
              items = aiRes.items;
            } catch {
              items = [];
            }
          }
          pregenerated[eid] = items.length
            ? Array.from({ length: safeCount }, (_, i) => items[i % items.length])
            : generateUniqueViNamePool(safeCount);
        } else if (strategy === 'static' && cfg.static_value) {
          pregenerated[eid] = Array(safeCount).fill(String(cfg.static_value).trim());
        } else if (strategy === 'vi_name') {
          pregenerated[eid] = generateUniqueViNamePool(safeCount);
        } else if (strategy === 'vi_phone') {
          pregenerated[eid] = generateUniquePhonePool(safeCount);
        } else if (strategy === 'mssv') {
          pregenerated[eid] = generateUniqueMssvPool(safeCount);
        } else if (strategy === 'class_code') {
          pregenerated[eid] = generateClassCodePool(safeCount);
        } else if (strategy === 'vi_address') {
          pregenerated[eid] = generateViAddressPool(safeCount);
        } else if (strategy === 'number') {
          pregenerated[eid] = Array.from({ length: safeCount }, () => String(Math.floor(randUniform(18, 60))));
        } else if (strategy === 'text') {
          pregenerated[eid] = Array.from({ length: safeCount }, (_, i) => `Ý kiến phản hồi mẫu #${i + 1}`);
        } else {
          pregenerated[eid] = generateUniqueEmailPool(safeCount);
        }
      } else if (etype === 'Date') {
        const today = Date.now();
        pregenerated[eid] = Array.from({ length: safeCount }, () => {
          const d = new Date(today - Math.floor(Math.random() * 90) * 86400000);
          return d.toISOString().slice(0, 10);
        });
      } else if (etype === 'Time') {
        pregenerated[eid] = Array.from({ length: safeCount }, () => {
          const h = String(Math.floor(randUniform(7, 22))).padStart(2, '0');
          const m = String(Math.floor(randUniform(0, 59))).padStart(2, '0');
          return `${h}:${m}`;
        });
      } else if (etype === 'Ranking') {
        const ch = [...(elem.choices || [])];
        pregenerated[eid] = Array.from({ length: safeCount }, () => shuffle(ch));
      }
    }
  }

  const respondents: Array<Record<string, any>> = [];
  const activeRules = (rules || []).filter((r) => r.enabled !== false);

  for (let i = 0; i < safeCount; i++) {
    const row: Record<string, any> = {};
    for (const eid of Object.keys(pregenerated)) row[eid] = pregenerated[eid][i];

    for (const rule of activeRules) {
      const sid = String(rule.source_id || '');
      const tid = String(rule.target_id || '');
      if (!(sid in row) || !(tid in row)) continue;
      if (String(row[sid]) === String(rule.source_choice || '')) {
        const tChoices = rule.target_choices || [];
        const op = rule.operator || 'require';
        const tElem = elemMap.get(tid);
        const allChoices = tElem?.choices || [];
        if (op === 'require' && tChoices.length && !tChoices.includes(String(row[tid]))) {
          row[tid] = randChoice(tChoices);
        } else if (op === 'exclude' && tChoices.length && tChoices.includes(String(row[tid]))) {
          const allowed = allChoices.filter((c) => !tChoices.includes(c));
          if (allowed.length) row[tid] = randChoice(allowed);
        }
      }
    }

    if (formData.has_branching) {
      const visited = new Set(computeVisitedPages(formData, row));
      formData.pages.forEach((page, pIdx) => {
        if (!visited.has(pIdx)) {
          for (const el of page.elements || []) row[String(el.id)] = null;
        }
      });
    }

    respondents.push(row);
  }

  return respondents;
}

// ==============================================================================
// 4. SPREAD SCHEDULER & NIGHT MODE
// ==============================================================================

function isNightHour(dt: Date): boolean {
  const h = dt.getHours();
  return h >= 22 || h < 7;
}

function advancePastNight(dt: Date): Date {
  const h = dt.getHours();
  if (h >= 22) {
    const nxt = new Date(dt.getTime() + 86400000);
    nxt.setHours(7, 0, Math.floor(randUniform(15, 240)), 0);
    return nxt;
  }
  if (h < 7) {
    const nxt = new Date(dt.getTime());
    nxt.setHours(7, 0, Math.floor(randUniform(15, 240)), 0);
    return nxt;
  }
  return dt;
}

export function buildSchedule(count: number, scheduleCfg?: ScheduleConfig, baseDate?: Date): Date[] {
  const n = Math.max(1, Number(count) || 1);
  const cfg = scheduleCfg || {};
  const mode = cfg.mode || 'immediate';
  const rhythm = cfg.rhythm || 'natural';
  const nightMode = cfg.night_mode || 'normal';

  const now = baseDate ? new Date(baseDate.getTime()) : new Date();
  let startDt = new Date(now.getTime());
  if (cfg.start_at) {
    const parsed = new Date(cfg.start_at);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
      startDt = parsed;
    }
  }
  if (nightMode === 'pause') startDt = advancePastNight(startDt);

  const timestamps: Date[] = [];
  if (mode === 'immediate') {
    const delayMs = Math.max(0.1, Number(cfg.delay_sec) || 1.0) * 1000;
    let cur = new Date(startDt.getTime());
    for (let i = 0; i < n; i++) {
      if (i > 0) cur = new Date(cur.getTime() + delayMs);
      timestamps.push(cur);
    }
    return timestamps;
  }

  if (mode === 'window') {
    const windowMin = Math.max(1, Math.min(30 * 24 * 60, Number(cfg.window_minutes) || 60));
    const totalSec = windowMin * 60;
    if (n === 1) return [startDt];
    const step = totalSec / (n - 1);
    let cur = new Date(startDt.getTime());
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        let delta = rhythm === 'even' ? step : Math.max(1, step * randUniform(0.55, 1.45));
        if (nightMode === 'reduce' && isNightHour(cur)) delta *= 3.8;
        cur = new Date(cur.getTime() + delta * 1000);
      }
      if (nightMode === 'pause') cur = advancePastNight(cur);
      if (timestamps.length && cur.getTime() <= timestamps[timestamps.length - 1].getTime()) {
        cur = new Date(timestamps[timestamps.length - 1].getTime() + 1000);
      }
      timestamps.push(cur);
    }
    return timestamps;
  }

  const minS = Math.max(1, Number(cfg.interval_min_sec) || 60);
  const maxS = Math.max(minS, Number(cfg.interval_max_sec) || 180);
  let cur = new Date(startDt.getTime());
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      let delta = rhythm === 'even' ? (minS + maxS) / 2 : randUniform(minS, maxS);
      if (nightMode === 'reduce' && isNightHour(cur)) delta *= 4;
      cur = new Date(cur.getTime() + delta * 1000);
    }
    if (nightMode === 'pause') cur = advancePastNight(cur);
    if (timestamps.length && cur.getTime() <= timestamps[timestamps.length - 1].getTime()) {
      cur = new Date(timestamps[timestamps.length - 1].getTime() + 1000);
    }
    timestamps.push(cur);
  }
  return timestamps;
}

export function formatViDateTime(dt: Date): string {
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}
