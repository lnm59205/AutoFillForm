import { FormElement, FormPage, ParsedForm } from '../types';

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randChoice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ==============================================================================
// 1. VIETNAMESE REALISTIC DATA POOLS
// ==============================================================================

const VI_SURNAMES = [
  'nguyen', 'tran', 'le', 'pham', 'hoang', 'huynh', 'phan', 'vu', 'vo',
  'dang', 'bui', 'do', 'ho', 'ngo', 'duong', 'ly', 'dinh', 'doan', 'lam',
  'trinh', 'mai', 'dao', 'cao', 'ha', 'luong', 'thai', 'ta', 'chau', 'phung',
];
const VI_MIDDLE_NAMES = [
  'van', 'thi', 'duc', 'hai', 'xuan', 'thu', 'minh', 'quang', 'ngoc',
  'huu', 'anh', 'thanh', 'phuong', 'quoc', 'gia', 'bao', 'hoang', 'dinh',
  'cong', 'trong', 'tien', 'viet', 'chi', 'khanh', 'phuc', 'huong', 'tu',
];
const VI_MALE_NAMES = ['nam', 'duc', 'huy', 'tuan', 'long', 'hung', 'thang', 'trung', 'dung', 'dat', 'khoa', 'kien', 'tung', 'hai', 'quan', 'hoang', 'bach', 'binh', 'cuong', 'hieu', 'loc', 'nghia', 'nhan', 'phong', 'sang', 'son', 'tai', 'thuan', 'tri', 'truong', 'viet', 'vinh'];
const VI_FEMALE_NAMES = ['anh', 'linh', 'mai', 'trang', 'huong', 'thao', 'ha', 'ngan', 'quynh', 'lan', 'chi', 'vy', 'nhung', 'uyen', 'yen', 'hang', 'ngoc', 'tram', 'chau', 'diem', 'diep', 'duyen', 'giang', 'hoa', 'huyen', 'khue', 'loan', 'ly', 'nga', 'oanh', 'phuong', 'thanh', 'thuy', 'tien', 'truc', 'van'];
const VI_EMAIL_DOMAINS = ['gmail.com', 'gmail.com', 'gmail.com', 'gmail.com', 'outlook.com', 'yahoo.com'];

const VI_SURNAMES_ACC = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Đoàn', 'Lâm', 'Trịnh', 'Mai', 'Đào', 'Cao', 'Hà', 'Lương'];
const VI_MALE_MID_ACC = ['Văn', 'Đức', 'Minh', 'Quang', 'Hữu', 'Thành', 'Quốc', 'Gia', 'Bảo', 'Hoàng', 'Đình', 'Công', 'Trọng', 'Tiến', 'Việt', 'Khánh', 'Phúc', 'Tuấn', 'Anh'];
const VI_FEMALE_MID_ACC = ['Thị', 'Thu', 'Ngọc', 'Phương', 'Thanh', 'Khánh', 'Hồng', 'Mai', 'Thảo', 'Bích', 'Kim', 'Mỹ', 'Bảo', 'Thùy', 'Diệu', 'Quỳnh', 'Nhật', 'Ánh', 'Lan'];
const VI_MALE_ACC = ['Nam', 'Đức', 'Huy', 'Tuấn', 'Long', 'Hùng', 'Thắng', 'Trung', 'Dũng', 'Đạt', 'Khoa', 'Kiên', 'Tùng', 'Hải', 'Quân', 'Hoàng', 'Bách', 'Bình', 'Cường', 'Hiếu', 'Lộc', 'Nghĩa', 'Nhân', 'Phong', 'Sơn', 'Tài', 'Trí', 'Vinh'];
const VI_FEMALE_ACC = ['Anh', 'Linh', 'Mai', 'Trang', 'Hương', 'Thảo', 'Hà', 'Ngân', 'Quỳnh', 'Lan', 'Chi', 'Vy', 'Nhung', 'Uyên', 'Yến', 'Hằng', 'Ngọc', 'Trâm', 'Châu', 'Diễm', 'Duyên', 'Giang', 'Hoa', 'Huyền', 'Ly', 'Nga', 'Phương', 'Thủy', 'Tiên', 'Vân'];

