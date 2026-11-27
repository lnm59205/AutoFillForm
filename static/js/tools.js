(function () {
  'use strict';

  let tsData = null;
  let tsPreviewRes = null;
  let deferredPrompt = null;
  let currentLang = localStorage.getItem('aff_lang') || 'vi';

  const I18N = {
    vi: {
      nav_fill: 'ĐIỀN FORM', m_home: 'Nhập Form', m_campaign: 'Chiến dịch',
      nav_tools: 'CÔNG CỤ', m_designer: 'Thiết kế Form AI', m_research: 'SPSS / SmartPLS', m_timestamp: 'Sửa Giờ Sheet',
      nav_system: 'HỆ THỐNG', m_history: 'Đã lưu', m_settings: 'Cài đặt & PWA', logout: 'Đăng xuất',
    },
    en: {
      nav_fill: 'FILL FORM', m_home: 'Import Form', m_campaign: 'Campaign',
      nav_tools: 'TOOLS', m_designer: 'AI Designer', m_research: 'SPSS / SmartPLS', m_timestamp: 'Timestamps',
      nav_system: 'SYSTEM', m_history: 'Saved', m_settings: 'Settings & PWA', logout: 'Sign Out',
    },
  };

  function applyLang() {
    const dict = I18N[currentLang] || I18N.vi;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.dataset.i18n;
      if (dict[k]) el.textContent = dict[k];
    });
    const lb = document.getElementById('btn-lang-toggle');
    if (lb) lb.textContent = currentLang === 'vi' ? 'VI / EN' : 'EN / VI';
  }

  function applyTheme(theme) {
    document.body.classList.toggle('theme-light', theme === 'light');
    const tb = document.getElementById('btn-theme-toggle');
    if (tb) tb.textContent = theme === 'light' ? 'Sáng' : 'Tối';
  }

  function showToast(msg, type) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const text = String(msg || '');
    const resolved = type || (/lỗi|không thể|thiếu|vui lòng|vượt quá|không hợp lệ|tồn tại|chưa /i.test(text) ? 'error' : (/thành công|đã lưu|đã sao chép|sẵn sàng|khớp/i.test(text) ? 'success' : 'info'));
    const el = document.createElement('div');
    el.className = `toast-item toast-${resolved}`;
    el.innerHTML = `<span class="toast-dot"></span><div style="flex:1; white-space:pre-line;">${window.AFF ? window.AFF.esc(text) : text}</div><button class="toast-close" aria-label="Đóng">&times;</button>`;
    el.querySelector('.toast-close').onclick = () => el.remove();
    stack.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  window.AFF_UI = { toast: showToast };
  window.alert = (msg) => showToast(msg);

  // Universal custom modern select enhancer (keeps native <select> synced for all JS callers)
  function initCustomSelects() {
    let activeMenu = null;
    let activeWrap = null;
    const protoDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

    function closeMenu() {
      if (activeMenu) { activeMenu.remove(); activeMenu = null; }
      if (activeWrap) { activeWrap.classList.remove('is-open'); activeWrap = null; }
    }

    function syncLabel(sel, lbl) {
      const opt = sel.options[sel.selectedIndex];
      lbl.textContent = opt ? opt.textContent : '';
    }

    function enhanceSelect(sel) {
      if (!sel || sel.dataset.affEnhanced || sel.multiple) return;
      sel.dataset.affEnhanced = '1';

      const wrap = document.createElement('div');
      wrap.className = 'aff-select-wrap';
      if (sel.id === 'fd-code-style' || sel.id === 'distribution-mode-select') wrap.classList.add('is-compact');
      if (sel.style.maxWidth) wrap.style.maxWidth = sel.style.maxWidth;
      if (sel.style.width === 'auto') wrap.style.width = 'auto';
      if (sel.style.flex) wrap.style.flex = sel.style.flex;

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'aff-select-trigger';
      trigger.innerHTML = `<span class="aff-select-label"></span><svg class="aff-select-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>`;
      const lbl = trigger.querySelector('.aff-select-label');

      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      wrap.appendChild(trigger);
      sel.classList.add('aff-select-native');
      syncLabel(sel, lbl);

      // Sync when JS assigns sel.value directly
      if (protoDesc && protoDesc.set) {
        Object.defineProperty(sel, 'value', {
          configurable: true,
          get() { return protoDesc.get.call(this); },
          set(v) { protoDesc.set.call(this, v); syncLabel(sel, lbl); },
        });
      }
      sel.addEventListener('change', () => syncLabel(sel, lbl));
      new MutationObserver(() => syncLabel(sel, lbl)).observe(sel, { childList: true, subtree: true });

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeWrap === wrap) return closeMenu();
        closeMenu();

        const rect = trigger.getBoundingClientRect();
        const menu = document.createElement('div');
        menu.className = 'aff-select-menu';
        menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 180) - 8))}px`;
        menu.style.width = `${Math.max(rect.width, 160)}px`;

        Array.from(sel.options).forEach((opt, idx) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'aff-select-opt' + (idx === sel.selectedIndex ? ' is-selected' : '');
          btn.innerHTML = `<span>${window.AFF ? window.AFF.esc(opt.textContent) : opt.textContent}</span>${idx === sel.selectedIndex ? '<span>✓</span>' : ''}`;
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            sel.selectedIndex = idx;
            syncLabel(sel, lbl);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            closeMenu();
          });
          menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        const mh = menu.getBoundingClientRect().height;
        const topPos = (rect.bottom + 6 + mh > window.innerHeight - 10) ? Math.max(8, rect.top - mh - 6) : rect.bottom + 6;
        menu.style.top = `${topPos}px`;
        wrap.classList.add('is-open');
        activeMenu = menu;
        activeWrap = wrap;
      });
    }

    document.querySelectorAll('select').forEach(enhanceSelect);
    new MutationObserver((muts) => {
      muts.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'SELECT') enhanceSelect(n);
        else n.querySelectorAll?.('select').forEach(enhanceSelect);
      }));
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', closeMenu);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initCustomSelects();
    // Theme & Language
    const savedTheme = localStorage.getItem('aff_theme') || 'dark';
    applyTheme(savedTheme);
    applyLang();

    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
      localStorage.setItem('aff_theme', next);
      applyTheme(next);
    });
    document.getElementById('btn-lang-toggle')?.addEventListener('click', () => {
      currentLang = currentLang === 'vi' ? 'en' : 'vi';
      localStorage.setItem('aff_lang', currentLang);
      applyLang();
    });

    // Settings (Groq API Key)
    const keyInput = document.getElementById('setting-groq-key');
    if (keyInput) keyInput.value = localStorage.getItem('aff_custom_groq_key') || '';
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      localStorage.setItem('aff_custom_groq_key', (keyInput?.value || '').trim());
      alert('Đã lưu cấu hình API Key.');
    });

    // PWA & Notifications
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      document.getElementById('btn-install-pwa')?.classList.remove('hidden');
    });
    document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      document.getElementById('btn-install-pwa')?.classList.add('hidden');
    });
    document.getElementById('btn-enable-notif')?.addEventListener('click', async () => {
      if (!('Notification' in window)) return alert('Trình duyệt không hỗ trợ Notification API.');
      const perm = await Notification.requestPermission();
      const st = document.getElementById('pwa-status-text');
      if (perm === 'granted') {
        new Notification('AutoFillForm Studio', { body: 'Thông báo đã sẵn sàng! Bạn sẽ nhận tin khi chiến dịch xong.' });
        if (st) st.textContent = '✓ Đã bật thông báo trình duyệt.';
      } else if (st) {
        st.textContent = 'Trình duyệt đang chặn thông báo (Hãy mở quyền ở biểu tượng ổ khóa thanh địa chỉ).';
      }
    });

    // Modern File Dropzone enhancer (click + drag-and-drop + filename state)
    document.querySelectorAll('.file-dropzone').forEach((zone) => {
      const inp = zone.querySelector('input[type="file"]');
      const nameEl = zone.querySelector('.file-drop-name');
      if (!inp || !nameEl) return;
      const defaultTxt = nameEl.textContent;

      const refresh = () => {
        const f = inp.files && inp.files[0];
        if (f) {
          const kb = Math.max(1, Math.round(f.size / 1024));
          nameEl.textContent = `${f.name} (${kb} KB)`;
          zone.classList.add('has-file');
        } else {
          nameEl.textContent = defaultTxt;
          zone.classList.remove('has-file');
        }
      };

      inp.addEventListener('change', refresh);
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('is-dragover');
        if (e.dataTransfer?.files?.length) {
          inp.files = e.dataTransfer.files;
          refresh();
        }
      });
    });

    // Google Sheet Timestamp Editor
    async function loadTimestampSource(isFile) {
      let res;
      if (isFile) {
        const f = document.getElementById('ts-file-input').files?.[0];
        if (!f) return alert('Vui lòng chọn file CSV hoặc XLSX.');
        const fd = new FormData();
        fd.append('file', f);
        res = await fetch('/api/timestamp/load', { method: 'POST', body: fd });
      } else {
        const url = document.getElementById('ts-sheet-url').value.trim();
        if (!url) return alert('Vui lòng nhập link Google Sheet.');
        res = await fetch('/api/timestamp/load', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheet_url: url }),
        });
      }
      const data = await res.json();
      if (!res.ok) return alert(data.error);
      tsData = data;
      const info = document.getElementById('ts-loaded-info');
      info.classList.remove('hidden');
      info.innerHTML = `✓ Đã đọc <strong>${data.total_rows}</strong> dòng | Cột Dấu thời gian nhận diện: <strong>${window.AFF.esc(data.headers[data.ts_col_idx] || 'Cột 1')}</strong>`;
    }

    document.getElementById('ts-load-btn')?.addEventListener('click', () => loadTimestampSource(false));
    document.getElementById('ts-load-file-btn')?.addEventListener('click', () => loadTimestampSource(true));

    document.getElementById('ts-preview-btn')?.addEventListener('click', async () => {
      if (!tsData) return alert('Hãy đọc dữ liệu Sheet hoặc file CSV/XLSX trước.');
      const schedMode = document.getElementById('ts-sched-mode').value;
      const numVal = parseInt(document.getElementById('ts-window-min').value, 10) || 180;
      const res = await fetch('/api/timestamp/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: tsData.rows,
          ts_col_idx: tsData.ts_col_idx,
          selection_mode: document.getElementById('ts-sel-mode').value,
          range_spec: document.getElementById('ts-range-spec').value.trim(),
          schedule: {
            mode: schedMode,
            window_minutes: numVal,
            interval_min_sec: Math.max(5, Math.floor(numVal * 0.7)),
            interval_max_sec: Math.max(10, numVal),
            start_at: document.getElementById('ts-start-at').value,
            rhythm: document.getElementById('ts-rhythm').value,
            night_mode: document.getElementById('ts-night').value,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error);
      tsPreviewRes = data;
      document.getElementById('ts-preview-area').classList.remove('hidden');
      document.getElementById('ts-preview-table').innerHTML = `
        <table class="data-table">
          <thead><tr><th>Dòng #</th><th>Dấu thời gian cũ</th><th>Dấu thời gian mới</th><th>Mẫu dữ liệu</th></tr></thead>
          <tbody>${(data.preview || []).map((r) => `
            <tr><td>${r.row}</td><td style="color:var(--text-hint)">${window.AFF.esc(r.old_ts)}</td><td style="color:var(--accent); font-weight:700;">${window.AFF.esc(r.new_ts)}</td><td>${window.AFF.esc(r.sample)}</td></tr>
          `).join('')}</tbody>
        </table>
      `;
    });

    async function exportTimestamp(fmt) {
      if (!tsData || !tsPreviewRes) return alert('Hãy bấm Xem trước thay đổi trước khi xuất.');
      const res = await fetch('/api/timestamp/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers: tsData.headers, rows: tsData.rows, ts_col_idx: tsData.ts_col_idx,
          updated_map: tsPreviewRes.updated_map, format: fmt,
        }),
      });
      if (!res.ok) return alert('Lỗi xuất file.');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fmt === 'xlsx' ? 'sheet_updated_timestamps.xlsx' : 'sheet_updated_timestamps.csv';
      a.click();
    }
    document.getElementById('ts-export-csv')?.addEventListener('click', () => exportTimestamp('csv'));
    document.getElementById('ts-export-xlsx')?.addEventListener('click', () => exportTimestamp('xlsx'));
    document.getElementById('ts-copy-gs')?.addEventListener('click', () => {
      if (!tsPreviewRes?.apps_script) return alert('Hãy bấm Xem trước thay đổi trước.');
      navigator.clipboard?.writeText(tsPreviewRes.apps_script).catch(() => {});
      window.AFF.openModal('Google Apps Script Cập Nhật Cột Dấu Thời Gian', `
        <div class="info-banner">Mở Google Sheet của bạn → <strong>Tiện ích mở rộng (Extensions) → Apps Script</strong> → Dán code bên dưới → Lưu & Chạy <code>applyNewTimestamps</code>. Chỉ cột Dấu thời gian được cập nhật, mọi câu trả lời giữ nguyên 100%!</div>
        <textarea rows="10" readonly style="font-family:var(--mono); font-size:11.5px;">${window.AFF.esc(tsPreviewRes.apps_script)}</textarea>
      `);
    });
  });
})();
