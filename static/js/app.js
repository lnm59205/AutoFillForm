(function () {
  'use strict';

  let parsedForm = null;
  let pollInterval = null;
  let activeRules = [];
  let excelValidatedData = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function cleanString(str) {
    if (!str) return '';
    return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function fuzzyMatch(s1, s2) {
    const c1 = cleanString(s1), c2 = cleanString(s2);
    return !!(c1 && c2 && (c1.includes(c2) || c2.includes(c1)));
  }

  // ============================================================================
  // COMPACT CONFIG_2_ & LEGACY CONFIG_ ENCODING / DECODING
  // ============================================================================
  const STRATEGY_TO_CODE = { custom_list: 200, email: 201, vi_name: 202, vi_phone: 203, static: 204, mssv: 205, class_code: 206, vi_address: 207 };
  const CODE_TO_STRATEGY = { 200: 'custom_list', 201: 'email', 202: 'vi_name', 203: 'vi_phone', 204: 'static', 205: 'mssv', 206: 'class_code', 207: 'vi_address' };

  function bytesToB64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64UrlToBytes(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bin = atob(b64);
    return Array.from(bin, (ch) => ch.charCodeAt(0));
  }
  function utf8ToB64Url(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64UrlToUtf8(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    return decodeURIComponent(escape(atob(b64)));
  }
  function shortenFormUrl(rawUrl) {
    const u = (rawUrl || '').trim();
    let m = u.match(/\/forms\/d\/e\/1FAIpQL([a-zA-Z0-9_-]+)/);
    if (m) return 'e.' + m[1];
    m = u.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return 'd.' + m[1];
    m = u.match(/forms\.gle\/([a-zA-Z0-9_-]+)/);
    if (m) return 'g.' + m[1];
    return 'u.' + utf8ToB64Url(u);
  }
  function expandShortFormUrl(tok) {
    if (!tok) return '';
    if (tok.startsWith('e.')) return 'https://docs.google.com/forms/d/e/1FAIpQL' + tok.slice(2) + '/viewform';
    if (tok.startsWith('d.')) return 'https://docs.google.com/forms/d/' + tok.slice(2) + '/viewform';
    if (tok.startsWith('g.')) return 'https://forms.gle/' + tok.slice(2);
    if (tok.startsWith('u.')) return b64UrlToUtf8(tok.slice(2));
    return tok;
  }

  function encodeShortConfigCode(formUrl, submissions, delay) {
    const shortUrl = shortenFormUrl(formUrl);
    const qItems = document.querySelectorAll('.question-item');
    const bytes = [];
    const customTexts = {};

    qItems.forEach((qItem, idx) => {
      const type = qItem.dataset.type;
      if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
        const select = qItem.querySelector('.strategy-select');
        bytes.push(STRATEGY_TO_CODE[select ? select.value : 'custom_list'] || 200, 254);
        const staticInput = qItem.querySelector('.static-value-input');
        if (staticInput && staticInput.value.trim()) customTexts[idx] = staticInput.value;
      } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
        qItem.querySelectorAll('.choice-percent-input').forEach((inp) => bytes.push(Math.max(0, Math.min(100, parseInt(inp.value, 10) || 0))));
        bytes.push(254);
      } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
        qItem.querySelectorAll('.grid-row-container').forEach((row, rIdx) => {
          if (rIdx > 0) bytes.push(253);
          row.querySelectorAll('.choice-percent-input').forEach((inp) => bytes.push(Math.max(0, Math.min(100, parseInt(inp.value, 10) || 0))));
        });
        bytes.push(254);
      }
    });

    let code = `CONFIG_2_${shortUrl}~${submissions}~${delay}~${bytesToB64Url(bytes)}`;
    if (Object.keys(customTexts).length > 0) code += `~${utf8ToB64Url(JSON.stringify(customTexts))}`;
    return code;
  }

  function decodeAnyConfigCode(rawInput) {
    const trimmed = (rawInput || '').trim();
    if (trimmed.startsWith('CONFIG_2_')) {
      const parts = trimmed.slice('CONFIG_2_'.length).split('~');
      if (parts.length < 4) throw new Error('Mã cấu hình ngắn không đúng định dạng.');
      const [uPart, subStr, delayStr, pctB64, textB64] = parts;
      const rawBytes = b64UrlToBytes(pctB64);
      const qSegments = [];
      let cur = [];
      for (let i = 0; i < rawBytes.length; i++) {
        if (rawBytes[i] === 254) { qSegments.push(cur); cur = []; }
        else cur.push(rawBytes[i]);
      }
      if (cur.length > 0) qSegments.push(cur);
      return {
        version: 2,
        url: expandShortFormUrl(uPart),
        submissions: parseInt(subStr, 10) || 10,
        delay: parseFloat(delayStr) || 1.0,
        qSegments,
        customTexts: textB64 ? JSON.parse(b64UrlToUtf8(textB64)) : {},
      };
    }
    if (trimmed.startsWith('CONFIG_')) {
      const b64Part = trimmed.slice('CONFIG_'.length).replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b64Part))));
    }
    throw new Error('Mã cấu hình không hợp lệ.');
  }

  // ============================================================================
  // SHARED GLOBAL API FOR MODULES
  // ============================================================================
  function getCustomApiKey() {
    return localStorage.getItem('aff_custom_groq_key') || '';
  }

  function openModal(title, htmlContent, footerHtml) {
    const m = document.getElementById('generic-modal');
    document.getElementById('generic-modal-title').textContent = title;
    document.getElementById('generic-modal-body').innerHTML = htmlContent;
    const footer = document.getElementById('generic-modal-footer');
    if (footerHtml !== undefined) footer.innerHTML = footerHtml;
    else footer.innerHTML = '<button id="generic-modal-ok" class="btn btn-primary btn-sm">Đóng</button>';
    const okBtn = document.getElementById('generic-modal-ok');
    if (okBtn) okBtn.addEventListener('click', closeModal);
    m.classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('generic-modal').classList.add('hidden');
  }

  function addLog(type, msg) {
    const logsContainer = document.getElementById('logs-container');
    if (!logsContainer) return;
    const ts = new Date().toTimeString().split(' ')[0];
    const line = document.createElement('div');
    line.className = `log-line ${type}-log`;
    line.textContent = `[${ts}] ${msg}`;
    logsContainer.appendChild(line);
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  function notifyUser(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch (e) {}
    }
  }

  function openPanel(panelId) {
    document.querySelectorAll('.menu-item').forEach((i) => i.classList.toggle('active', i.dataset.panel === panelId));
    document.querySelectorAll('.content-panel').forEach((p) => p.classList.toggle('active', p.id === panelId));
    document.getElementById('studio-rail')?.classList.remove('open');
    document.getElementById('rail-backdrop')?.classList.add('hidden');
    if (panelId === 'panel-campaign') toggleCampaignWorkspaceViews();
    if (panelId === 'panel-history') renderSavedFormsList();
  }

  window.AFF = {
    esc,
    fuzzyMatch,
    getParsedForm: () => parsedForm,
    setParsedForm: (f) => { parsedForm = f; },
    getCustomApiKey,
    openModal,
    closeModal,
    addLog,
    notifyUser,
    openPanel,
    startCustomCampaign: (payload) => startCampaignRequest(payload),
  };

  // ============================================================================
  // DOM READY
  // ============================================================================
  document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const userDisplayName = document.getElementById('user-display-name');
    const avatarChip = document.getElementById('user-avatar-chip');

    document.getElementById('generic-modal-close')?.addEventListener('click', closeModal);
    document.getElementById('generic-modal')?.addEventListener('click', (e) => { if (e.target.id === 'generic-modal') closeModal(); });

    // Auth handlers
    document.getElementById('switch-to-register')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('login-form-container').classList.add('hidden');
      document.getElementById('register-form-container').classList.remove('hidden');
    });
    document.getElementById('switch-to-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('register-form-container').classList.add('hidden');
      document.getElementById('login-form-container').classList.remove('hidden');
    });

    document.getElementById('btn-login')?.addEventListener('click', () => {
      const usernameInput = document.getElementById('login-username').value.trim();
      if (!usernameInput) return alert('Vui lòng nhập tên đăng nhập.');
      const users = JSON.parse(localStorage.getItem('users') || '[]');
      let user = users.find((u) => u.username === usernameInput);
      if (!user && usernameInput === 'Le Ngoc Minh') user = { name: 'Lê Ngọc Minh', username: 'Le Ngoc Minh' };
      if (!user) user = { name: usernameInput, username: usernameInput };
      localStorage.setItem('currentUser', JSON.stringify(user));
      checkAuthState();
    });

    document.getElementById('btn-register')?.addEventListener('click', () => {
      const nameInput = document.getElementById('register-name').value.trim();
      const usernameInput = document.getElementById('register-username').value.trim();
      if (!nameInput || !usernameInput) return alert('Vui lòng điền đầy đủ họ tên và tên đăng nhập.');
      const users = JSON.parse(localStorage.getItem('users') || '[]');
      if (users.some((u) => u.username === usernameInput)) return alert('Tên đăng nhập đã tồn tại.');
      const newUser = { name: nameInput, username: usernameInput };
      users.push(newUser);
      localStorage.setItem('users', JSON.stringify(users));
      localStorage.setItem('currentUser', JSON.stringify(newUser));
      checkAuthState();
    });

    document.getElementById('btn-logout')?.addEventListener('click', () => {
      localStorage.removeItem('currentUser');
      checkAuthState();
    });

    function checkAuthState() {
      const userJson = localStorage.getItem('currentUser');
      if (userJson) {
        const user = JSON.parse(userJson);
        if (userDisplayName) userDisplayName.textContent = user.name;
        if (avatarChip) avatarChip.textContent = (user.name || 'AF').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        loginScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
        renderSavedFormsList();
      } else {
        loginScreen.classList.remove('hidden');
        dashboardScreen.classList.add('hidden');
      }
    }

    // Navigation & Subtabs
    document.querySelectorAll('.menu-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        openPanel(item.dataset.panel);
      });
    });
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      const rail = document.getElementById('studio-rail');
      const bd = document.getElementById('rail-backdrop');
      const open = rail?.classList.toggle('open');
      if (bd) bd.classList.toggle('hidden', !open);
    });
    document.getElementById('rail-backdrop')?.addEventListener('click', () => {
      document.getElementById('studio-rail')?.classList.remove('open');
      document.getElementById('rail-backdrop')?.classList.add('hidden');
    });
    document.getElementById('btn-nav-to-home')?.addEventListener('click', () => openPanel('panel-home'));

    document.querySelectorAll('.subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.subtab;
        if (!target) return;
        document.querySelectorAll('.subtab-btn').forEach((b) => { if (b.dataset.subtab) b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.subtab-pane').forEach((p) => p.classList.toggle('active', p.id === target));
      });
    });

    function toggleCampaignWorkspaceViews() {
      const ws = document.getElementById('campaign-workspace');
      const es = document.getElementById('empty-active-state');
      if (parsedForm) { ws.classList.remove('hidden'); es.classList.add('hidden'); }
      else { ws.classList.add('hidden'); es.classList.remove('hidden'); }
    }

    // ==========================================================================
    // FORM PARSE & SYNC
    // ==========================================================================
    const btnParse = document.getElementById('btn-parse');
    const formUrlInput = document.getElementById('form-url');
    const parseError = document.getElementById('parse-error');

    function loadFormIntoWorkspace(data, pendingConfig) {
      parsedForm = data;
      activeRules = data.rules || [];
      excelValidatedData = null;
      document.getElementById('excel-result-box')?.classList.add('hidden');

      const badge = document.getElementById('form-platform-badge');
      if (badge) {
        const isMs = data.platform === 'microsoft';
        badge.textContent = isMs ? 'Microsoft Forms' : 'Google Forms';
        badge.classList.toggle('ms', isMs);
      }
      document.getElementById('form-title-display').textContent = data.title || 'Biểu mẫu';
      document.getElementById('form-desc-display').textContent = data.description || 'Không có mô tả.';

      renderQuestions(data);
      renderQuestionChecklist(data);
      populateRuleSelectors(data);
      renderRulesList();

      openPanel('panel-campaign');
      if (pendingConfig) {
        applyConfigPayload(pendingConfig);
        addLog('system', `Đã khôi phục cấu hình cho "${data.title}".`);
      } else {
        autoFillZeroPercentages();
        addLog('system', `Đã tải biểu mẫu (${data.platform === 'microsoft' ? 'Microsoft Forms' : 'Google Forms'}): "${data.title}".`);
      }
    }

    btnParse?.addEventListener('click', async () => {
      let url = formUrlInput.value.trim();
      if (!url) return showParseError('Vui lòng nhập link Google Form, Microsoft Forms hoặc mã CONFIG_...');
      let pendingConfig = null;
      if (url.startsWith('CONFIG_')) {
        try {
          pendingConfig = decodeAnyConfigCode(url);
          url = pendingConfig.url;
        } catch (err) {
          return showParseError('Mã cấu hình không hợp lệ hoặc bị cắt thiếu ký tự.');
        }
      }

      btnParse.disabled = true;
      document.getElementById('btn-parse-text').classList.add('hidden');
      document.getElementById('btn-parse-spinner').classList.remove('hidden');
      parseError.classList.add('hidden');

      try {
        const res = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Không thể phân tích biểu mẫu.');
        data.url = data.url || url;
        saveFormToLocalStorage(data.url, data);
        if (data.requires_signin) {
          showParseError('Cảnh báo: Biểu mẫu đang bật yêu cầu đăng nhập (Giới hạn 1 lần trả lời). Hãy tắt trong Cài đặt Form.');
        }
        loadFormIntoWorkspace(data, pendingConfig);
      } catch (err) {
        showParseError(err.message);
      } finally {
        btnParse.disabled = false;
        document.getElementById('btn-parse-text').classList.remove('hidden');
        document.getElementById('btn-parse-spinner').classList.add('hidden');
      }
    });

    function showParseError(msg) {
      parseError.textContent = msg;
      parseError.classList.remove('hidden');
    }

    // Sync Form (re-read and preserve existing ratios)
    document.getElementById('btn-sync-form')?.addEventListener('click', async () => {
      if (!parsedForm) return;
      const oldPayload = getCurrentConfigPayload();
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: parsedForm.url, old_form: parsedForm }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi đồng bộ.');
        loadFormIntoWorkspace(data.form, oldPayload);
        const d = data.diff;
        openModal('Kết quả Đồng bộ Biểu mẫu', `
          <p><strong>Không đổi (đã giữ nguyên tỷ lệ):</strong> ${d.unchanged} câu</p>
          <p style="margin-top:8px;"><strong>Câu mới thêm (${d.added.length}):</strong> ${d.added.length ? esc(d.added.join(', ')) : 'Không có'}</p>
          <p style="margin-top:8px;"><strong>Câu bị xóa (${d.removed.length}):</strong> ${d.removed.length ? esc(d.removed.join(', ')) : 'Không có'}</p>
          <p style="margin-top:8px;"><strong>Câu bị thay đổi lựa chọn (${d.modified.length}):</strong> ${d.modified.length ? esc(d.modified.join(', ')) : 'Không có'}</p>
        `);
      } catch (err) {
        alert(err.message);
      }
    });

    // ==========================================================================
    // RENDER QUESTIONS & CHECKLIST
    // ==========================================================================
    function getReadableTypeLabel(t) {
      return {
        Radio: 'Chọn 1 đáp án', Dropdown: 'Menu thả xuống', Scale: 'Thang đo',
        Checkboxes: 'Hộp kiểm (Chọn nhiều)', RadioGrid: 'Lưới chọn 1', CheckboxGrid: 'Lưới hộp kiểm',
        Short: 'Trả lời ngắn', Paragraph: 'Đoạn văn', UserEmail: 'Email',
        Date: 'Ngày', Time: 'Giờ', Duration: 'Thời lượng', Ranking: 'Xếp thứ tự',
      }[t] || t;
    }

    function createChoiceRow(choiceVal, isOther) {
      const lbl = isOther ? 'Mục khác (Tự động điền)' : choiceVal;
      return `
        <div class="choice-row" data-choice-value="${esc(choiceVal)}">
          <span class="choice-label" title="${esc(lbl)}">${esc(lbl)}</span>
          <div class="choice-input-wrapper">
            <input type="number" class="choice-percent-input" value="0" min="0" max="100" />
            <span style="font-size:12px; color:var(--text-muted)">%</span>
          </div>
        </div>
      `;
    }

    function renderQuestions(formData) {
      const container = document.getElementById('form-questions-container');
      container.innerHTML = '';
      let qIndex = 1;

      (formData.pages || []).forEach((page) => {
        const ph = document.createElement('div');
        ph.innerHTML = `<h4 style="font-size:11.5px; color:var(--cyan); text-transform:uppercase; letter-spacing:0.6px; margin:14px 0 8px;">${esc(page.title)}</h4>`;
        container.appendChild(ph);

        (page.elements || []).forEach((elem) => {
          const qDiv = document.createElement('div');
          qDiv.className = 'question-item';
          qDiv.dataset.id = elem.id;
          qDiv.dataset.type = elem.type;

          const reqHtml = elem.required ? `<span class="question-required">*</span>` : '';
          const branchBadge = elem.branching && Object.keys(elem.branching).length ? `<span class="question-badge" style="color:var(--cyan);">Có rẽ nhánh</span>` : '';
          const sumHtml = ['Radio', 'Dropdown', 'Scale'].includes(elem.type) ? `<span class="sum-status-badge invalid">Tổng: 0%</span>` : '';
          const descHtml = elem.description ? `<p class="question-desc">${esc(elem.description)}</p>` : '';

          let inner = `
            <div class="question-header">
              <div class="question-title-area">
                <div class="question-number">${qIndex}</div>
                <div class="question-title">${esc(elem.name)}${reqHtml}</div>
              </div>
              <div class="question-meta-group">
                ${sumHtml}
                ${branchBadge}
                <span class="question-badge">${getReadableTypeLabel(elem.type)}</span>
              </div>
            </div>
            ${descHtml}
          `;

          if (['Short', 'Paragraph', 'UserEmail'].includes(elem.type)) {
            const defStrat = elem.type === 'UserEmail' ? 'email' : 'custom_list';
            inner += `
              <div class="strategy-select-container" data-q-name="${esc(elem.name)}" data-q-desc="${esc(elem.description)}">
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">Nguồn dữ liệu câu trả lời:</label>
                <select class="strategy-select" onchange="window.handleStrategyChange(this)">
                  <option value="custom_list" ${defStrat === 'custom_list' ? 'selected' : ''}>AI / Danh sách (1 dòng/lượt)</option>
                  <option value="email" ${defStrat === 'email' ? 'selected' : ''}>Email ngẫu nhiên (@gmail.com)</option>
                  <option value="vi_name">Họ tên Việt Nam</option>
                  <option value="vi_phone">SĐT Việt Nam (10 số)</option>
                  <option value="mssv">MSSV ngẫu nhiên</option>
                  <option value="class_code">Mã lớp (VD: K19 QTKD 2)</option>
                  <option value="vi_address">Địa chỉ Việt Nam</option>
                  <option value="static">Giá trị cố định</option>
                </select>
                <div class="static-input-wrapper ${defStrat === 'custom_list' ? '' : 'hidden'}" style="margin-top:8px;">
                  <div class="input-row question-ai-prompt-bar" style="margin-bottom:6px;">
                    <input type="text" class="question-ai-prompt-input" placeholder="Gợi ý cho AI (hoặc để trống)..." />
                    <button type="button" class="btn btn-ai btn-xs" onclick="window.generateQuestionTextByAI(this)">Tạo AI</button>
                  </div>
                  <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-hint); margin-bottom:4px;">
                    <span class="custom-list-helper">Danh sách (mỗi dòng 1 lượt):</span>
                    <span class="custom-list-counter">0 dòng</span>
                  </div>
                  <textarea class="static-value-input" rows="3" oninput="window.updateCustomListCount(this)" placeholder="Dán danh sách hoặc bấm Tạo AI..."></textarea>
                </div>
              </div>
            `;
          } else if (['Radio', 'Dropdown', 'Scale'].includes(elem.type)) {
            let ch = (elem.choices || []).map((c) => createChoiceRow(c, false)).join('');
            if (elem.has_other) ch += createChoiceRow('__other_option__', true);
            inner += `<div class="choices-list">${ch}</div>`;
          } else if (elem.type === 'Checkboxes') {
            let ch = (elem.choices || []).map((c) => createChoiceRow(c, false)).join('');
            if (elem.has_other) ch += createChoiceRow('__other_option__', true);
            inner += `<div class="choices-list">${ch}</div><p style="font-size:11.5px; color:var(--text-hint); margin-top:6px;">Hộp kiểm: mỗi ô có xác suất độc lập 0–100%.</p>`;
          } else if (['RadioGrid', 'CheckboxGrid'].includes(elem.type)) {
            const isRadio = elem.type === 'RadioGrid';
            let gHtml = (elem.rows || []).map((row) => {
              const cols = (elem.choices || []).map((col) => createChoiceRow(col, false)).join('');
              return `
                <div class="grid-row-container" data-row-name="${esc(row)}" style="margin-bottom:12px; padding:10px; background:var(--bg-card); border-radius:8px; border:1px solid var(--border);">
                  <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:12.5px; font-weight:700;">
                    <span>Hàng: ${esc(row)}</span>
                    ${isRadio ? '<span class="total-percent-display sum-invalid">0%</span>' : '<span style="font-size:11px; color:var(--text-hint);">Độc lập 0-100%</span>'}
                  </div>
                  <div class="choices-list">${cols}</div>
                </div>
              `;
            }).join('');
            inner += `<div style="margin-top:8px;">${gHtml}</div>`;
          } else {
            inner += `<p style="font-size:12px; color:var(--text-muted);">Hệ thống tự sinh giá trị ${getReadableTypeLabel(elem.type)} hợp lệ cho từng lượt.</p>`;
          }

          qDiv.innerHTML = inner;
          container.appendChild(qDiv);
          qIndex++;
        });
      });

      attachPercentInputEvents();
    }

    function renderQuestionChecklist(formData) {
      const cl = document.getElementById('question-checklist-container');
      cl.innerHTML = '';
      let idx = 1;
      (formData.pages || []).forEach((p) => {
        (p.elements || []).forEach((elem) => {
          const item = document.createElement('div');
          item.className = 'checklist-item';
          item.dataset.qId = elem.id;
          item.innerHTML = `
            <div class="checklist-item-index">${idx}</div>
            <div class="checklist-item-info">
              <div class="checklist-item-title">${esc(elem.name)}</div>
              <div class="checklist-item-type">${getReadableTypeLabel(elem.type)}</div>
            </div>
            <div class="checklist-item-status-wrapper"><span class="checklist-status-text valid">Sẵn sàng</span></div>
          `;
          item.addEventListener('click', () => {
            const card = document.querySelector(`.question-item[data-id="${CSS.escape(String(elem.id))}"]`);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          cl.appendChild(item);
          idx++;
        });
      });
    }

    window.updateCustomListCount = function (ta) {
      const w = ta?.closest('.static-input-wrapper');
      const c = w?.querySelector('.custom-list-counter');
      if (!c) return;
      let lines = (ta.value || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (lines.length === 1 && lines[0].includes(';')) lines = lines[0].split(';').map((s) => s.trim()).filter(Boolean);
      c.textContent = `Số dòng: ${lines.length}`;
    };

    window.handleStrategyChange = function (sel) {
      const w = sel.nextElementSibling;
      if (!w) return;
      const aiBar = w.querySelector('.question-ai-prompt-bar');
      const ta = w.querySelector('.static-value-input');
      if (sel.value === 'custom_list' || sel.value === 'static') {
        w.classList.remove('hidden');
        aiBar?.classList.toggle('hidden', sel.value === 'static');
        if (ta) ta.rows = sel.value === 'static' ? 2 : 4;
      } else {
        w.classList.add('hidden');
      }
    };

    window.generateQuestionTextByAI = async function (btn) {
      if (!parsedForm) return;
      const box = btn.closest('.strategy-select-container');
      const qItem = btn.closest('.question-item');
      const promptInput = box.querySelector('.question-ai-prompt-input');
      const ta = box.querySelector('.static-value-input');
      const count = parseInt(document.getElementById('campaign-submissions').value, 10) || 20;

      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Đang tạo...';
      try {
        const res = await fetch('/api/ai-generate-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_title: parsedForm.title,
            form_description: parsedForm.description,
            question_name: box.dataset.qName,
            question_description: box.dataset.qDesc,
            question_type: qItem?.dataset.type || 'Short',
            prompt: promptInput?.value.trim() || '',
            count,
            custom_api_key: getCustomApiKey(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi AI');
        if (ta && data.items?.length) {
          ta.value = data.items.join('\n');
          window.updateCustomListCount(ta);
        }
        addLog('system', `AI đã tạo ${data.items?.length || 0} dòng cho "${box.dataset.qName}".`);
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    };

    function attachPercentInputEvents() {
      document.querySelectorAll('.choice-percent-input').forEach((inp) => {
        inp.addEventListener('focus', () => { if (inp.value === '0') inp.value = ''; else inp.select(); });
        inp.addEventListener('input', () => {
          if (inp.value === '') return updateAllSums();
          let v = parseInt(inp.value, 10);
          if (isNaN(v) || v < 0) inp.value = 0;
          else if (v > 100) inp.value = 100;
          updateAllSums();
        });
        inp.addEventListener('blur', () => { if (inp.value.trim() === '') { inp.value = 0; updateAllSums(); } });
      });
      updateAllSums();
    }

    function updateAllSums() {
      const distMode = document.getElementById('distribution-mode-select')?.value || 'absolute';
      const require100 = distMode === 'absolute';

      document.querySelectorAll('.question-item').forEach((qItem) => {
        const id = qItem.dataset.id;
        const type = qItem.dataset.type;
        let isValid = true;

        if (['Radio', 'Dropdown', 'Scale'].includes(type)) {
          let sum = 0;
          qItem.querySelectorAll('.choice-percent-input').forEach((i) => sum += parseInt(i.value, 10) || 0);
          const badge = qItem.querySelector('.sum-status-badge');
          if (badge) {
            if (!require100 && sum === 0) {
              badge.textContent = 'Tự nhiên (Auto)';
              badge.className = 'sum-status-badge valid';
            } else if (sum === 100) {
              badge.textContent = 'Tổng: 100% ✓';
              badge.className = 'sum-status-badge valid';
            } else {
              badge.textContent = `Tổng: ${sum}% (${sum < 100 ? 'Thiếu ' + (100 - sum) : 'Thừa ' + (sum - 100)}%)`;
              badge.className = 'sum-status-badge invalid';
              isValid = false;
            }
          }
        } else if (type === 'RadioGrid') {
          qItem.querySelectorAll('.grid-row-container').forEach((row) => {
            let sum = 0;
            row.querySelectorAll('.choice-percent-input').forEach((i) => sum += parseInt(i.value, 10) || 0);
            const disp = row.querySelector('.total-percent-display');
            if (disp) {
              disp.textContent = sum + '%';
              const rowOk = sum === 100 || (!require100 && sum === 0);
              disp.className = `total-percent-display ${rowOk ? 'sum-valid' : 'sum-invalid'}`;
              disp.style.color = rowOk ? 'var(--accent)' : 'var(--amber)';
              if (!rowOk) isValid = false;
            }
          });
        }

        qItem.classList.toggle('valid-question', isValid);
        qItem.classList.toggle('invalid-question', !isValid);
        const clItem = document.querySelector(`.checklist-item[data-q-id="${CSS.escape(String(id))}"] .checklist-item-status-wrapper`);
        if (clItem) {
          if (['Radio', 'Dropdown', 'Scale', 'RadioGrid'].includes(type)) {
            clItem.innerHTML = isValid ? '<span class="checklist-status-text valid">Đủ 100%</span>' : '<span class="checklist-status-text invalid">Chưa đủ</span>';
          } else {
            clItem.innerHTML = '<span class="checklist-status-text valid">Sẵn sàng</span>';
          }
        }
      });
    }

    document.getElementById('distribution-mode-select')?.addEventListener('change', updateAllSums);

    // ==========================================================================
    // AUTO-FILL EQUAL %, AI DISTRIBUTE, TEXT IMPORT, SAVE / EXPORT
    // ==========================================================================
    function autoFillZeroPercentages() {
      document.querySelectorAll('.choice-percent-input').forEach((i) => (i.value = 0));
      updateAllSums();
    }

    document.getElementById('btn-auto-fill-percent')?.addEventListener('click', () => {
      document.querySelectorAll('.question-item').forEach((qItem) => {
        const type = qItem.dataset.type;
        if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
          const inputs = qItem.querySelectorAll('.choice-percent-input');
          if (!inputs.length) return;
          if (type === 'Checkboxes') inputs.forEach((i) => (i.value = 50));
          else {
            const base = Math.floor(100 / inputs.length), rem = 100 % inputs.length;
            inputs.forEach((i, idx) => (i.value = base + (idx < rem ? 1 : 0)));
          }
        } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
          qItem.querySelectorAll('.grid-row-container').forEach((row) => {
            const inputs = row.querySelectorAll('.choice-percent-input');
            if (!inputs.length) return;
            if (type === 'CheckboxGrid') inputs.forEach((i) => (i.value = 50));
            else {
              const base = Math.floor(100 / inputs.length), rem = 100 % inputs.length;
              inputs.forEach((i, idx) => (i.value = base + (idx < rem ? 1 : 0)));
            }
          });
        }
      });
      updateAllSums();
      addLog('system', 'Đã chia đều 100% cho các câu hỏi.');
    });

    document.querySelectorAll('.ai-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.getElementById('ai-prompt-input').value = chip.dataset.prompt;
      });
    });

    document.getElementById('btn-ai-distribute')?.addEventListener('click', async () => {
      if (!parsedForm) return;
      const btn = document.getElementById('btn-ai-distribute');
      const statusEl = document.getElementById('ai-status-msg');
      const questions = [];
      (parsedForm.pages || []).forEach((p) => (p.elements || []).forEach((el) => questions.push(el)));

      btn.disabled = true;
      document.getElementById('btn-ai-text').classList.add('hidden');
      document.getElementById('btn-ai-spinner').classList.remove('hidden');

      try {
        const res = await fetch('/api/ai-distribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: document.getElementById('ai-prompt-input').value.trim(),
            form_title: parsedForm.title,
            form_description: parsedForm.description,
            count: parseInt(document.getElementById('campaign-submissions').value, 10) || 20,
            questions,
            custom_api_key: getCustomApiKey(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi gọi AI.');

        const dist = data.distribution || {};
        const texts = data.text_samples || {};
        document.querySelectorAll('.question-item').forEach((qItem) => {
          const id = String(qItem.dataset.id), type = qItem.dataset.type;
          if (['Short', 'Paragraph', 'UserEmail'].includes(type) && Array.isArray(texts[id]) && texts[id].length) {
            const sel = qItem.querySelector('.strategy-select'), ta = qItem.querySelector('.static-value-input');
            if (sel) { sel.value = 'custom_list'; window.handleStrategyChange(sel); }
            if (ta) { ta.value = texts[id].join('\n'); window.updateCustomListCount(ta); }
            return;
          }
          const qDist = dist[id];
          if (!qDist) return;
          if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
            qItem.querySelectorAll('.choice-row').forEach((row) => {
              const val = row.dataset.choiceValue;
              const inp = row.querySelector('.choice-percent-input');
              if (inp && qDist[val] !== undefined) inp.value = qDist[val];
              else if (inp && val === '__other_option__' && qDist['Mục khác'] !== undefined) inp.value = qDist['Mục khác'];
            });
          } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
            qItem.querySelectorAll('.grid-row-container').forEach((rc) => {
              const rDist = qDist[rc.dataset.rowName];
              if (!rDist) return;
              rc.querySelectorAll('.choice-row').forEach((crow) => {
                const inp = crow.querySelector('.choice-percent-input');
                if (inp && rDist[crow.dataset.choiceValue] !== undefined) inp.value = rDist[crow.dataset.choiceValue];
              });
            });
          }
        });
        updateAllSums();
        statusEl.textContent = '✓ ' + (data.summary || 'Đã phân bổ xong.');
        statusEl.style.color = 'var(--accent)';
        statusEl.classList.remove('hidden');
        addLog('system', `AI: ${data.summary}`);
      } catch (err) {
        statusEl.textContent = '✕ ' + err.message;
        statusEl.style.color = 'var(--danger)';
        statusEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        document.getElementById('btn-ai-text').classList.remove('hidden');
        document.getElementById('btn-ai-spinner').classList.add('hidden');
      }
    });

    // Quick Text Percentage Import
    const importModal = document.getElementById('import-text-modal');
    document.getElementById('btn-import-text-trigger')?.addEventListener('click', () => importModal.classList.remove('hidden'));
    const closeTextModal = () => importModal.classList.add('hidden');
    document.getElementById('btn-close-modal')?.addEventListener('click', closeTextModal);
    document.getElementById('btn-cancel-import')?.addEventListener('click', closeTextModal);

    document.getElementById('btn-submit-import')?.addEventListener('click', () => {
      const text = document.getElementById('import-text-area').value;
      if (!text.trim()) return alert('Vui lòng dán văn bản báo cáo.');
      const parsedData = parseTextPercentages(text);
      if (!parsedData.length) return alert('Không tìm thấy tỷ lệ % hợp lệ.');
      let matched = 0;
      document.querySelectorAll('.question-item').forEach((qItem) => {
        const qTitle = qItem.querySelector('.question-title').textContent.replace('*', '').trim();
        const type = qItem.dataset.type;
        const mQ = parsedData.find((q) => fuzzyMatch(q.title, qTitle));
        if (!mQ) return;
        matched++;
        if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
          qItem.querySelectorAll('.choice-row').forEach((row) => {
            const k = Object.keys(mQ.choices).find((ck) => fuzzyMatch(ck, row.dataset.choiceValue));
            if (k !== undefined) row.querySelector('.choice-percent-input').value = mQ.choices[k];
          });
        } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
          qItem.querySelectorAll('.grid-row-container').forEach((rc) => {
            const mRow = parsedData.find((q) => fuzzyMatch(q.title, rc.dataset.rowName));
            if (!mRow) return;
            rc.querySelectorAll('.choice-row').forEach((row) => {
              const k = Object.keys(mRow.choices).find((ck) => fuzzyMatch(ck, row.dataset.choiceValue));
              if (k !== undefined) row.querySelector('.choice-percent-input').value = mRow.choices[k];
            });
          });
        }
      });
      updateAllSums();
      closeTextModal();
      alert(`Đã khớp tỷ lệ % cho ${matched} câu hỏi.`);
    });

    function parseTextPercentages(text) {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const qData = [];
      let cur = null;
      lines.forEach((line) => {
        if (line.match(/^câu\s+\d+(\.\d+)*:/i) || line.includes('?') || line.startsWith('PHẦN ')) {
          cur = { title: line, choices: {} };
          qData.push(cur);
        } else if (cur) {
          const pm = line.match(/(\d+)\s*%/);
          if (pm) {
            const pct = parseInt(pm[1], 10);
            const ci = line.indexOf(':');
            let ct = (ci !== -1 && ci < line.indexOf(pm[0])) ? line.substring(0, ci) : line.split(pm[0])[0];
            ct = ct.replace(/[:\-–—\s.\d]+$/, '').replace(/^[\-–—\s.\d]+/, '').trim();
            if (ct) cur.choices[ct.toLowerCase()] = pct;
          }
        }
      });
      return qData;
    }

    // Collect & Apply Config Payloads
    function collectFieldsConfig() {
      const config = {};
      document.querySelectorAll('.question-item').forEach((qItem) => {
        const id = qItem.dataset.id, type = qItem.dataset.type;
        if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
          config[id] = {
            type,
            strategy: qItem.querySelector('.strategy-select')?.value || 'custom_list',
            static_value: qItem.querySelector('.static-value-input')?.value || '',
            ai_prompt: qItem.querySelector('.question-ai-prompt-input')?.value.trim() || '',
          };
        } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
          const options = {};
          qItem.querySelectorAll('.choice-row').forEach((r) => (options[r.dataset.choiceValue] = parseInt(r.querySelector('.choice-percent-input').value, 10) || 0));
          config[id] = { type, options };
        } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
          const rows = {};
          qItem.querySelectorAll('.grid-row-container').forEach((rc) => {
            const opts = {};
            rc.querySelectorAll('.choice-row').forEach((cr) => (opts[cr.dataset.choiceValue] = parseInt(cr.querySelector('.choice-percent-input').value, 10) || 0));
            rows[rc.dataset.rowName] = opts;
          });
          config[id] = { type, rows };
        }
      });
      return config;
    }

    function getCurrentConfigPayload() {
      if (!parsedForm) return null;
      const percentages = {}, strategies = {}, static_values = {};
      document.querySelectorAll('.question-item').forEach((qItem) => {
        const id = qItem.dataset.id, type = qItem.dataset.type;
        if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
          strategies[id] = qItem.querySelector('.strategy-select')?.value || 'custom_list';
          static_values[id] = qItem.querySelector('.static-value-input')?.value || '';
        } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
          percentages[id] = {};
          qItem.querySelectorAll('.choice-row').forEach((r) => (percentages[id][r.dataset.choiceValue] = parseInt(r.querySelector('.choice-percent-input').value, 10) || 0));
        } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
          percentages[id] = {};
          qItem.querySelectorAll('.grid-row-container').forEach((rc) => {
            percentages[id][rc.dataset.rowName] = {};
            rc.querySelectorAll('.choice-row').forEach((cr) => (percentages[id][rc.dataset.rowName][cr.dataset.choiceValue] = parseInt(cr.querySelector('.choice-percent-input').value, 10) || 0));
          });
        }
      });
      return {
        url: parsedForm.url,
        title: parsedForm.title,
        description: parsedForm.description,
        submissions: parseInt(document.getElementById('campaign-submissions').value, 10) || 10,
        delay: parseFloat(document.getElementById('campaign-delay').value) || 1.0,
        percentages, strategies, static_values,
        rules: activeRules,
      };
    }

    function applyConfigPayload(config) {
      if (!parsedForm || !config) return;
      if (config.submissions) document.getElementById('campaign-submissions').value = config.submissions;
      if (config.delay) document.getElementById('campaign-delay').value = config.delay;
      if (Array.isArray(config.rules)) { activeRules = config.rules; renderRulesList(); }

      if (config.version === 2 && Array.isArray(config.qSegments)) {
        document.querySelectorAll('.question-item').forEach((qItem, idx) => {
          const seg = config.qSegments[idx];
          if (!seg) return;
          const type = qItem.dataset.type;
          if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
            const sel = qItem.querySelector('.strategy-select');
            if (sel) { sel.value = CODE_TO_STRATEGY[seg[0]] || 'custom_list'; window.handleStrategyChange(sel); }
            if (config.customTexts?.[idx] !== undefined) {
              const ta = qItem.querySelector('.static-value-input');
              if (ta) { ta.value = config.customTexts[idx]; window.updateCustomListCount(ta); }
            }
          } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
            qItem.querySelectorAll('.choice-percent-input').forEach((inp, cIdx) => { if (seg[cIdx] !== undefined) inp.value = seg[cIdx]; });
          } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
            const rowSegs = [];
            let cur = [];
            seg.forEach((b) => { if (b === 253) { rowSegs.push(cur); cur = []; } else cur.push(b); });
            rowSegs.push(cur);
            qItem.querySelectorAll('.grid-row-container').forEach((rc, rIdx) => {
              const rs = rowSegs[rIdx] || [];
              rc.querySelectorAll('.choice-percent-input').forEach((inp, cIdx) => { if (rs[cIdx] !== undefined) inp.value = rs[cIdx]; });
            });
          }
        });
        return updateAllSums();
      }

      if (config.percentages) {
        document.querySelectorAll('.question-item').forEach((qItem) => {
          const id = qItem.dataset.id, type = qItem.dataset.type, pCfg = config.percentages[id];
          if (!pCfg) return;
          if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
            qItem.querySelectorAll('.choice-row').forEach((row) => {
              if (pCfg[row.dataset.choiceValue] !== undefined) row.querySelector('.choice-percent-input').value = pCfg[row.dataset.choiceValue];
            });
          } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
            qItem.querySelectorAll('.grid-row-container').forEach((rc) => {
              const rCfg = pCfg[rc.dataset.rowName];
              if (!rCfg) return;
              rc.querySelectorAll('.choice-row').forEach((row) => {
                if (rCfg[row.dataset.choiceValue] !== undefined) row.querySelector('.choice-percent-input').value = rCfg[row.dataset.choiceValue];
              });
            });
          }
        });
      }
      if (config.strategies) {
        document.querySelectorAll('.question-item').forEach((qItem) => {
          const id = qItem.dataset.id, type = qItem.dataset.type;
          if (['Short', 'Paragraph', 'UserEmail'].includes(type) && config.strategies[id]) {
            const sel = qItem.querySelector('.strategy-select');
            if (sel) { sel.value = config.strategies[id]; window.handleStrategyChange(sel); }
            if (config.static_values?.[id]) {
              const ta = qItem.querySelector('.static-value-input');
              if (ta) { ta.value = config.static_values[id]; window.updateCustomListCount(ta); }
            }
          }
        });
      }
      updateAllSums();
    }

    // Save / Export CONFIG_2_ / Export JSON / Import JSON
    function saveFormToLocalStorage(url, data, payload) {
      const saved = JSON.parse(localStorage.getItem('saved_forms') || '[]');
      const idx = saved.findIndex((f) => f.url === url);
      const entry = { url, title: data.title, description: data.description || '', platform: data.platform || 'google', data, configPayload: payload || (idx >= 0 ? saved[idx].configPayload : null) };
      if (idx >= 0) saved[idx] = entry; else saved.push(entry);
      localStorage.setItem('saved_forms', JSON.stringify(saved));
    }

    document.getElementById('btn-save-config')?.addEventListener('click', () => {
      if (!parsedForm) return;
      const payload = getCurrentConfigPayload();
      saveFormToLocalStorage(payload.url, parsedForm, payload);
      alert('Đã lưu cấu hình vào lịch sử trình duyệt.');
    });

    document.getElementById('btn-export-config')?.addEventListener('click', () => {
      if (!parsedForm) return;
      const p = getCurrentConfigPayload();
      const code = encodeShortConfigCode(p.url, p.submissions, p.delay);
      navigator.clipboard?.writeText(code).catch(() => {});
      openModal('Mã Cấu Hình Nhanh (CONFIG_2)', `<p style="font-size:13px; color:var(--text-muted); margin-bottom:10px;">Đã sao chép (${code.length} ký tự). Dán vào ô nhập ở Trang chủ để khôi phục ngay:</p><textarea rows="4" readonly>${esc(code)}</textarea>`);
    });

    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      if (!parsedForm) return;
      const payload = { form_data: parsedForm, config: getCurrentConfigPayload() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'autofillform_config.json';
      a.click();
    });

    document.getElementById('btn-import-json-trigger')?.addEventListener('click', () => document.getElementById('import-json-file').click());
    document.getElementById('import-json-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          if (!obj.form_data) throw new Error('File JSON không hợp lệ.');
          loadFormIntoWorkspace(obj.form_data, obj.config || null);
        } catch (err) {
          alert(err.message);
        }
      };
      reader.readAsText(file);
    });

    function renderSavedFormsList() {
      const container = document.getElementById('saved-forms-list-container');
      const empty = document.getElementById('empty-manage-state');
      const saved = JSON.parse(localStorage.getItem('saved_forms') || '[]');
      if (!saved.length) { empty.classList.remove('hidden'); container.innerHTML = ''; return; }
      empty.classList.add('hidden');
      container.innerHTML = `
        <div class="card"><div class="card-body" style="padding:0;">
          <table class="data-table">
            <thead><tr><th>Nền tảng</th><th>Tên biểu mẫu</th><th style="text-align:right">Thao tác</th></tr></thead>
            <tbody>
              ${saved.map((f, idx) => `
                <tr>
                  <td><span class="question-badge">${f.platform === 'microsoft' ? 'MS Forms' : 'Google'}</span></td>
                  <td><strong>${esc(f.title)}</strong></td>
                  <td style="text-align:right">
                    <button class="btn btn-primary btn-xs btn-open-saved" data-idx="${idx}">Mở lại</button>
                    <button class="btn btn-danger btn-xs btn-del-saved" data-idx="${idx}">Xóa</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div></div>
      `;
      container.querySelectorAll('.btn-open-saved').forEach((b) => {
        b.addEventListener('click', () => {
          const f = saved[parseInt(b.dataset.idx, 10)];
          loadFormIntoWorkspace(f.data, f.configPayload || null);
        });
      });
      container.querySelectorAll('.btn-del-saved').forEach((b) => {
        b.addEventListener('click', () => {
          saved.splice(parseInt(b.dataset.idx, 10), 1);
          localStorage.setItem('saved_forms', JSON.stringify(saved));
          renderSavedFormsList();
        });
      });
    }

    // ==========================================================================
    // LOGIC RULES ENGINE UI
    // ==========================================================================
    function getSingleChoiceQuestions(formData) {
      const list = [];
      (formData?.pages || []).forEach((p) => (p.elements || []).forEach((el) => {
        if (['Radio', 'Dropdown', 'Scale'].includes(el.type) && el.choices?.length) list.push(el);
      }));
      return list;
    }

    function populateRuleSelectors(formData) {
      const qs = getSingleChoiceQuestions(formData);
      const srcQ = document.getElementById('rule-src-q');
      const dstQ = document.getElementById('rule-dst-q');
      if (!srcQ || !dstQ) return;
      const opts = qs.map((q) => `<option value="${esc(q.id)}">${esc(q.name)}</option>`).join('');
      srcQ.innerHTML = opts;
      dstQ.innerHTML = opts;
      if (qs.length > 1) dstQ.selectedIndex = 1;

      const syncChoiceSel = (qSel, cSelId) => {
        const q = qs.find((x) => String(x.id) === qSel.value);
        const cSel = document.getElementById(cSelId);
        if (cSel) cSel.innerHTML = (q?.choices || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      };
      srcQ.onchange = () => syncChoiceSel(srcQ, 'rule-src-choice');
      dstQ.onchange = () => syncChoiceSel(dstQ, 'rule-dst-choice');
      syncChoiceSel(srcQ, 'rule-src-choice');
      syncChoiceSel(dstQ, 'rule-dst-choice');
    }

    function renderRulesList() {
      const box = document.getElementById('rules-list-container');
      if (!box) return;
      if (!activeRules.length) {
        box.innerHTML = '<p style="font-size:12.5px; color:var(--text-hint);">Chưa có quy tắc nào. Bạn có thể tự thêm hoặc bấm "AI gợi ý quy tắc".</p>';
        return;
      }
      box.innerHTML = activeRules.map((r, idx) => `
        <div class="choice-row" style="padding:10px 12px;">
          <div style="flex:1;">
            <div style="font-size:13px; font-weight:700;">
              Nếu <em>${esc(r.source_name || r.source_id)}</em> = <span style="color:var(--cyan);">${esc(r.source_choice)}</span>
              → ${r.operator === 'exclude' ? '<span style="color:var(--danger);">Loại trừ</span>' : '<span style="color:var(--accent);">Bắt buộc</span>'}
              <em>${esc(r.target_name || r.target_id)}</em> ∈ [${esc((r.target_choices || []).join(', '))}]
            </div>
            ${r.reason ? `<div style="font-size:11.5px; color:var(--text-muted);">${esc(r.reason)}</div>` : ''}
          </div>
          <label style="display:flex; align-items:center; gap:5px; font-size:12px;">
            <input type="checkbox" class="rule-toggle" data-idx="${idx}" ${r.enabled !== false ? 'checked' : ''} style="width:auto;" /> Bật
          </label>
          <button class="btn btn-danger btn-xs rule-del" data-idx="${idx}">Xóa</button>
        </div>
      `).join('');

      box.querySelectorAll('.rule-toggle').forEach((chk) => {
        chk.addEventListener('change', () => { activeRules[parseInt(chk.dataset.idx, 10)].enabled = chk.checked; });
      });
      box.querySelectorAll('.rule-del').forEach((b) => {
        b.addEventListener('click', () => { activeRules.splice(parseInt(b.dataset.idx, 10), 1); renderRulesList(); });
      });
    }

    document.getElementById('btn-add-rule')?.addEventListener('click', () => {
      const srcQ = document.getElementById('rule-src-q'), dstQ = document.getElementById('rule-dst-q');
      const sc = document.getElementById('rule-src-choice').value, dc = document.getElementById('rule-dst-choice').value;
      if (!srcQ.value || !dstQ.value || srcQ.value === dstQ.value) return alert('Câu nguồn và câu đích phải khác nhau.');
      activeRules.push({
        id: 'rule_' + Date.now(),
        source_id: srcQ.value,
        source_name: srcQ.options[srcQ.selectedIndex]?.text || '',
        source_choice: sc,
        operator: document.getElementById('rule-op').value,
        target_id: dstQ.value,
        target_name: dstQ.options[dstQ.selectedIndex]?.text || '',
        target_choices: [dc],
        enabled: true,
      });
      renderRulesList();
    });

    document.getElementById('btn-ai-suggest-rules')?.addEventListener('click', async () => {
      if (!parsedForm) return;
      const btn = document.getElementById('btn-ai-suggest-rules');
      btn.disabled = true; btn.textContent = 'AI đang phân tích...';
      try {
        const res = await fetch('/api/rules/suggest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form_data: parsedForm, custom_api_key: getCustomApiKey() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        activeRules = activeRules.concat(data.rules || []);
        renderRulesList();
        alert(`AI đã gợi ý ${(data.rules || []).length} quy tắc logic. Hãy kiểm tra và bật/tắt theo ý muốn.`);
      } catch (err) { alert(err.message); }
      finally { btn.disabled = false; btn.textContent = 'AI gợi ý quy tắc (Free)'; }
    });

    document.getElementById('btn-validate-rules')?.addEventListener('click', async () => {
      const res = await fetch('/api/rules/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_data: parsedForm, rules: activeRules }),
      });
      const data = await res.json();
      const box = document.getElementById('rules-validation-msg');
      box.classList.remove('hidden');
      if (data.valid) {
        box.innerHTML = `<div class="info-banner" style="margin:0;">✓ Quy tắc hợp lệ, không có mâu thuẫn hay vòng lặp. ${data.warnings?.length ? 'Cảnh báo: ' + esc(data.warnings.join('; ')) : ''}</div>`;
      } else {
        box.innerHTML = `<div class="error-msg" style="margin:0;">${esc(data.errors.join(' | '))}</div>`;
      }
    });

    // ==========================================================================
    // SPREAD SCHEDULER UI
    // ==========================================================================
    const schedModeSel = document.getElementById('sched-mode');
    schedModeSel?.addEventListener('change', () => {
      document.getElementById('sched-window-box').classList.toggle('hidden', schedModeSel.value !== 'window');
      document.getElementById('sched-interval-box').classList.toggle('hidden', schedModeSel.value !== 'interval');
    });
    document.querySelectorAll('.sched-win-preset').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.sched-win-preset').forEach((x) => x.classList.remove('is-on'));
        b.classList.add('is-on');
        document.getElementById('sched-window-minutes').value = b.dataset.min;
      });
    });
    document.querySelectorAll('.sched-int-preset').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.sched-int-preset').forEach((x) => x.classList.remove('is-on'));
        b.classList.add('is-on');
        document.getElementById('sched-int-min').value = b.dataset.min;
        document.getElementById('sched-int-max').value = b.dataset.max;
      });
    });

    function getScheduleConfig() {
      return {
        mode: document.getElementById('sched-mode')?.value || 'immediate',
        delay_sec: parseFloat(document.getElementById('campaign-delay')?.value) || 1.0,
        window_minutes: parseInt(document.getElementById('sched-window-minutes')?.value, 10) || 60,
        interval_min_sec: parseFloat(document.getElementById('sched-int-min')?.value) || 60,
        interval_max_sec: parseFloat(document.getElementById('sched-int-max')?.value) || 180,
        start_at: document.getElementById('sched-start-at')?.value || '',
        rhythm: document.getElementById('sched-rhythm')?.value || 'natural',
        night_mode: document.getElementById('sched-night-mode')?.value || 'normal',
      };
    }

    // ==========================================================================
    // PRE-RUN PREVIEW
    // ==========================================================================
    document.getElementById('btn-preview-data')?.addEventListener('click', async () => {
      if (!parsedForm) return;
      const count = parseInt(document.getElementById('campaign-submissions').value, 10) || 10;
      const res = await fetch('/api/campaign/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_data: parsedForm,
          fields: collectFieldsConfig(),
          count,
          distribution_mode: document.getElementById('distribution-mode-select').value,
          rules: activeRules,
          schedule: getScheduleConfig(),
        }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Không thể xem trước.');

      const ths = `<th>Lượt</th><th>Giờ dự kiến</th>` + data.headers.map((h) => `<th>${esc(h.name.slice(0, 26))}</th>`).join('');
      const trs = data.rows.map((r, i) => `<tr><td>#${i + 1}</td><td>${esc(r._ts)}</td>` + data.headers.map((h) => `<td>${esc(r[h.id] || '')}</td>`).join('') + `</tr>`).join('');
      openModal('Xem trước Dữ liệu & Lịch trình', `
        <div class="info-banner">Bắt đầu dự kiến: <strong>${esc(data.estimated_start)}</strong> → Hoàn tất dự kiến: <strong>${esc(data.estimated_end)}</strong> (Hiển thị tối đa 8 mẫu đầu tiên)</div>
        <div class="table-scroll"><table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>
      `);
    });

    // ==========================================================================
    // FULL AUTO AI MODE
    // ==========================================================================
    document.getElementById('btn-full-ai-preview')?.addEventListener('click', async () => {
      if (!parsedForm) return;
      const btn = document.getElementById('btn-full-ai-preview');
      btn.disabled = true; btn.textContent = 'Đang tạo 3 người...';
      try {
        const res = await fetch('/api/ai-full-auto-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_data: parsedForm,
            persona_prompt: document.getElementById('full-ai-persona').value.trim(),
            trend: document.getElementById('full-ai-trend').value,
            count: 3,
            custom_api_key: getCustomApiKey(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const qNames = {};
        (parsedForm.pages || []).forEach((p) => (p.elements || []).forEach((el) => (qNames[el.id] = el.name)));
        document.getElementById('full-ai-preview-box').innerHTML = (data.respondents || []).map((r, idx) => `
          <div class="card" style="margin-bottom:10px;"><div class="card-header"><h3>Người mẫu #${idx + 1}: ${esc(r.persona)}</h3></div>
            <div class="card-body" style="font-size:12.5px;">
              ${Object.entries(r.answers || {}).map(([qid, v]) => `<div><strong>${esc(qNames[qid] || qid)}:</strong> ${esc(Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : v))}</div>`).join('')}
            </div>
          </div>
        `).join('');
      } catch (err) { alert(err.message); }
      finally { btn.disabled = false; btn.textContent = 'Xem thử 3 người (Miễn phí)'; }
    });

    document.getElementById('btn-full-ai-start')?.addEventListener('click', () => {
      if (!parsedForm) return;
      startCampaignRequest({
        run_mode: 'full_ai',
        form_data: parsedForm,
        persona_prompt: document.getElementById('full-ai-persona').value.trim(),
        ai_trend: document.getElementById('full-ai-trend').value,
        count: parseInt(document.getElementById('full-ai-count').value, 10) || 20,
        schedule: getScheduleConfig(),
        custom_api_key: getCustomApiKey(),
      });
    });

    // ==========================================================================
    // EXCEL / CSV BATCH IMPORT
    // ==========================================================================
    document.getElementById('btn-download-excel-tpl')?.addEventListener('click', async () => {
      if (!parsedForm) return;
      const res = await fetch('/api/excel/template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_data: parsedForm }),
      });
      if (!res.ok) return alert('Không tạo được file mẫu.');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'autofillform_mau.xlsx';
      a.click();
    });

    async function parseExcelUpload(overrideMapping) {
      const file = document.getElementById('excel-file-input').files?.[0];
      if (!file || !parsedForm) return alert('Vui lòng chọn file .xlsx hoặc .csv.');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('form_data', JSON.stringify(parsedForm));
      if (overrideMapping) fd.append('mapping', JSON.stringify(overrideMapping));

      const res = await fetch('/api/excel/parse', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Lỗi đọc file Excel/CSV.');
      excelValidatedData = data;

      document.getElementById('excel-result-box').classList.remove('hidden');
      document.getElementById('excel-stats-summary').innerHTML = `
        <div class="kpi-card"><small>Tổng dòng</small><strong>${data.total_rows}</strong></div>
        <div class="kpi-card"><small>Hợp lệ</small><strong>${data.valid_count}</strong></div>
        <div class="kpi-card ${data.error_count ? 'warn' : ''}"><small>Dòng lỗi</small><strong>${data.error_count}</strong></div>
      `;

      const targetOpts = `<option value="">-- Không dùng --</option>` + data.targets.map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('');
      document.getElementById('excel-mapping-box').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:13px;">Bảng ghép cột file với câu hỏi:</strong>
          <button type="button" id="btn-excel-remap" class="btn btn-secondary btn-xs">Kiểm tra lại theo bảng ghép mới</button>
        </div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Cột trong file</th><th>Ghép vào câu hỏi</th></tr></thead><tbody>
          ${data.headers.map((h) => `
            <tr><td><strong>${esc(h)}</strong></td>
            <td><select class="excel-map-sel" data-col="${esc(h)}">${targetOpts}</select></td></tr>
          `).join('')}
        </tbody></table></div>
      `;
      document.querySelectorAll('.excel-map-sel').forEach((sel) => { sel.value = data.mapping[sel.dataset.col] || ''; });
      document.getElementById('btn-excel-remap')?.addEventListener('click', () => {
        const newMap = {};
        document.querySelectorAll('.excel-map-sel').forEach((sel) => (newMap[sel.dataset.col] = sel.value));
        parseExcelUpload(newMap);
      });

      const errBox = document.getElementById('excel-errors-box');
      if (data.error_rows?.length) {
        errBox.innerHTML = `<div class="error-msg" style="margin:0;"><strong>Chi tiết dòng lỗi:</strong><ul style="padding-left:18px; margin-top:6px;">${data.error_rows.map((e) => `<li>Dòng ${e.row}: ${esc(e.reasons.join('; '))}</li>`).join('')}</ul></div>`;
      } else {
        errBox.innerHTML = '<div class="info-banner" style="margin:0;">✓ 100% dòng dữ liệu đều hợp lệ!</div>';
      }
    }

    document.getElementById('btn-parse-excel')?.addEventListener('click', () => parseExcelUpload(null));
    document.getElementById('btn-start-excel')?.addEventListener('click', () => {
      if (!excelValidatedData) return;
      const skipErr = document.getElementById('excel-skip-errors').checked;
      if (excelValidatedData.error_count > 0 && !skipErr) return alert('File có dòng lỗi. Hãy sửa file hoặc bật "Bỏ qua dòng lỗi".');
      if (!excelValidatedData.valid_records?.length) return alert('Không có dòng hợp lệ nào để chạy.');
      startCampaignRequest({
        run_mode: 'excel',
        form_data: parsedForm,
        excel_rows: excelValidatedData.valid_records,
        fields: collectFieldsConfig(),
        rules: activeRules,
        schedule: getScheduleConfig(),
      });
    });

    // ==========================================================================
    // CAMPAIGN RUNNER & POLLING
    // ==========================================================================
    async function startCampaignRequest(payload) {
      const btnStart = document.getElementById('btn-start');
      const btnStop = document.getElementById('btn-stop');
      btnStart.classList.add('hidden');
      btnStop.classList.remove('hidden');

      try {
        const res = await fetch('/api/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Không thể khởi chạy chiến dịch.');
        addLog('system', `Đã bắt đầu chiến dịch (${data.total} lượt). Dự kiến xong: ${data.estimated_end || 'ngay'}`);
        startPolling();
      } catch (err) {
        alert(err.message);
        restoreRunButtons();
      }
    }

    document.getElementById('btn-start')?.addEventListener('click', () => {
      if (!parsedForm) return;
      const invalid = [];
      document.querySelectorAll('.question-item').forEach((qItem) => {
        if (qItem.classList.contains('invalid-question')) {
          invalid.push(qItem.querySelector('.question-title').textContent.trim());
        }
      });
      if (invalid.length) {
        return alert(`Vui lòng đặt đủ tổng 100% cho các câu hỏi sau:\n- ${invalid.join('\n- ')}`);
      }
      startCampaignRequest({
        run_mode: 'standard',
        form_data: parsedForm,
        fields: collectFieldsConfig(),
        count: parseInt(document.getElementById('campaign-submissions').value, 10) || 10,
        delay: parseFloat(document.getElementById('campaign-delay').value) || 1.0,
        distribution_mode: document.getElementById('distribution-mode-select').value,
        rules: activeRules,
        schedule: getScheduleConfig(),
      });
    });

    document.getElementById('btn-stop')?.addEventListener('click', async () => {
      document.getElementById('btn-stop').disabled = true;
      await fetch('/api/stop', { method: 'POST' });
    });

    document.getElementById('btn-skip-wait')?.addEventListener('click', async () => {
      await fetch('/api/skip-wait', { method: 'POST' });
    });

    function startPolling() {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/status');
          const d = await res.json();
          document.getElementById('run-success').textContent = d.success;
          document.getElementById('run-failed').textContent = d.failed;
          document.getElementById('run-progress').textContent = `${d.current}/${d.total}`;
          document.getElementById('progress-bar-fill').style.width = `${d.total ? Math.floor((d.current / d.total) * 100) : 0}%`;

          const etaEl = document.getElementById('runner-eta-info');
          const skipBtn = document.getElementById('btn-skip-wait');
          if (d.next_run_at) {
            etaEl.textContent = `⏳ Lượt tiếp theo lúc: ${d.next_run_at} | Hoàn tất dự kiến: ${d.estimated_end}`;
            skipBtn.classList.remove('hidden');
          } else {
            etaEl.textContent = d.estimated_end ? `Hoàn tất dự kiến: ${d.estimated_end}` : '';
            skipBtn.classList.add('hidden');
          }

          renderLogs(d.logs || []);
          if (!d.active) {
            clearInterval(pollInterval);
            restoreRunButtons();
            notifyUser('AutoFillForm Studio', `Chiến dịch hoàn tất: ${d.success}/${d.total} lượt thành công!`);
          }
        } catch (e) {}
      }, 1000);
    }

    function renderLogs(logs) {
      const lc = document.getElementById('logs-container');
      lc.innerHTML = '';
      logs.forEach((log) => {
        const div = document.createElement('div');
        div.className = 'log-line ' + (log.includes('✅') ? 'success-log' : (log.includes('❌') ? 'error-log' : 'system-log'));
        div.textContent = log;
        lc.appendChild(div);
      });
      lc.scrollTop = lc.scrollHeight;
    }

    function restoreRunButtons() {
      document.getElementById('btn-start').classList.remove('hidden');
      const stopBtn = document.getElementById('btn-stop');
      stopBtn.classList.add('hidden');
      stopBtn.disabled = false;
      document.getElementById('btn-skip-wait').classList.add('hidden');
    }

    document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
      document.getElementById('logs-container').innerHTML = '<div class="log-line system-log">Đã xóa nhật ký.</div>';
    });

    checkAuthState();
  });
})();