export function generateViPhone(): string {
  const prefixes = ['090', '091', '093', '094', '096', '097', '098', '086', '088', '089', '032', '033', '034', '035', '036', '037', '038', '039', '070', '076', '077', '078', '079', '081', '082', '083', '084', '085'];
  let suffix = '';
  for (let i = 0; i < 7; i++) suffix += String(randInt(0, 9));
  return `${randChoice(prefixes)}${suffix}`;
}

export function generateUniqueEmailPool(count: number): string[] {
  const pool: string[] = [];
  const used = new Set<string>();
  let lastSur = '';
  let lastName = '';
  let maleTurn = true;

  for (let idx = 0; idx < count; idx++) {
    let chosen = '';
    for (let a = 0; a < 500; a++) {
      const sur = randChoice(VI_SURNAMES.filter((s) => s !== lastSur));
      const mid = randChoice(VI_MIDDLE_NAMES);
      const list = maleTurn ? VI_MALE_NAMES : VI_FEMALE_NAMES;
      const name = randChoice(list.filter((n) => n !== lastName));
      const domain = randChoice(VI_EMAIL_DOMAINS);
      const by = randInt(1994, 2006);
      const sy = String(by).slice(2);
      const ddmm = `${String(randInt(1, 28)).padStart(2, '0')}${String(randInt(1, 12)).padStart(2, '0')}`;
      const style = idx % 6;
      const user =
        style === 0 ? `${sur}${mid}${name}${sy}` :
        style === 1 ? `${name}${sur}${by}` :
        style === 2 ? `${sur}${name}${ddmm}` :
        style === 3 ? `${name}${mid}${sur}${sy}` :
        style === 4 ? `${sur}${name}${randInt(11, 999)}` :
        `${name}${sur[0]}${mid[0]}${sy}`;
      const email = `${user}@${domain}`;
      if (!used.has(email)) {
        used.add(email);
        chosen = email;
        lastSur = sur;
        lastName = name;
        maleTurn = !maleTurn;
        break;
      }
    }
    if (!chosen) {
      chosen = `user${idx}${randInt(10000, 99999)}@gmail.com`;
      used.add(chosen);
    }
    pool.push(chosen);
  }
  return pool;
}

export function generateUniqueViNamePool(count: number): string[] {
  const pool: string[] = [];
  const used = new Set<string>();
  let maleTurn = true;
  let lastSur = '';
  let lastName = '';
  for (let i = 0; i < count; i++) {
    let chosen = '';
    for (let a = 0; a < 300; a++) {
      const sur = randChoice(VI_SURNAMES_ACC.filter((s) => s !== lastSur));
      const mid = randChoice(maleTurn ? VI_MALE_MID_ACC : VI_FEMALE_MID_ACC);
      const name = randChoice((maleTurn ? VI_MALE_ACC : VI_FEMALE_ACC).filter((n) => n !== lastName));
      const full = `${sur} ${mid} ${name}`;
      if (!used.has(full)) {
        used.add(full);
        chosen = full;
        lastSur = sur;
        lastName = name;
        maleTurn = !maleTurn;
        break;
      }
    }
    pool.push(chosen || `${randChoice(VI_SURNAMES_ACC)} ${randChoice(VI_MALE_MID_ACC)} ${randChoice(VI_MALE_ACC)}`);
  }
  return pool;
}

export function generateUniquePhonePool(count: number): string[] {
  const pool: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let p = generateViPhone();
    for (let a = 0; a < 100 && used.has(p); a++) p = generateViPhone();
    used.add(p);
    pool.push(p);
  }
  return pool;
}

