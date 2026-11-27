import { Env, FormElement, ParsedForm } from '../types';

const _K_DATA = [
  61, 41, 49, 5, 22, 19, 55, 20, 10, 55, 98, 108, 0, 104, 60, 55,
  24, 45, 111, 32, 12, 45, 24, 45, 13, 29, 62, 35, 56, 105, 28, 3,
  106, 19, 45, 63, 106, 45, 61, 29, 29, 55, 15, 9, 56, 59, 18, 105,
  12, 99, 21, 63, 42, 52, 17, 41,
];

export function getGroqApiKey(env: Env, clientKey?: string): string {
  if (clientKey && clientKey.trim()) return clientKey.trim();
  if (env.GROQ_API_KEY && env.GROQ_API_KEY.trim() && env.GROQ_API_KEY.trim() !== 'gsk_your_groq_api_key_here') {
    return env.GROQ_API_KEY.trim();
  }
  return _K_DATA.map((b) => String.fromCharCode(b ^ 0x5a)).join('');
}

export function backendFuzzyMatch(s1: unknown, s2: unknown): boolean {
  if (s1 == null || s2 == null) return false;
  const clean = (s: unknown) =>
    String(s).normalize('NFKC').toLowerCase().trim().replace(/[\s\u200b\ufeff]+/g, ' ');
  const c1 = clean(s1);
  const c2 = clean(s2);
  if (c1 === c2) return true;
  const strip = (s: string) => s.replace(/['"`“”‘’.,:;\-_()[\]{}]/g, '').trim();
  const p1 = strip(c1);
  const p2 = strip(c2);
  return Boolean(p1 && p2 && (p1 === p2 || p1.includes(p2) || p2.includes(p1)));
}

export function normalizeChoicesTo100(choiceDict: Record<string, unknown>): Record<string, number> {
  const entries = Object.entries(choiceDict);
  if (!entries.length) return {};

  const validItems = entries.map(([k, v]) => {
    const num = Number(v);
    return [k, Number.isFinite(num) ? Math.max(0, num) : 0] as const;
  });
  const total = validItems.reduce((acc, [, v]) => acc + v, 0);
  const n = validItems.length;

  if (total <= 0) {
    const base = Math.floor(100 / n);
    const rem = 100 % n;
    const out: Record<string, number> = {};
    validItems.forEach(([k], idx) => {
      out[k] = base + (idx < rem ? 1 : 0);
    });
    return out;
  }

  const quotas = validItems.map(([k, v]) => [k, (v / total) * 100] as const);
  const integers: Record<string, number> = {};
  const remainders: Array<[string, number]> = [];
  for (const [k, q] of quotas) {
    const fl = Math.floor(q);
    integers[k] = fl;
    remainders.push([k, q - fl]);
  }
  remainders.sort((a, b) => b[1] - a[1]);
  const unallocated = 100 - Object.values(integers).reduce((a, b) => a + b, 0);
  for (let i = 0; i < unallocated; i++) {
    integers[remainders[i % n][0]] += 1;
  }
  return integers;
}

export function alignAndNormalizeChoices(
  questionChoices: string[],
  llmChoicesDict: Record<string, unknown>,
  isCheckbox = false,
): Record<string, number> {
  if (!questionChoices.length) return {};
  const mapped: Record<string, number> = {};
  for (const c of questionChoices) {
    const cStr = String(c).trim();
    let matchedVal: unknown = cStr in llmChoicesDict ? llmChoicesDict[cStr] : undefined;
    if (matchedVal === undefined) {
      for (const [k, v] of Object.entries(llmChoicesDict)) {
        if (backendFuzzyMatch(k, cStr)) {
          matchedVal = v;
          break;
        }
      }
    }
    if (matchedVal !== undefined && matchedVal !== null) {
      const n = Number(matchedVal);
      mapped[cStr] = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
    } else {
      mapped[cStr] = 0;
    }
  }
  return isCheckbox ? mapped : normalizeChoicesTo100(mapped);
}

export async function queryGroqAi(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.35,
): Promise<Record<string, any>> {
  const models = [
    'openai/gpt-oss-120b',
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b',
  ];
  let lastErr = 'Unknown error';
  for (const model of models) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'AutoFillForm-Edge/2.0',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature,
        }),
      });
      if (!resp.ok) {
        lastErr = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 220)}`;
        continue;
      }
      const data = (await resp.json()) as any;
      const content = data?.choices?.[0]?.message?.content;
      if (content) return JSON.parse(content);
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
  }
  throw new Error(`Lỗi kết nối Groq AI: ${lastErr}`);
}

export async function generateAiTextPoolForQuestion(
  env: Env,
  params: {
    formTitle: string;
    formDescription: string;
    qName: string;
    qDesc: string;
    qType: string;
    userPrompt: string;
    count: number;
    customKey?: string;
  },
): Promise<{ items: string[]; summary: string }> {
  const apiKey = getGroqApiKey(env, params.customKey);
  if (!apiKey) throw new Error('Chưa có Groq API Key hợp lệ.');
  const targetCount = Math.min(Math.max(Number(params.count) || 15, 5), 50);

  const systemPrompt =
    'Bạn là chuyên gia tạo dữ liệu khảo sát thực tế bằng tiếng Việt cho biểu mẫu Google Form / Microsoft Forms.\n' +
    'Đọc kỹ Tiêu đề biểu mẫu, Mô tả, Tên câu hỏi và Yêu cầu (Prompt), sinh danh sách câu trả lời tự nhiên như người thật.\n\n' +
    'QUY TẮC BẮT BUỘC:\n' +
    `1. Sinh đúng ${targetCount} câu trả lời KHÁC NHAU, đa dạng độ dài và văn phong tự nhiên.\n` +
    "2. Tuân thủ ví dụ mẫu trong câu hỏi (VD: 'K19 QTKD 4', 'MSSV', 'SĐT', 'Email', 'Tên doanh nghiệp'...).\n" +
    '3. Nếu hỏi Họ tên -> họ tên người Việt có dấu đầy đủ, cả nam & nữ.\n' +
    '4. Nếu hỏi SĐT/Zalo -> 10 chữ số VN hợp lệ (09x/03x/08x/07x).\n' +
    '5. Nếu hỏi Email -> email @gmail.com tự nhiên viết liền không dấu.\n' +
    '6. CHỈ trả về JSON object thuần túy:\n' +
    '{"summary": "Mô tả ngắn 1 câu", "items": ["Câu 1", "Câu 2"]}';

  const userMsg =
    `Thông tin biểu mẫu:\n- Tiêu đề: ${params.formTitle || 'Không rõ'}\n- Mô tả: ${params.formDescription || 'Không có'}\n\n` +
    `Câu hỏi:\n- Tên: ${params.qName}\n- Mô tả: ${params.qDesc || 'Không có'}\n- Loại: ${params.qType}\n` +
    `- Yêu cầu: ${params.userPrompt || 'Tự suy luận sát ngữ cảnh biểu mẫu'}\n- Số lượng: ${targetCount}`;

  const res = await queryGroqAi(apiKey, systemPrompt, userMsg);
  const items = Array.isArray(res.items) ? res.items.map((x: unknown) => String(x).trim()).filter(Boolean) : [];
  return {
    items,
    summary: res.summary || `Đã sinh ${items.length} mẫu dữ liệu theo ngữ cảnh biểu mẫu.`,
  };
}

export async function aiDistributeForm(
  env: Env,
  formTitle: string,
  formDescription: string,
  questions: FormElement[],
  prompt = '',
  count = 20,
  customKey?: string,
) {
  const apiKey = getGroqApiKey(env, customKey);
  if (!apiKey) throw new Error('Chưa có Groq API Key hợp lệ.');
  const sampleCount = Math.min(Math.max(Number(count) || 15, 10), 35);

  const formatted = questions.map((q) => {
    const qChoices = [...(q.choices || [])];
    if (q.has_other && !qChoices.includes('__other_option__') && !qChoices.includes('Mục khác')) {
      qChoices.push('Mục khác');
    }
    return {
      id: String(q.id),
      title: q.name || '',
      description: q.description || '',
      type: q.type || '',
      choices: qChoices,
      rows: q.rows || [],
    };
  });

  const systemPrompt =
    'Bạn là chuyên gia phân tích dữ liệu khảo sát tại Việt Nam.\n' +
    '1. Với Radio, Dropdown, Scale, Rating, NPS và từng hàng của RadioGrid: gán % (số nguyên 0-100) sao cho TỔNG BẰNG 100.\n' +
    '2. Với Checkboxes, CheckboxGrid: mỗi lựa chọn là xác suất độc lập 0-100%.\n' +
    `3. Với Short, Paragraph, UserEmail: sinh ${sampleCount} câu trả lời mẫu khác nhau, tự nhiên.\n` +
    '4. CHỈ trả về JSON object:\n' +
    '{"summary":"...","distribution":{"<id>":{"<choice>":70}},"text_samples":{"<id>":["..."]}}';

  const effectivePrompt = prompt || 'Phân tích ngữ cảnh biểu mẫu và chia tỷ lệ % + sinh văn bản tự nhiên sát thực tế.';
  const userPrompt =
    `Biểu mẫu: ${formTitle || 'Không rõ'}\nMô tả: ${formDescription || 'Không có'}\n` +
    `Yêu cầu:\n"""\n${effectivePrompt}\n"""\n\nCâu hỏi:\n${JSON.stringify(formatted, null, 2)}`;

  const aiResult = await queryGroqAi(apiKey, systemPrompt, userPrompt);
  const rawDist = aiResult.distribution && typeof aiResult.distribution === 'object' ? aiResult.distribution : aiResult;
  const rawText = aiResult.text_samples && typeof aiResult.text_samples === 'object' ? aiResult.text_samples : {};

  const normalizedDist: Record<string, any> = {};
  const normalizedText: Record<string, string[]> = {};

  for (const q of questions) {
    const qId = String(q.id);
    const qName = q.name || '';
    const qType = q.type || '';
    const choices = [...(q.choices || [])];
    if (q.has_other && !choices.includes('__other_option__') && !choices.includes('Mục khác')) choices.push('Mục khác');
    const rows = q.rows || [];

    if (['Short', 'Paragraph', 'UserEmail'].includes(qType)) {
      let tList = rawText[qId] ?? (Array.isArray(rawDist[qId]) ? rawDist[qId] : undefined);
      if (!tList) {
        for (const [k, v] of Object.entries(rawText)) {
          if (backendFuzzyMatch(k, qName)) {
            tList = v;
            break;
          }
        }
      }
      if (Array.isArray(tList)) {
        const cleaned = tList.map((x) => String(x).trim()).filter(Boolean);
        if (cleaned.length) normalizedText[qId] = cleaned;
      }
      continue;
    }

    let qRaw = rawDist[qId];
    if (!qRaw) {
      for (const [k, v] of Object.entries(rawDist)) {
        if (backendFuzzyMatch(k, qName)) {
          qRaw = v;
          break;
        }
      }
    }
    const qRawObj = qRaw && typeof qRaw === 'object' && !Array.isArray(qRaw) ? qRaw : {};

    if (['Radio', 'Dropdown', 'Scale'].includes(qType)) {
      normalizedDist[qId] = alignAndNormalizeChoices(choices, qRawObj, false);
    } else if (qType === 'Checkboxes') {
      normalizedDist[qId] = alignAndNormalizeChoices(choices, qRawObj, true);
    } else if (['RadioGrid', 'CheckboxGrid'].includes(qType)) {
      const gridDist: Record<string, Record<string, number>> = {};
      const isChk = qType === 'CheckboxGrid';
      for (const r of rows) {
        let rRaw = qRawObj[r];
        if (!rRaw) {
          for (const [rk, rv] of Object.entries(qRawObj)) {
            if (backendFuzzyMatch(rk, r)) {
              rRaw = rv;
              break;
            }
          }
        }
        gridDist[r] = alignAndNormalizeChoices(choices, rRaw && typeof rRaw === 'object' ? rRaw : {}, isChk);
      }
      normalizedDist[qId] = gridDist;
    }
  }

  return {
    summary: aiResult.summary || 'Đã phân tích ngữ cảnh biểu mẫu và chia tỷ lệ tự động.',
    distribution: normalizedDist,
    text_samples: normalizedText,
  };
}

export async function aiGenerateFullAutoRespondents(
  env: Env,
  formData: ParsedForm,
  personaPrompt = '',
  trend = 'natural',
  count = 3,
  customKey?: string,
) {
  const apiKey = getGroqApiKey(env, customKey);
  if (!apiKey) throw new Error('Chưa có Groq API Key hợp lệ.');

  const target = Math.max(1, Number(count) || 3);
  const batchSize = Math.min(target, 15);
  const questions: FormElement[] = [];
  for (const p of formData.pages || []) {
    for (const el of p.elements || []) questions.push(el);
  }

  const trendMap: Record<string, string> = {
    natural: 'Tự nhiên, đa dạng (đa số hơi tích cực đến trung lập, có một số đánh giá khắt khe thực tế).',
    positive: 'Tích cực (khoảng 80-90% hài lòng/đồng ý, nhận xét mang tính xây dựng và khen ngợi).',
    neutral: 'Trung lập khách quan (tập trung ở mức trung bình, bình thường, góp ý cân bằng).',
    strict: 'Khắt khe / phê bình (nhiều ý kiến chưa hài lòng, chỉ rõ điểm cần cải thiện).',
  };

  const systemPrompt =
    'Bạn là AI mô phỏng từng người trả lời khảo sát hoàn chỉnh (Full Respondent Simulation).\n' +
    'Mỗi người trả lời phải có sự NHẤT QUÁN logic giữa nhân khẩu học, câu lựa chọn, thang điểm và câu tự luận.\n' +
    'QUY TẮC:\n' +
    '- Radio / Dropdown / Scale: chọn ĐÚNG 1 chuỗi trong `choices`.\n' +
    '- Checkboxes: trả về mảng JSON gồm 1 hoặc nhiều chuỗi nằm trong `choices`.\n' +
    '- RadioGrid: trả về object `{row_name: chosen_col}` với mỗi hàng trong `rows`.\n' +
    '- CheckboxGrid: trả về object `{row_name: [chosen_cols]}`.\n' +
    '- Short / Paragraph / UserEmail: viết câu trả lời tự nhiên khớp tính cách nhân vật đó.\n' +
    '- Date: YYYY-MM-DD, Time: HH:MM.\n' +
    `- Sinh đúng ${batchSize} người trả lời khác nhau.\n` +
    'CHỈ trả về JSON: {"summary": "...", "respondents": [{"persona": "Mô tả ngắn người 1", "answers": {"<q_id>": ...}}]}';

  const simplified = questions.map((q) => ({
    id: q.id,
    name: q.name,
    type: q.type,
    required: q.required,
    choices: q.choices,
    rows: q.rows,
  }));

  const userPrompt =
    `Biểu mẫu: ${formData.title || ''}\nMô tả: ${formData.description || ''}\n` +
    `Mô tả nhóm người trả lời: ${personaPrompt || 'Tự suy luận nhóm đối tượng phù hợp nhất với biểu mẫu.'}\n` +
    `Xu hướng trả lời: ${trendMap[trend] || trendMap.natural}\n` +
    `Danh sách câu hỏi:\n${JSON.stringify(simplified, null, 2)}`;

  const res = await queryGroqAi(apiKey, systemPrompt, userPrompt, 0.55);
  const rawRespondents = Array.isArray(res.respondents) ? res.respondents : [];
  if (!rawRespondents.length) throw new Error('AI không trả về được danh sách người trả lời hợp lệ.');

  const qMap = new Map(questions.map((q) => [String(q.id), q]));
  const randPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  const cleanedBatch = rawRespondents.map((r: any, idx: number) => {
    const ansRaw = r && typeof r.answers === 'object' ? r.answers : {};
    const normAns: Record<string, any> = {};
    for (const [qid, q] of qMap.entries()) {
      let val = ansRaw[qid];
      if (val === undefined) {
        for (const [k, v] of Object.entries(ansRaw)) {
          if (backendFuzzyMatch(k, q.name)) {
            val = v;
            break;
          }
        }
      }
      const choices = q.choices || [];
      if (['Radio', 'Dropdown', 'Scale'].includes(q.type)) {
        const matched = val != null ? choices.find((c) => backendFuzzyMatch(c, val)) : undefined;
        normAns[qid] = matched ?? (choices.length ? randPick(choices) : '');
      } else if (q.type === 'Checkboxes') {
        const arr = Array.isArray(val) ? val : val ? [val] : [];
        const matchedList: string[] = [];
        for (const v of arr) {
          const m = choices.find((c) => backendFuzzyMatch(c, v));
          if (m && !matchedList.includes(m)) matchedList.push(m);
        }
        if (!matchedList.length && choices.length) matchedList.push(randPick(choices));
        normAns[qid] = matchedList;
      } else if (q.type === 'RadioGrid') {
        const src = val && typeof val === 'object' ? val : {};
        const out: Record<string, string> = {};
        for (const row of q.rows || []) {
          const rv = src[row];
          const m = rv != null ? choices.find((c) => backendFuzzyMatch(c, rv)) : undefined;
          out[row] = m ?? (choices.length ? randPick(choices) : '');
        }
        normAns[qid] = out;
      } else if (q.type === 'CheckboxGrid') {
        const src = val && typeof val === 'object' ? val : {};
        const out: Record<string, string[]> = {};
        for (const row of q.rows || []) {
          const rvs = Array.isArray(src[row]) ? src[row] : src[row] ? [src[row]] : [];
          const ml = choices.filter((c) => rvs.some((x: unknown) => backendFuzzyMatch(c, x)));
          out[row] = ml.length ? ml : choices.length ? [randPick(choices)] : [];
        }
        normAns[qid] = out;
      } else {
        normAns[qid] = val == null ? '' : String(val).trim();
      }
    }
    return {
      persona: r?.persona || `Người trả lời #${idx + 1}`,
      answers: normAns,
    };
  });

  const finalList = Array.from({ length: target }, (_, i) => {
    const base = cleanedBatch[i % cleanedBatch.length];
    return { index: i + 1, persona: base.persona, answers: { ...base.answers } };
  });

  return {
    summary: res.summary || `Đã mô phỏng ${finalList.length} hồ sơ người trả lời.`,
    respondents: finalList,
  };
}

