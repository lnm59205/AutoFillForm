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

  document.addEventListener('DOMContentLoaded', () => {
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