export function generateUniqueMssvPool(count: number): string[] {
  const pool: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let c = '';
    for (let a = 0; a < 100; a++) {
      c = `${randChoice(['20', '21', '22', '23', '24'])}${randChoice(['01', '02', '03', '04', '05', '07', '11'])}${String(randInt(100, 9999)).padStart(4, '0')}`;
      if (!used.has(c)) break;
    }
    used.add(c);
    pool.push(c);
  }
  return pool;
}

export function generateClassCodePool(count: number): string[] {
  const cohorts = ['K17', 'K18', 'K19', 'K20', 'K21'];
  const majors = ['QTKD', 'CNTT', 'Kế toán', 'Marketing', 'Tài chính - Ngân hàng', 'Ngôn ngữ Anh', 'Logistics', 'Thương mại điện tử'];
  return Array.from({ length: count }, () => `${randChoice(cohorts)} ${randChoice(majors)} ${randInt(1, 5)}`);
}

export function generateViAddressPool(count: number): string[] {
  const streets = ['Nguyễn Trãi', 'Cầu Giấy', 'Xuân Thủy', 'Giải Phóng', 'Lê Văn Lương', 'Tây Sơn', 'Cách Mạng Tháng 8', 'Nguyễn Huệ', 'Lê Lợi', 'Điện Biên Phủ'];
  const cities = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'];
  return Array.from({ length: count }, () => `Số ${randInt(10, 350)} ${randChoice(streets)}, ${randChoice(cities)}`);
}

export function parseCustomListValues(rawText: unknown): string[] {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].includes(';')) {
    return lines[0].split(';').map((s) => s.trim()).filter(Boolean);
  }
  return lines;
}

// ==============================================================================
// 2. PLATFORM DETECTION & URL CLEANING
// ==============================================================================

export function detectPlatform(url: string): 'google' | 'microsoft' {
  const u = (url || '').toLowerCase();
  if (u.includes('forms.office.com') || u.includes('forms.cloud.microsoft') || u.includes('forms.microsoft.com')) {
    return 'microsoft';
  }
  return 'google';
}