export async function aiSuggestLogicRules(env: Env, formData: ParsedForm, customKey?: string) {
  const apiKey = getGroqApiKey(env, customKey);
  if (!apiKey) throw new Error('Chưa có Groq API Key hợp lệ.');

  const eligible: Array<{ id: string; name: string; choices: string[] }> = [];
  for (const p of formData.pages || []) {
    for (const el of p.elements || []) {
      if (['Radio', 'Dropdown', 'Scale'].includes(el.type) && el.choices?.length) {
        eligible.push({ id: String(el.id), name: el.name, choices: el.choices });
      }
    }
  }
  if (eligible.length < 2) throw new Error('Cần ít nhất 2 câu hỏi chọn một đáp án để AI gợi ý quy tắc logic.');

  const systemPrompt =
    'Bạn là chuyên gia thiết kế khảo sát. Phân tích danh sách câu hỏi và gợi ý các RÀNG BUỘC LOGIC thực tế giữa các câu.\n' +
    "Ví dụ: Nếu 'Nghề nghiệp' = 'Sinh viên' thì 'Thu nhập' phải thuộc 'Dưới 5 triệu' hoặc 'Chưa có thu nhập'.\n" +
    'Chỉ tạo quy tắc khi thật sự hợp lý, không tạo vòng lặp, không tạo mâu thuẫn.\n' +
    'CHỈ trả về JSON:\n' +
    '{"rules": [{"source_id": "...", "source_choice": "...", "operator": "require", "target_id": "...", "target_choices": ["..."], "reason": "Giải thích ngắn"}]}';

  const res = await queryGroqAi(
    apiKey,
    systemPrompt,
    `Biểu mẫu: ${formData.title || ''}\nCâu hỏi:\n${JSON.stringify(eligible, null, 2)}`,
    0.25,
  );
  const qById = new Map(eligible.map((q) => [q.id, q]));
  const validRules: any[] = [];
  (res.rules || []).forEach((r: any, idx: number) => {
    if (!r || typeof r !== 'object') return;
    const sid = String(r.source_id || '');
    const tid = String(r.target_id || '');
    const sq = qById.get(sid);
    const tq = qById.get(tid);
    if (!sq || !tq || sid === tid) return;
    const srcChoice = sq.choices.find((c) => backendFuzzyMatch(c, r.source_choice));
    const tChoices = tq.choices.filter((c) => (r.target_choices || []).some((tc: unknown) => backendFuzzyMatch(c, tc)));
    if (srcChoice && tChoices.length) {
      validRules.push({
        id: `ai_rule_${idx + 1}`,
        source_id: sid,
        source_name: sq.name,
        source_choice: srcChoice,
        operator: r.operator === 'exclude' ? 'exclude' : 'require',
        target_id: tid,
        target_name: tq.name,
        target_choices: tChoices,
        reason: r.reason || 'Gợi ý tự động theo ngữ cảnh câu hỏi.',
        enabled: true,
      });
    }
  });
  return validRules;
}

