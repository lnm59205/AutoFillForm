(function () {
  'use strict';

  let modelSpec = {
    sample_size: 250,
    scale_points: 5,
    constructs: [
      { code: 'CL', name: 'Chất lượng dịch vụ', role: 'IV', items: [{ code: 'CL1', label: 'Dịch vụ ổn định' }, { code: 'CL2', label: 'Giao diện dễ dùng' }, { code: 'CL3', label: 'Hỗ trợ nhanh chóng' }] },
      { code: 'GC', name: 'Giá cả cảm nhận', role: 'IV', items: [{ code: 'GC1', label: 'Chi phí hợp lý' }, { code: 'GC2', label: 'Tương xứng giá trị' }, { code: 'GC3', label: 'Nhiều ưu đãi' }] },
      { code: 'HL', name: 'Sự hài lòng', role: 'MED', items: [{ code: 'HL1', label: 'Hài lòng tổng thể' }, { code: 'HL2', label: 'Đáp ứng kỳ vọng' }, { code: 'HL3', label: 'Trải nghiệm tích cực' }] },
      { code: 'YD', name: 'Ý định tiếp tục', role: 'DV', items: [{ code: 'YD1', label: 'Tiếp tục sử dụng' }, { code: 'YD2', label: 'Giới thiệu bạn bè' }, { code: 'YD3', label: 'Ưu tiên lựa chọn' }] },
    ],
    paths: [
      { label: 'H1', from: 'CL', to: 'HL', beta: 0.42 },
      { label: 'H2', from: 'GC', to: 'HL', beta: 0.34 },
      { label: 'H3', from: 'HL', to: 'YD', beta: 0.56 },
    ],
    demographics: [],
  };

  let currentDataset = null;
  let currentAnalysis = null;

  function esc(s) { return window.AFF ? window.AFF.esc(s) : String(s || ''); }

  document.addEventListener('DOMContentLoaded', () => {
    const cList = document.getElementById('res-constructs-list');
    if (!cList) return;

    function renderModel() {
      document.getElementById('res-sample-size').value = modelSpec.sample_size || 250;
      document.getElementById('res-scale-points').value = String(modelSpec.scale_points || 5);

      cList.innerHTML = modelSpec.constructs.map((c, ci) => `
        <div class="question-item" style="padding:12px;">
          <div class="compact-row">
            <input type="text" class="rc-code" data-ci="${ci}" value="${esc(c.code)}" placeholder="Mã" style="max-width:72px;" />
            <input type="text" class="rc-name" data-ci="${ci}" value="${esc(c.name)}" placeholder="Tên biến" />
            <select class="rc-role" data-ci="${ci}" style="max-width:112px;">
              <option value="IV" ${c.role === 'IV' ? 'selected' : ''}>Độc lập (IV)</option>
              <option value="MED" ${c.role === 'MED' ? 'selected' : ''}>Trung gian</option>
              <option value="MOD" ${c.role === 'MOD' ? 'selected' : ''}>Điều tiết</option>
              <option value="DV" ${c.role === 'DV' ? 'selected' : ''}>Phụ thuộc (DV)</option>
            </select>
            <button class="btn btn-danger btn-xs rc-del" data-ci="${ci}">×</button>
          </div>
          <div style="font-size:12px;">
            ${(c.items || []).map((it, ii) => `
              <div style="display:flex; gap:6px; align-items:center; margin-bottom:4px;">
                <input type="text" class="ri-code" data-ci="${ci}" data-ii="${ii}" value="${esc(it.code)}" style="max-width:75px; padding:4px 6px; font-size:12px;" />
                <input type="text" class="ri-label" data-ci="${ci}" data-ii="${ii}" value="${esc(it.label)}" style="padding:4px 6px; font-size:12px;" />
                <label style="font-size:11px; white-space:nowrap;"><input type="checkbox" class="ri-rev" data-ci="${ci}" data-ii="${ii}" ${it.reverse ? 'checked' : ''} style="width:auto;" /> Đảo</label>
                <label style="font-size:11px; white-space:nowrap;"><input type="checkbox" class="ri-drop" data-ci="${ci}" data-ii="${ii}" ${it.dropped ? 'checked' : ''} style="width:auto;" /> Loại L2</label>
                <button class="btn btn-secondary btn-xs ri-del" data-ci="${ci}" data-ii="${ii}">×</button>
              </div>
            `).join('')}
            <button class="btn btn-secondary btn-xs ri-add" data-ci="${ci}">+ Item</button>
          </div>
        </div>
      `).join('');

      const pList = document.getElementById('res-paths-list');
      const codeOpts = modelSpec.constructs.map((c) => `<option value="${esc(c.code)}">${esc(c.code)}</option>`).join('');
      pList.innerHTML = modelSpec.paths.map((p, pi) => `
        <div class="compact-row">
          <input type="text" class="rp-lbl" data-pi="${pi}" value="${esc(p.label)}" style="max-width:54px; padding:6px;" />
          <select class="rp-from" data-pi="${pi}">${codeOpts}</select>
          <span style="font-size:12px;">→</span>
          <select class="rp-to" data-pi="${pi}">${codeOpts}</select>
          <input type="number" class="rp-beta" data-pi="${pi}" value="${p.beta}" step="0.05" min="-0.85" max="0.85" style="max-width:72px; padding:6px;" title="Hệ số β" />
          <button class="btn btn-danger btn-xs rp-del" data-pi="${pi}">×</button>
        </div>
      `).join('');
      pList.querySelectorAll('.rp-from').forEach((s) => (s.value = modelSpec.paths[+s.dataset.pi].from));
      pList.querySelectorAll('.rp-to').forEach((s) => (s.value = modelSpec.paths[+s.dataset.pi].to));

      bindModelEvents();
    }

    function bindModelEvents() {
      cList.querySelectorAll('.rc-code').forEach((i) => (i.oninput = () => (modelSpec.constructs[+i.dataset.ci].code = i.value.trim())));
      cList.querySelectorAll('.rc-name').forEach((i) => (i.oninput = () => (modelSpec.constructs[+i.dataset.ci].name = i.value)));
      cList.querySelectorAll('.rc-role').forEach((i) => (i.onchange = () => (modelSpec.constructs[+i.dataset.ci].role = i.value)));
      cList.querySelectorAll('.rc-del').forEach((b) => (b.onclick = () => { modelSpec.constructs.splice(+b.dataset.ci, 1); renderModel(); }));
      cList.querySelectorAll('.ri-code').forEach((i) => (i.oninput = () => (modelSpec.constructs[+i.dataset.ci].items[+i.dataset.ii].code = i.value.trim())));
      cList.querySelectorAll('.ri-label').forEach((i) => (i.oninput = () => (modelSpec.constructs[+i.dataset.ci].items[+i.dataset.ii].label = i.value)));
      cList.querySelectorAll('.ri-rev').forEach((i) => (i.onchange = () => (modelSpec.constructs[+i.dataset.ci].items[+i.dataset.ii].reverse = i.checked)));
      cList.querySelectorAll('.ri-drop').forEach((i) => (i.onchange = () => (modelSpec.constructs[+i.dataset.ci].items[+i.dataset.ii].dropped = i.checked)));
      cList.querySelectorAll('.ri-del').forEach((b) => (b.onclick = () => { modelSpec.constructs[+b.dataset.ci].items.splice(+b.dataset.ii, 1); renderModel(); }));
      cList.querySelectorAll('.ri-add').forEach((b) => (b.onclick = () => {
        const c = modelSpec.constructs[+b.dataset.ci];
        c.items.push({ code: `${c.code}${c.items.length + 1}`, label: 'Biến quan sát mới' });
        renderModel();
      }));

      const pList = document.getElementById('res-paths-list');
      pList.querySelectorAll('.rp-lbl').forEach((i) => (i.oninput = () => (modelSpec.paths[+i.dataset.pi].label = i.value)));
      pList.querySelectorAll('.rp-from').forEach((i) => (i.onchange = () => (modelSpec.paths[+i.dataset.pi].from = i.value)));
      pList.querySelectorAll('.rp-to').forEach((i) => (i.onchange = () => (modelSpec.paths[+i.dataset.pi].to = i.value)));
      pList.querySelectorAll('.rp-beta').forEach((i) => (i.oninput = () => (modelSpec.paths[+i.dataset.pi].beta = parseFloat(i.value) || 0.3)));
      pList.querySelectorAll('.rp-del').forEach((b) => (b.onclick = () => { modelSpec.paths.splice(+b.dataset.pi, 1); renderModel(); }));
    }

    document.getElementById('res-add-construct')?.addEventListener('click', () => {
      const idx = modelSpec.constructs.length + 1;
      const code = `F${idx}`;
      modelSpec.constructs.push({ code, name: `Nhân tố ${idx}`, role: 'IV', items: [{ code: `${code}1`, label: `${code}1` }, { code: `${code}2`, label: `${code}2` }, { code: `${code}3`, label: `${code}3` }] });
      renderModel();
    });
    document.getElementById('res-add-path')?.addEventListener('click', () => {
      if (modelSpec.constructs.length < 2) return;
      modelSpec.paths.push({ label: `H${modelSpec.paths.length + 1}`, from: modelSpec.constructs[0].code, to: modelSpec.constructs[modelSpec.constructs.length - 1].code, beta: 0.35 });
      renderModel();
    });
    document.getElementById('res-demo-model-btn')?.addEventListener('click', () => renderModel());

    document.getElementById('res-ai-suggest-btn')?.addEventListener('click', async () => {
      const form = window.AFF.getParsedForm();
      if (!form) return alert('Hãy mở một biểu mẫu (Google/Microsoft Form) trước để AI ánh xạ thành mô hình.');
      const btn = document.getElementById('res-ai-suggest-btn');
      btn.disabled = true; btn.textContent = 'AI đang suy luận...';
      try {
        const res = await fetch('/api/research/suggest-model', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form_data: form, custom_api_key: window.AFF.getCustomApiKey() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const qById = {};
        (form.pages || []).forEach((p) => (p.elements || []).forEach((el) => (qById[el.id] = el)));
        modelSpec.constructs = (data.constructs || []).map((c) => ({
          code: c.code, name: c.name, role: c.role || 'IV',
          items: (c.question_ids || []).map((qid, i) => ({ code: `${c.code}${i + 1}`, label: qById[qid]?.name || qid, question_id: qid })),
        }));
        modelSpec.paths = data.paths || [];
        renderModel();
      } catch (err) { alert(err.message); }
      finally { btn.disabled = false; btn.textContent = 'AI gợi ý từ Form đang mở'; }
    });

    document.getElementById('res-run-btn')?.addEventListener('click', async () => {
      modelSpec.sample_size = parseInt(document.getElementById('res-sample-size').value, 10) || 250;
      modelSpec.scale_points = parseInt(document.getElementById('res-scale-points').value, 10) || 5;
      const btn = document.getElementById('res-run-btn');
      btn.disabled = true; btn.textContent = 'Đang tính toán...';
      try {
        const res = await fetch('/api/research/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelSpec }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        currentDataset = data.dataset;
        currentAnalysis = data.analysis;
        renderAnalysis(currentAnalysis);
        if (window.AFF.getParsedForm()) document.getElementById('res-push-form-btn').classList.remove('hidden');
      } catch (err) { alert(err.message); }
      finally { btn.disabled = false; btn.textContent = 'Sinh dữ liệu & Chạy kiểm định'; }
    });

    document.getElementById('res-import-csv-btn')?.addEventListener('click', async () => {
      const file = document.getElementById('res-csv-file').files?.[0];
      if (!file) return alert('Chọn file CSV trước.');
      modelSpec.scale_points = parseInt(document.getElementById('res-scale-points').value, 10) || 5;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('model', JSON.stringify(modelSpec));
      fd.append('exclude_rows', document.getElementById('res-csv-exclude').value.trim());
      const res = await fetch('/api/research/import-csv', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) return alert(data.error);
      currentDataset = data.dataset;
      currentAnalysis = data.analysis;
      if (data.errors?.length) alert(`Import ${data.valid_count}/${data.total_csv_rows} dòng hợp lệ.\nMột số lỗi:\n${data.errors.slice(0, 5).join('\n')}`);
      if (currentAnalysis) renderAnalysis(currentAnalysis);
    });

    function renderAnalysis(a) {
      document.getElementById('res-output-area').classList.remove('hidden');
      const mf = a.model_fit || {};
      const cCodes = (a.pls_constructs || []).map((c) => c.code);

      document.getElementById('res-analysis-body').innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card"><small>Cỡ mẫu (N)</small><strong>${a.n}</strong></div>
          <div class="kpi-card ${a.kmo_pass ? '' : 'warn'}"><small>KMO (≥ 0.50)</small><strong>${a.kmo}</strong></div>
          <div class="kpi-card"><small>Phương sai trích</small><strong>${a.total_variance_explained}%</strong></div>
          <div class="kpi-card"><small>CFI / TLI</small><strong>${mf.cfi} / ${mf.tli}</strong></div>
          <div class="kpi-card"><small>RMSEA / SRMR</small><strong>${mf.rmsea} / ${mf.srmr}</strong></div>
          <div class="kpi-card"><small>CMIN/df</small><strong>${mf.cmin_df}</strong></div>
        </div>

        <h4 style="margin:12px 0 6px;">1. Độ tin cậy thang đo (Cronbach's Alpha, CR, AVE)</h4>
        <div class="table-scroll" style="margin-bottom:14px;"><table class="data-table">
          <thead><tr><th>Biến</th><th>Vai trò</th><th>Alpha (L1)</th><th>Alpha (L2)</th><th>rho_A</th><th>CR</th><th>AVE</th></tr></thead>
          <tbody>
            ${(a.pls_constructs || []).map((pc) => `
              <tr>
                <td><strong>${esc(pc.code)}</strong> — ${esc(pc.name)}</td><td>${esc(pc.role)}</td>
                <td>${a.cronbach_r1[pc.code]?.alpha ?? pc.alpha}</td><td>${a.cronbach_r2[pc.code]?.alpha ?? pc.alpha}</td>
                <td>${pc.rho_a}</td><td>${pc.cr}</td><td>${pc.ave}</td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>

        <h4 style="margin:12px 0 6px;">2. Kiểm định Giả thuyết Đường dẫn & Đa cộng tuyến (VIF)</h4>
        <div class="table-scroll" style="margin-bottom:14px;"><table class="data-table">
          <thead><tr><th>Giả thuyết</th><th>Đường dẫn</th><th>β chuẩn hóa</th><th>t-value</th><th>p-value</th><th>VIF</th><th>f²</th><th>Kết luận</th></tr></thead>
          <tbody>
            ${(a.paths || []).map((p) => `
              <tr>
                <td><strong>${esc(p.label)}</strong></td><td>${esc(p.from)} → ${esc(p.to)}</td>
                <td>${p.beta}</td><td>${p.t_value}</td><td>${p.p_value}</td><td>${p.vif}</td><td>${p.f2}</td>
                <td style="color:${p.supported ? 'var(--accent)' : 'var(--amber)'}; font-weight:700;">${p.supported ? 'Chấp nhận' : 'Bác bỏ'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>

        <div class="grid-2">
          <div>
            <h4 style="margin-bottom:6px;">3. Giá trị phân biệt HTMT (< 0.85)</h4>
            <div class="table-scroll"><table class="data-table">
              <thead><tr><th>Biến</th>${cCodes.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
              <tbody>${cCodes.map((c1) => `<tr><td><strong>${esc(c1)}</strong></td>${cCodes.map((c2) => `<td>${a.htmt_matrix[c1]?.[c2] ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody>
            </table></div>
          </div>
          <div>
            <h4 style="margin-bottom:6px;">4. Ma trận xoay EFA (Varimax)</h4>
            <div class="table-scroll"><table class="data-table">
              <thead><tr><th>Item</th><th>Biến</th>${Array.from({ length: a.n_factors || 1 }, (_, i) => `<th>F${i + 1}</th>`).join('')}</tr></thead>
              <tbody>${(a.efa_matrix || []).map((row) => `<tr><td><strong>${esc(row.code)}</strong></td><td>${esc(row.construct)}</td>${row.loadings.map((v) => `<td>${Math.abs(v) >= 0.3 ? v : ''}</td>`).join('')}</tr>`).join('')}</tbody>
            </table></div>
          </div>
        </div>
        <p style="font-size:11.5px; color:var(--text-hint); margin-top:12px;">${esc((a.references || []).join(' | '))}</p>
      `;
    }

    document.querySelectorAll('.res-export-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!currentDataset) return alert('Chưa có dữ liệu nghiên cứu để xuất.');
        const res = await fetch('/api/research/export', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ format: b.dataset.fmt, dataset: currentDataset, analysis: currentAnalysis }),
        });
        if (!res.ok) return alert('Lỗi xuất file.');
        const blob = await res.blob();
        const extMap = { coded_csv: 'spss_coded.csv', labelled_csv: 'spss_labelled.csv', spss_sps: 'spss_syntax.sps', stata_do: 'stata.do', apa_doc: 'bao_cao_apa.doc' };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = extMap[b.dataset.fmt] || 'export.txt';
        a.click();
      });
    });

    document.getElementById('res-push-form-btn')?.addEventListener('click', () => {
      const form = window.AFF.getParsedForm();
      if (!form || !currentDataset) return;
      const qById = {};
      (form.pages || []).forEach((p) => (p.elements || []).forEach((el) => (qById[el.id] = el)));
      const mappedRows = currentDataset.rows.map((row) => {
        const out = {};
        (currentDataset.items || []).forEach((im) => {
          if (im.question_id && qById[im.question_id]) {
            const el = qById[im.question_id];
            const numVal = row[im.code];
            if (el.choices?.length) {
              const idx = Math.max(0, Math.min(el.choices.length - 1, numVal - 1));
              out[el.id] = el.choices[idx];
            } else out[el.id] = String(numVal);
          }
        });
        return out;
      });
      window.AFF.openPanel('panel-campaign');
      window.AFF.startCustomCampaign({ run_mode: 'research_push', form_data: form, research_rows: mappedRows });
    });

    renderModel();
  });
})();