export function cleanGoogleFormUrl(url: string): string {
  if (!url) return url;
  const u = url.trim();
  const me = u.match(/\/forms\/d\/e\/([^/?#\s]+)/);
  if (me) return `https://docs.google.com/forms/d/e/${me[1]}/viewform`;
  const md = u.match(/\/forms\/d\/([^/?#\s]+)/);
  if (md) return `https://docs.google.com/forms/d/${md[1]}/viewform`;
  return u;
}

// ==============================================================================
// 3. PURE-EDGE GOOGLE FORMS PARSER & SUBMITTER (NO PYTHON NEEDED)
// ==============================================================================

const GOOGLE_TYPE_MAP: Record<number, string> = {
  0: 'Short',
  1: 'Paragraph',
  2: 'Radio',
  3: 'Dropdown',
  4: 'Checkboxes',
  5: 'Scale',
  7: 'Grid',
  9: 'Date',
  10: 'Time',
  18: 'Scale', // Rating
};

const HEADERS_BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
};

export async function parseGoogleForm(rawUrl: string): Promise<ParsedForm> {
  const cleaned = cleanGoogleFormUrl(rawUrl);
  const resp = await fetch(cleaned, { headers: HEADERS_BROWSER, redirect: 'follow' });
  const finalUrl = resp.url || cleaned;
  if (finalUrl.includes('accounts.google.com')) {
    throw new Error('Biểu mẫu này yêu cầu đăng nhập tài khoản Google (Giới hạn 1 lần trả lời).');
  }
  const html = await resp.text();
  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (!m) {
    throw new Error('Không đọc được cấu trúc biểu mẫu Google Form. Hãy kiểm tra lại link công khai.');
  }

  const fbData = JSON.parse(m[1]) as any[];
  const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/);
  const fbzx = fbzxMatch ? fbzxMatch[1] : '';

  const formMeta = Array.isArray(fbData[1]) ? fbData[1] : [];
  const description = String(formMeta[0] || '');
  const items: any[] = Array.isArray(formMeta[1]) ? formMeta[1] : [];
  const title = String(formMeta[8] || fbData[3] || 'Google Form');

  // Check if form collects responder email (1 = verified, 2 = responder input)
  const emailMode = Array.isArray(formMeta[10]) ? formMeta[10][4] : 0;
  const requiresSignin = emailMode === 1 || html.includes('requires_signin') && html.includes('accounts.google.com');

  // First pass: map section IDs -> page indices
  const pageIdToIdx = new Map<string, number>();
  let secCount = 0;
  for (const item of items) {
    if (Array.isArray(item) && item[3] === 8) {
      secCount += 1;
      pageIdToIdx.set(String(item[0]), secCount);
    }
  }

  const pages: FormPage[] = [
    { index: 0, title: 'Trang 1', description: '', after_next_page: 'next', elements: [] },
  ];

  // If responder email input mode (emailMode === 2), prepend UserEmail element
  if (emailMode === 2) {
    pages[0].elements.push({
      id: '__emailAddress__',
      name: 'Email',
      description: '',
      type: 'UserEmail',
      required: true,
      choices: [],
      has_other: false,
      rows: [],
    });
  }

  let curPageIdx = 0;
  let hasBranching = false;

  for (const item of items) {
    if (!Array.isArray(item) || item.length < 4) continue;
    const itemType = item[3];
    if (itemType === 8) {
      // Section break
      const rawNav = item.length > 5 ? item[5] : null;
      if (rawNav === -1) {
        pages[curPageIdx].after_next_page = 'submit';
        hasBranching = true;
      } else if (rawNav != null && pageIdToIdx.has(String(rawNav))) {
        pages[curPageIdx].after_next_page = `section:${pageIdToIdx.get(String(rawNav))}`;
        hasBranching = true;
      }
      curPageIdx += 1;
      pages.push({
        index: curPageIdx,
        title: String(item[1] || `Trang ${curPageIdx + 1}`),
        description: String(item[2] || ''),
        after_next_page: 'next',
        elements: [],
      });
      continue;
    }

    const mappedBase = GOOGLE_TYPE_MAP[itemType];
    if (!mappedBase) continue; // Skip static text/image/video items (6, 11, etc.)
    const qMeta = Array.isArray(item[4]) ? item[4] : [];
    if (!qMeta.length) continue;

    const qName = String(item[1] || 'Câu hỏi không có tiêu đề');
    const qDesc = String(item[2] || '');

    if (mappedBase === 'Grid') {
      const firstSub = qMeta[0] || [];
      const cols = Array.isArray(firstSub[1]) ? firstSub[1].map((o: any) => String(o[0])).filter(Boolean) : [];
      const rows: string[] = [];
      const rowIds: string[] = [];
      let isMultiGrid = false;
      let isReq = false;
      for (const sub of qMeta) {
        if (!Array.isArray(sub)) continue;
        rowIds.push(String(sub[0]));
        rows.push(String(sub[3]?.[0] || `Hàng ${rows.length + 1}`));
        if (sub[2]) isReq = true;
        if (sub[11]?.[0] === 1) isMultiGrid = true;
      }
      pages[curPageIdx].elements.push({
        id: rowIds[0] || String(item[0]),
        name: qName,
        description: qDesc,
        type: isMultiGrid ? 'CheckboxGrid' : 'RadioGrid',
        required: isReq,
        choices: cols,
        has_other: false,
        rows,
        row_ids: rowIds,
      });
      continue;
    }

    const sub = qMeta[0];
    if (!Array.isArray(sub)) continue;
    const eid = String(sub[0]);
    const required = Boolean(sub[2]);
    const opts = Array.isArray(sub[1]) ? sub[1] : [];
    const choices: string[] = [];
    let hasOther = false;
    const branching: Record<string, string> = {};

    for (const opt of opts) {
      if (!Array.isArray(opt)) continue;
      if (opt.length > 4 && opt[4] === 1) {
        hasOther = true;
        continue;
      }
      const label = String(opt[0] || '');
      if (label) choices.push(label);
      const dest = opt.length > 2 ? opt[2] : null;
      if (dest != null) {
        if (dest === -1) {
          branching[label] = 'submit';
          hasBranching = true;
        } else if (pageIdToIdx.has(String(dest))) {
          branching[label] = `section:${pageIdToIdx.get(String(dest))}`;
          hasBranching = true;
        }
      }
    }

    // Extract checkbox response validations
    const validation: FormElement['validation'] = {};
    const valRules = Array.isArray(sub[4]) ? sub[4] : [];
    for (const vr of valRules) {
      if (Array.isArray(vr) && vr.length >= 2 && vr[0] === 7 && Array.isArray(vr[2]) && vr[2].length) {
        const n = parseInt(String(vr[2][0]), 10);
        if (vr[1] === 200) validation.min_select = n;
        else if (vr[1] === 201) validation.max_select = n;
        else if (vr[1] === 204) validation.exact_select = n;
      }
    }

    pages[curPageIdx].elements.push({
      id: eid,
      name: qName,
      description: qDesc,
      type: mappedBase,
      required,
      choices,
      has_other: hasOther,
      rows: [],
      branching,
      validation,
    });
  }

  return {
    platform: 'google',
    url: cleaned,
    final_url: finalUrl,
    fbzx,
    title,
    description,
    requires_signin: Boolean(requiresSignin),
    has_branching: hasBranching,
    pages: pages.filter((p) => p.elements.length > 0 || pages.length > 1),
  };
}

export function computeVisitedPages(formData: ParsedForm, answersDict: Record<string, any>): number[] {
  const pages = formData.pages || [];
  if (!pages.length) return [];
  const visited: number[] = [];
  let idx = 0;
  const seen = new Set<number>();
  while (idx >= 0 && idx < pages.length && !seen.has(idx)) {
    seen.add(idx);
    visited.push(idx);
    const page = pages[idx];
    let jumpTarget: string | null = null;
    for (const el of page.elements || []) {
      const br = el.branching || {};
      const ans = answersDict[String(el.id)];
      if (ans != null && br[String(ans)]) {
        jumpTarget = br[String(ans)];
      }
    }
    if (jumpTarget === 'submit') break;
    if (jumpTarget && jumpTarget.startsWith('section:')) {
      idx = parseInt(jumpTarget.split(':')[1], 10);
      continue;
    }
    const afterNav = page.after_next_page || 'next';
    if (afterNav === 'submit') break;
    if (afterNav.startsWith('section:')) {
      idx = parseInt(afterNav.split(':')[1], 10);
      continue;
    }
    idx += 1;
  }
  return visited;
}

export async function submitGoogleFormOnce(formData: ParsedForm, answers: Record<string, any>): Promise<void> {
  const visitedPages = computeVisitedPages(formData, answers);
  const visitedSet = new Set(visitedPages);
  const submitUrl = formData.url.replace(/\/viewform.*$/, '/formResponse');

  const params = new URLSearchParams();
  params.append('fvv', '1');
  if (formData.fbzx) params.append('fbzx', formData.fbzx);
  params.append('pageHistory', visitedPages.length ? visitedPages.join(',') : '0');

  for (const page of formData.pages || []) {
    if (visitedPages.length && !visitedSet.has(page.index)) continue;
    for (const elem of page.elements || []) {
      const eid = String(elem.id);
      const val = answers[eid];
      if (val == null || val === '') continue;

      if (eid === '__emailAddress__' || elem.type === 'UserEmail') {
        params.append('emailAddress', String(val));
      } else if (elem.type === 'Checkboxes') {
        const arr = Array.isArray(val) ? val : [val];
        for (const v of arr) {
          if (elem.choices.includes(String(v))) {
            params.append(`entry.${eid}`, String(v));
          } else {
            params.append(`entry.${eid}`, '__other_option__');
            params.append(`entry.${eid}.other_option_response`, String(v));
          }
        }
      } else if (['Radio', 'Dropdown', 'Scale'].includes(elem.type)) {
        const sv = String(val);
        if (elem.choices.includes(sv) || !elem.has_other) {
          params.append(`entry.${eid}`, sv);
        } else {
          params.append(`entry.${eid}`, '__other_option__');
          params.append(`entry.${eid}.other_option_response`, sv);
        }
      } else if (['RadioGrid', 'CheckboxGrid'].includes(elem.type)) {
        const rowIds = elem.row_ids || [];
        const rowsArr = Array.isArray(val) ? val : [];
        rowsArr.forEach((rv, rIdx) => {
          const rEid = rowIds[rIdx];
          if (!rEid) return;
          const items = Array.isArray(rv) ? rv : [rv];
          for (const itemVal of items) {
            if (itemVal) params.append(`entry.${rEid}`, String(itemVal));
          }
        });
      } else if (elem.type === 'Date') {
        const dStr = String(val);
        const parts = dStr.split('-');
        if (parts.length === 3) {
          params.append(`entry.${eid}_year`, parts[0]);
          params.append(`entry.${eid}_month`, String(parseInt(parts[1], 10)));
          params.append(`entry.${eid}_day`, String(parseInt(parts[2], 10)));
        } else {
          params.append(`entry.${eid}`, dStr);
        }
      } else if (elem.type === 'Time') {
        const parts = String(val).split(':');
        if (parts.length >= 2) {
          params.append(`entry.${eid}_hour`, parts[0]);
          params.append(`entry.${eid}_minute`, parts[1]);
        } else {
          params.append(`entry.${eid}`, String(val));
        }
      } else {
        params.append(`entry.${eid}`, String(val));
      }
    }
  }

  const resp = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      ...HEADERS_BROWSER,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Referer: formData.url,
    },
    body: params.toString(),
  });

  if (!resp.ok && resp.status !== 302) {
    throw new Error(`Google Form trả về HTTP ${resp.status}`);
  }
}

// ==============================================================================
// 4. MICROSOFT FORMS PARSER & SUBMITTER
// ==============================================================================

export async function parseMicrosoftForm(url: string): Promise<ParsedForm> {
  const resp = await fetch(url.trim(), { headers: HEADERS_BROWSER, redirect: 'follow' });
  const finalUrl = resp.url || url.trim();
  if (finalUrl.toLowerCase().includes('login.microsoftonline.com') || finalUrl.toLowerCase().includes('login.live.com')) {
    throw new Error(
      "Biểu mẫu Microsoft Forms đang bật chế độ chỉ cho người trong tổ chức. Hãy vào Thu thập phản hồi → chọn 'Bất kỳ ai cũng có thể trả lời'.",
    );
  }
  const html = await resp.text();
  const parsedUrl = new URL(finalUrl);
  let formId = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('Id');
  if (!formId) {
    const m = html.match(/id=([A-Za-z0-9_\-]+)/);
    if (m) formId = m[1];
  }
  if (!formId) throw new Error('Không tìm thấy mã biểu mẫu Microsoft Forms từ liên kết này.');

  const baseHost = `${parsedUrl.protocol}//${parsedUrl.host}`;
  let formJson: any = null;
  try {
    const sResp = await fetch(`${baseHost}/handlers/ResponsePageStartup.ashx?id=${formId}&mobile=false&type=forms`, {
      headers: HEADERS_BROWSER,
    });
    if (sResp.ok) {
      const sData = (await sResp.json()) as any;
      formJson = sData?.data?.form || sData?.form || sData;
    }
  } catch {
    formJson = null;
  }

  if (!formJson?.questions) {
    const mInfo = html.match(/window\.ServerInfo\s*=\s*(\{[\s\S]*?\});/);
    if (mInfo) {
      try {
        const si = JSON.parse(mInfo[1]);
        formJson = si.form || si.prefetchForm || si;
      } catch {
        formJson = null;
      }
    }
  }

  if (!formJson?.questions) {
    throw new Error("Không thể đọc cấu trúc Microsoft Forms. Hãy kiểm tra lại quyền 'Bất kỳ ai cũng có thể trả lời'.");
  }

  const rawQuestions = [...(formJson.questions || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const likertByParent = new Map<string, any[]>();
  for (const rq of rawQuestions) {
    let qi = rq.questionInfo;
    if (typeof qi === 'string') {
      try { qi = JSON.parse(qi); } catch { qi = {}; }
    }
    const parentId = rq.groupId || qi?.GroupId;
    if (rq.type === 'Question.MatrixChoice' && parentId) {
      const arr = likertByParent.get(parentId) || [];
      arr.push(rq);
      likertByParent.set(parentId, arr);
    }
  }

  const elements: FormElement[] = [];
  for (const rq of rawQuestions) {
    if (rq.type === 'Question.MatrixChoice' && rq.groupId) continue;
    const qid = String(rq.id);
    let qi = rq.questionInfo;
    if (typeof qi === 'string') {
      try { qi = JSON.parse(qi); } catch { qi = {}; }
    }
    qi = qi || {};

    let mappedType = 'Short';
    let choices: string[] = [];
    let rows: string[] = [];
    const branching: Record<string, string> = {};

    if (rq.type === 'Question.Choice') {
      mappedType = qi.AllowMultipleValues ? 'Checkboxes' : qi.ChoiceType === 2 ? 'Dropdown' : 'Radio';
      for (const ch of qi.Choices || []) {
        const label = ch.Description || ch.FormsProDisplayText;
        if (label) {
          choices.push(String(label));
          if (ch.BranchInfo?.TargetQuestionId) branching[String(label)] = `q:${ch.BranchInfo.TargetQuestionId}`;
        }
      }
    } else if (rq.type === 'Question.TextField') {
      mappedType = qi.Multiline ? 'Paragraph' : 'Short';
    } else if (rq.type === 'Question.Rating') {
      mappedType = 'Scale';
      const maxR = Number(qi.Length || 5);
      choices = Array.from({ length: maxR }, (_, i) => String(i + 1));
    } else if (rq.type === 'Question.NPS') {
      mappedType = 'Scale';
      choices = Array.from({ length: 11 }, (_, i) => String(i));
    } else if (rq.type === 'Question.DateTime') {
      mappedType = 'Date';
    } else if (rq.type === 'Question.Ranking') {
      mappedType = 'Ranking';
      choices = (qi.Choices || []).map((c: any) => String(c.Description)).filter(Boolean);
    } else if (rq.type === 'Question.MatrixChoiceGroup' || rq.type === 'Question.MatrixChoice') {
      mappedType = 'RadioGrid';
      choices = (qi.Columns || qi.Choices || []).map((c: any) => String(c.Description)).filter(Boolean);
      const subRows = likertByParent.get(qid) || [];
      rows = subRows.length
        ? subRows.map((sr, i) => String(sr.title || `Hàng ${i + 1}`))
        : (qi.Rows || []).map((r: any) => String(r.Description || r));
    } else if (rq.type === 'Question.FileUpload') {
      continue;
    }

    elements.push({
      id: qid,
      name: String(rq.title || 'Câu hỏi'),
      description: String(rq.subtitle || ''),
      type: mappedType,
      ms_type: rq.type,
      ms_row_ids: (likertByParent.get(qid) || []).map((sr) => String(sr.id)),
      required: Boolean(rq.required),
      choices,
      has_other: Boolean(qi.HasOtherAnswer),
      rows,
      branching,
      validation: {},
    });
  }

  return {
    platform: 'microsoft',
    url: url.trim(),
    final_url: finalUrl,
    ms_form_id: formId,
    ms_tenant_id: formJson.tenantId || formJson.ownerTenantId || '',
    ms_owner_id: formJson.ownerId || '',
    ms_base_host: baseHost,
    title: String(formJson.title || 'Microsoft Form'),
    description: String(formJson.description || ''),
    requires_signin: false,
    has_branching: elements.some((el) => el.branching && Object.keys(el.branching).length > 0),
    pages: [{ index: 0, title: String(formJson.title || 'Microsoft Form'), description: '', after_next_page: 'submit', elements }],
  };
}

export async function submitMicrosoftFormOnce(formData: ParsedForm, answers: Record<string, any>): Promise<void> {
  const baseHost = formData.ms_base_host || 'https://forms.office.com';
  const submitUrl =
    formData.ms_tenant_id && formData.ms_owner_id
      ? `${baseHost}/formapi/api/${formData.ms_tenant_id}/users/${formData.ms_owner_id}/forms('${formData.ms_form_id}')/responses`
      : `${baseHost}/formapi/api/forms('${formData.ms_form_id}')/responses`;

  const formatted: Array<{ questionId: string; answer1: string }> = [];
  for (const page of formData.pages || []) {
    for (const elem of page.elements || []) {
      const eid = String(elem.id);
      const val = answers[eid];
      if (val == null || val === '') continue;

      if (elem.type === 'Checkboxes') {
        const arr = Array.isArray(val) ? val : [val];
        formatted.push({ questionId: eid, answer1: JSON.stringify(arr) });
      } else if (elem.type === 'Ranking') {
        const arr = [...(elem.choices || [])].sort(() => Math.random() - 0.5);
        formatted.push({ questionId: eid, answer1: arr.join(',') });
      } else if (['RadioGrid', 'CheckboxGrid'].includes(elem.type) && elem.ms_row_ids?.length) {
        const vals = Array.isArray(val) ? val : (elem.rows || []).map((r) => val[r] || '');
        elem.ms_row_ids.forEach((rId, idx) => {
          if (vals[idx]) formatted.push({ questionId: rId, answer1: String(vals[idx]) });
        });
      } else {
        formatted.push({ questionId: eid, answer1: String(val) });
      }
    }
  }

  const now = new Date();
  const start = new Date(now.getTime() - randInt(35, 140) * 1000);
  const resp = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      ...HEADERS_BROWSER,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Referer: formData.final_url || formData.url || baseHost,
    },
    body: JSON.stringify({
      startDate: start.toISOString(),
      submitDate: now.toISOString(),
      answers: JSON.stringify(formatted),
    }),
  });
  if (!resp.ok) {
    throw new Error(`Microsoft Forms trả về HTTP ${resp.status}: ${(await resp.text()).slice(0, 180)}`);
  }
}

export function syncFormStructures(oldForm: ParsedForm, newForm: ParsedForm) {
  const flatten = (f?: ParsedForm) => {
    const m = new Map<string, FormElement>();
    for (const p of f?.pages || []) {
      for (const el of p.elements || []) m.set(String(el.id), el);
    }
    return m;
  };
  const oldMap = flatten(oldForm);
  const newMap = flatten(newForm);

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  let unchanged = 0;

  for (const [id, nel] of newMap.entries()) {
    const oel = oldMap.get(id);
    if (!oel) added.push(nel.name);
    else if (
      JSON.stringify(oel.choices) !== JSON.stringify(nel.choices) ||
      JSON.stringify(oel.rows) !== JSON.stringify(nel.rows) ||
      oel.type !== nel.type
    ) {
      modified.push(nel.name);
    } else {
      unchanged += 1;
    }
  }
  for (const [id, oel] of oldMap.entries()) {
    if (!newMap.has(id)) removed.push(oel.name);
  }
  return { added, removed, modified, unchanged };
}