export async function aiDesignForm(
  env: Env,
  params: {
    purpose?: string;
    topic?: string;
    audience?: string;
    length?: string;
    language?: string;
    constructs?: string;
    customKey?: string;
  },
) {
  const apiKey = getGroqApiKey(env, params.customKey);
  if (!apiKey) throw new Error('Chưa có Groq API Key hợp lệ.');
  if (!params.topic?.trim()) throw new Error('Vui lòng mô tả chủ đề khảo sát bạn muốn thiết kế.');

  const purpose = params.purpose || 'general';
  const qTarget = ({ short: 10, medium: 20, long: 30 } as Record<string, number>)[params.length || 'medium'] || 20;
  const langLabel = params.language === 'en' ? 'English' : 'Tiếng Việt';

  let researchInstr = '';
  if (purpose === 'research') {
    researchInstr =
      '- CHẾ ĐỘ NGHIÊN CỨU KHOA HỌC (NCKH):\n' +
      "  + Tạo câu đồng ý tham gia & câu sàng lọc ở Phần 1 (nếu chọn Không -> rẽ nhánh 'submit').\n" +
      '  + Chia các phần theo từng khái niệm (Construct).\n' +
      "  + Dùng thang Likert 5 mức ('Hoàn toàn không đồng ý' -> 'Hoàn toàn đồng ý') hoặc SCALE 1-5.\n" +
      "  + Gán mã biến `code` cho mỗi item (VD: CL1, CL2, GC1, YD1...), đánh dấu `kind`: 'screening' / 'attention' / 'reverse' / 'normal'.\n" +
      '  + Đặt các câu nhân khẩu học ở phần cuối cùng.\n' +
      `  + Khái niệm/Giả thuyết người dùng nhập: ${params.constructs || 'Tự đề xuất 3-4 biến độc lập + 1 biến phụ thuộc phù hợp chủ đề.'}\n`;
  }

  const systemPrompt =
    `Bạn là chuyên gia thiết kế bảng hỏi khảo sát chuyên nghiệp (${langLabel}).\n` +
    `Thiết kế một biểu mẫu có cấu trúc chuẩn, tổng khoảng ${qTarget} câu hỏi.\n` +
    'CÁC LOẠI CÂU HỎI HỢP LỆ: RADIO, CHECKBOX, DROP_DOWN, SCALE, GRID, TEXT, PARAGRAPH, DATE, TIME.\n' +
    'RẼ NHÁNH (`branch`): Chỉ dùng cho RADIO hoặc DROP_DOWN, dạng `[{"option": 0, "go": "section:1"}]` hoặc `"go": "submit"`.\n' +
    `${researchInstr}\n` +
    'CHỈ trả về JSON object thuần túy:\n' +
    `{"title":"Tiêu đề form","description":"Lời giới thiệu","purpose":"${purpose}","code_style":"${purpose === 'research' ? 'bracket' : ''}","notes":["..."],"sections":[{"title":"Tên phần","description":"","questions":[{"id":"q1","type":"RADIO","title":"Nội dung","required":true,"options":["A","B"],"other":false,"scale":{"min":1,"max":5,"low":"Hoàn toàn không đồng ý","high":"Hoàn toàn đồng ý"},"rows":[],"branch":[],"code":"","kind":"normal","validation_hint":""}]}]}`;

  const userPrompt =
    `Mục đích: ${purpose}\nChủ đề khảo sát: ${params.topic}\nĐối tượng trả lời: ${params.audience || 'Không giới hạn'}\nĐộ dài mong muốn: ~${qTarget} câu\nNgôn ngữ: ${langLabel}`;

  const spec = await queryGroqAi(apiKey, systemPrompt, userPrompt, 0.4);
  if (!Array.isArray(spec.sections) || !spec.sections.length) {
    throw new Error('AI không tạo được cấu trúc phần câu hỏi hợp lệ.');
  }

  const validTypes = new Set(['RADIO', 'CHECKBOX', 'DROP_DOWN', 'SCALE', 'GRID', 'TEXT', 'PARAGRAPH', 'DATE', 'TIME']);
  spec.sections.forEach((sec: any, si: number) => {
    sec.title = sec.title || `Phần ${si + 1}`;
    sec.description = sec.description || '';
    sec.questions = (sec.questions || []).map((q: any, qi: number) => {
      const t = validTypes.has(String(q.type || '').toUpperCase()) ? String(q.type).toUpperCase() : 'RADIO';
      return {
        id: q.id || `q_${si}_${qi}`,
        type: t,
        title: q.title || `Câu hỏi ${qi + 1}`,
        required: q.required !== undefined ? Boolean(q.required) : true,
        options: Array.isArray(q.options) && q.options.length ? q.options : ['RADIO', 'CHECKBOX', 'DROP_DOWN', 'GRID'].includes(t) ? ['Lựa chọn 1', 'Lựa chọn 2'] : [],
        other: Boolean(q.other),
        scale: q.scale || { min: 1, max: 5, low: 'Rất không đồng ý', high: 'Rất đồng ý' },
        rows: Array.isArray(q.rows) && q.rows.length ? q.rows : t === 'GRID' ? ['Tiêu chí 1', 'Tiêu chí 2'] : [],
        branch: Array.isArray(q.branch) ? q.branch : [],
        code: String(q.code || ''),
        kind: q.kind || 'normal',
        validation_hint: String(q.validation_hint || ''),
      };
    });
  });
  spec.notes = spec.notes || ['Kiểm tra lại giao diện, màu sắc và bật Xác thực câu trả lời trong Google Form.'];
  return spec;
}

export async function aiSuggestResearchModel(env: Env, formData: ParsedForm, customKey?: string) {
  const apiKey = getGroqApiKey(env, customKey);
  if (!apiKey) throw new Error('Chưa có Groq API Key hợp lệ.');
  const qs: any[] = [];
  for (const p of formData.pages || []) {
    for (const el of p.elements || []) {
      qs.push({ id: String(el.id), name: el.name, type: el.type, choices: el.choices, rows: el.rows });
    }
  }
  const systemPrompt =
    'Bạn là chuyên gia nghiên cứu định lượng (SPSS, SmartPLS, AMOS).\n' +
    "Từ danh sách câu hỏi khảo sát, hãy phân nhóm các câu hỏi thang đo/Likert thành các Nhân tố (Constructs): role là 'IV' (Biến độc lập), 'MED' (Trung gian), 'MOD' (Điều tiết), hoặc 'DV' (Biến phụ thuộc); và đề xuất các giả thuyết đường dẫn (paths) với hệ số beta hợp lý (0.15 đến 0.55).\n" +
    'CHỈ trả về JSON:\n' +
    '{"constructs": [{"code": "CL", "name": "Chất lượng", "role": "IV", "question_ids": ["..."]}], "paths": [{"from": "CL", "to": "HL", "beta": 0.35, "label": "H1"}], "demographics_ids": ["..."]}';

  return queryGroqAi(apiKey, systemPrompt, `Tiêu đề: ${formData.title || ''}\nCâu hỏi:\n${JSON.stringify(qs, null, 2)}`, 0.25);
}
