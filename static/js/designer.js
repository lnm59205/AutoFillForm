(function () {
  'use strict';

  const TYPES = [
    ['RADIO', 'Trắc nghiệm (1 đáp án)'],
    ['CHECKBOX', 'Hộp kiểm (nhiều đáp án)'],
    ['DROP_DOWN', 'Danh sách thả xuống'],
    ['SCALE', 'Thang đo tuyến tính'],
    ['GRID', 'Lưới trắc nghiệm'],
    ['TEXT', 'Trả lời ngắn'],
    ['PARAGRAPH', 'Đoạn văn'],
    ['DATE', 'Ngày'],
    ['TIME', 'Giờ'],
  ];
  const LIKERT = ['Hoàn toàn không đồng ý', 'Không đồng ý', 'Trung lập', 'Đồng ý', 'Hoàn toàn đồng ý'];
  const COLORS = ['#10b981', '#06b6d4', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6'];
  const EXAMPLES = {
    research: ['research', 'Luận văn: Các yếu tố ảnh hưởng đến ý định mua hàng online của sinh viên', 'Biến độc lập: Chất lượng sản phẩm, Giá cả, Đánh giá online, Sự tiện lợi. Biến phụ thuộc: Ý định mua hàng online.', 'Sinh viên đại học tại Việt Nam'],
    customer: ['customer', 'Khảo sát mức độ hài lòng của khách hàng với quán cà phê về đồ uống, không gian, giá và phục vụ', '', 'Khách đã từng trải nghiệm tại quán'],
    event: ['event', 'Đăng ký tham gia hội thảo "Ứng dụng AI trong học tập & nghiên cứu", có chọn khung giờ tham dự', '', 'Sinh viên và giảng viên'],
  };

  let state = { purpose: 'general', view: 'edit', spec: null };

  function esc(s) { return window.AFF ? window.AFF.esc(s) : String(s || ''); }

  document.addEventListener('DOMContentLoaded', () => {
    const purposeChips = document.getElementById('fd-purpose-chips');
    if (!purposeChips) return;

    purposeChips.querySelectorAll('[data-purpose]').forEach((b) => {
      b.addEventListener('click', () => {
        state.purpose = b.dataset.purpose;
        purposeChips.querySelectorAll('[data-purpose]').forEach((x) => x.classList.toggle('is-on', x === b));
        document.getElementById('fd-research-extra').classList.toggle('hidden', state.purpose !== 'research');
      });
    });

    document.querySelectorAll('.fd-ex').forEach((b) => {
      b.addEventListener('click', () => {
        const ex = EXAMPLES[b.dataset.ex];
        if (!ex) return;
        state.purpose = ex[0];
        purposeChips.querySelectorAll('[data-purpose]').forEach((x) => x.classList.toggle('is-on', x.dataset.purpose === ex[0]));
        document.getElementById('fd-research-extra').classList.toggle('hidden', ex[0] !== 'research');
        document.getElementById('fd-topic').value = ex[1];
        document.getElementById('fd-constructs').value = ex[2];
        document.getElementById('fd-audience').value = ex[3];
      });
    });

    document.getElementById('fd-generate-btn')?.addEventListener('click', async () => {
      const topic = document.getElementById('fd-topic').value.trim();
      if (!topic) return alert('Vui lòng nhập mô tả khảo sát.');
      const btn = document.getElementById('fd-generate-btn');
      btn.disabled = true; btn.textContent = 'AI đang thiết kế form...';
      try {
        const res = await fetch('/api/designer/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purpose: state.purpose,
            topic,
            constructs: document.getElementById('fd-constructs').value.trim(),
            audience: document.getElementById('fd-audience').value.trim(),
            length: document.getElementById('fd-length').value,
            language: document.getElementById('fd-lang').value,
            custom_api_key: window.AFF.getCustomApiKey(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        state.spec = data.spec;
        document.getElementById('fd-code-style').value = state.spec.code_style || '';
        document.getElementById('fd-brief-card').classList.add('hidden');
        document.getElementById('fd-editor-area').classList.remove('hidden');
        document.getElementById('fd-export-gs-btn').classList.remove('hidden');
        render();
      } catch (err) { alert(err.message); }
      finally { btn.disabled = false; btn.textContent = 'Thiết kế Form bằng AI'; }
    });

    document.getElementById('fd-new-btn')?.addEventListener('click', () => {
      document.getElementById('fd-brief-card').classList.remove('hidden');
      document.getElementById('fd-editor-area').classList.add('hidden');
      document.getElementById('fd-export-gs-btn').classList.add('hidden');
    });
    document.getElementById('fd-back-brief')?.addEventListener('click', () => {
      document.getElementById('fd-brief-card').classList.remove('hidden');
      document.getElementById('fd-editor-area').classList.add('hidden');
    });

    document.querySelectorAll('.fd-view-btn').forEach((b) => {
      b.addEventListener('click', () => {
        state.view = b.dataset.view;
        document.querySelectorAll('.fd-view-btn').forEach((x) => x.classList.toggle('active', x === b));
        render();
      });
    });

    document.getElementById('fd-code-style')?.addEventListener('change', (e) => {
      if (state.spec) { state.spec.code_style = e.target.value; render(); }
    });

    document.getElementById('fd-export-gs-btn')?.addEventListener('click', async () => {
      if (!state.spec) return;
      const res = await fetch('/api/designer/apps-script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: state.spec }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error);
      navigator.clipboard?.writeText(data.script).catch(() => {});
      window.AFF.openModal('Tạo Google Form thật trong 10 giây (Apps Script)', `
        <div class="info-banner">Mã Google Apps Script đã được tạo sẵn toàn bộ phần, câu hỏi, Likert và rẽ nhánh! Mở <a href="https://script.google.com" target="_blank" style="color:var(--accent); font-weight:700;">script.google.com</a> → Dự án mới → Dán code → Bấm <strong>Run</strong>.</div>
        <textarea rows="13" readonly style="font-family:var(--mono); font-size:11.5px;">${esc(data.script)}</textarea>
      `);
    });

    // Render Editor / Map / Preview
    function shownTitle(q) {
      const code = (q.code || '').trim(), st = state.spec?.code_style || '';
      if (!code || !st) return q.title;
      return (st === 'bracket' ? `[${code}] ` : st === 'dot' ? `${code}. ` : `${code} - `) + q.title;
    }

    function render() {
      if (!state.spec) return;
      const canvas = document.getElementById('fd-canvas');
      if (state.view === 'preview') return renderPreview(canvas);
      if (state.view === 'map') return renderMap(canvas);

      const s = state.spec;
      let html = `
        <div class="card"><div class="card-body">
          <div class="form-group"><label>Tiêu đề Form</label><input type="text" data-f="title" value="${esc(s.title)}" /></div>
          <div class="form-group"><label>Mô tả / Lời giới thiệu</label><textarea rows="2" data-f="description">${esc(s.description)}</textarea></div>
        </div></div>
      `;

      (s.sections || []).forEach((sec, si) => {
        html += `<div class="card"><div class="card-header"><h3>Phần ${si + 1}: <input type="text" data-s="${si}" data-f="sec-title" value="${esc(sec.title)}" style="width:320px; display:inline-block;" /></h3>
          ${si > 0 ? `<button class="btn btn-danger btn-xs" data-act="del-sec" data-s="${si}">Xóa phần</button>` : ''}
        </div><div class="card-body">`;

        (sec.questions || []).forEach((q, qi) => {
          const at = `data-s="${si}" data-q="${qi}"`;
          const isChoice = ['RADIO', 'CHECKBOX', 'DROP_DOWN'].includes(q.type);
          html += `<div class="question-item" style="margin-bottom:12px;">
            <div class="input-row" style="margin-bottom:8px;">
              <input type="text" ${at} data-f="q-title" value="${esc(q.title)}" placeholder="Nội dung câu hỏi" />
              <select ${at} data-f="q-type" style="max-width:210px;">${TYPES.map((t) => `<option value="${t[0]}" ${t[0] === q.type ? 'selected' : ''}>${t[1]}</option>`).join('')}</select>
            </div>`;

          if (isChoice) {
            html += (q.options || []).map((o, oi) => {
              const go = (q.branch || []).find((b) => b.option === oi)?.go || '';
              let branchSel = '';
              if (q.type === 'RADIO' || q.type === 'DROP_DOWN') {
                branchSel = `<select ${at} data-o="${oi}" data-f="branch" style="max-width:170px;">
                  <option value="" ${go === '' ? 'selected' : ''}>Tiếp tục phần kế</option>
                  <option value="submit" ${go === 'submit' ? 'selected' : ''}>Nộp form luôn</option>
                  ${s.sections.map((_, ti) => ti > si ? `<option value="section:${ti}" ${go === 'section:' + ti ? 'selected' : ''}>Đến Phần ${ti + 1}</option>` : '').join('')}
                </select>`;
              }
              return `<div class="input-row" style="margin-bottom:6px;">
                <input type="text" ${at} data-o="${oi}" data-f="opt" value="${esc(o)}" />
                ${branchSel}
                <button class="btn btn-secondary btn-xs" data-act="del-opt" ${at} data-o="${oi}">×</button>
              </div>`;
            }).join('');
            html += `<div style="display:flex; gap:8px; margin-top:6px;">
              <button class="btn btn-secondary btn-xs" data-act="add-opt" ${at}>+ Lựa chọn</button>
              ${q.type === 'RADIO' ? `<button class="btn btn-secondary btn-xs" data-act="likert" ${at}>Thang Likert 5</button>` : ''}
            </div>`;
          } else if (q.type === 'GRID') {
            html += `<div class="grid-2" style="font-size:12px;">
              <div><strong>Hàng:</strong> ${esc((q.rows || []).join(' | '))}</div>
              <div><strong>Cột:</strong> ${esc((q.options || []).join(' | '))}</div>
            </div>`;
          }

          html += `<div style="display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:10px; border-top:1px solid var(--border); padding-top:8px;">
            <input type="text" ${at} data-f="code" value="${esc(q.code)}" placeholder="Mã biến (VD: CL1)" style="max-width:110px; padding:4px 8px; font-size:12px; margin-right:auto;" />
            <label style="font-size:12px; display:flex; align-items:center; gap:4px;"><input type="checkbox" ${at} data-f="required" ${q.required ? 'checked' : ''} style="width:auto;" /> Bắt buộc</label>
            <button class="btn btn-secondary btn-xs" data-act="copy" ${at}>Nhân bản</button>
            <button class="btn btn-danger btn-xs" data-act="del-q" ${at}>Xóa</button>
          </div></div>`;
        });

        html += `<div style="display:flex; gap:8px;">
          <button class="btn btn-secondary btn-sm" data-act="add-q" data-s="${si}">+ Thêm câu hỏi</button>
          ${si === s.sections.length - 1 ? `<button class="btn btn-secondary btn-sm" data-act="add-sec">+ Thêm phần mới</button>` : ''}
        </div></div></div>`;
      });

      canvas.innerHTML = html;
      bindCanvasEvents(canvas);
    }

    function bindCanvasEvents(canvas) {
      canvas.oninput = (e) => {
        const el = e.target, f = el.dataset.f, s = state.spec;
        if (!f || !s) return;
        const si = +el.dataset.s, qi = +el.dataset.q;
        if (f === 'title') s.title = el.value;
        else if (f === 'description') s.description = el.value;
        else if (f === 'sec-title') s.sections[si].title = el.value;
        else if (f === 'q-title') s.sections[si].questions[qi].title = el.value;
        else if (f === 'opt') s.sections[si].questions[qi].options[+el.dataset.o] = el.value;
        else if (f === 'code') s.sections[si].questions[qi].code = el.value;
      };
      canvas.onchange = (e) => {
        const el = e.target, f = el.dataset.f, s = state.spec;
        if (!f || !s) return;
        const si = +el.dataset.s, qi = +el.dataset.q, q = s.sections[si]?.questions[qi];
        if (!q) return;
        if (f === 'q-type') {
          q.type = el.value;
          if (['RADIO', 'CHECKBOX', 'DROP_DOWN', 'GRID'].includes(q.type) && !q.options?.length) q.options = ['Lựa chọn 1', 'Lựa chọn 2'];
          if (q.type === 'GRID' && !q.rows?.length) q.rows = ['Hàng 1', 'Hàng 2'];
          render();
        } else if (f === 'required') q.required = el.checked;
        else if (f === 'branch') {
          const oi = +el.dataset.o;
          q.branch = (q.branch || []).filter((b) => b.option !== oi);
          if (el.value) q.branch.push({ option: oi, go: el.value });
        }
      };
      canvas.onclick = (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act, si = +b.dataset.s, qi = +b.dataset.q, s = state.spec;
        const q = s.sections[si]?.questions[qi];
        if (act === 'add-q') s.sections[si].questions.push({ id: 'q' + Date.now(), type: 'RADIO', title: 'Câu hỏi mới', required: true, options: ['Lựa chọn 1', 'Lựa chọn 2'], rows: [], branch: [], code: '' });
        else if (act === 'add-sec') s.sections.push({ title: `Phần ${s.sections.length + 1}`, description: '', questions: [] });
        else if (act === 'del-sec') { s.sections[si - 1].questions.push(...s.sections[si].questions); s.sections.splice(si, 1); }
        else if (act === 'del-q') s.sections[si].questions.splice(qi, 1);
        else if (act === 'copy') s.sections[si].questions.splice(qi + 1, 0, JSON.parse(JSON.stringify(q)));
        else if (act === 'add-opt') q.options.push(`Lựa chọn ${q.options.length + 1}`);
        else if (act === 'del-opt') q.options.splice(+b.dataset.o, 1);
        else if (act === 'likert') q.options = LIKERT.slice();
        render();
      };
    }

    function renderMap(canvas) {
      const s = state.spec;
      let html = `<div class="fd-map" id="fd-map-box"><svg class="fd-map-lines" id="fd-map-svg"></svg>`;
      (s.sections || []).forEach((sec, si) => {
        const c = COLORS[si % COLORS.length];
        html += `<div class="fd-map-sec" data-node="sec:${si}" style="--c:${c}"><strong>Phần ${si + 1}: ${esc(sec.title)}</strong> (${sec.questions.length} câu)`;
        sec.questions.forEach((q, qi) => {
          if (!q.branch?.length) return;
          html += `<div style="margin-top:8px; font-size:12px;"><em>Câu ${qi + 1}: ${esc(q.title)}</em>`;
          q.options.forEach((o, oi) => {
            const br = q.branch.find((b) => b.option === oi);
            const go = br ? br.go : '';
            html += `<div class="fd-map-opt ${go ? 'jumps' : ''}" data-go="${esc(go)}" style="--go:${go === 'submit' ? '#ef4444' : c}">
              <span>${esc(o)}</span> → <strong style="margin-left:auto;">${go === 'submit' ? 'Nộp form' : (go ? 'Đến Phần ' + (+go.split(':')[1] + 1) : 'Tiếp tục')}</strong>
            </div>`;
          });
          html += `</div>`;
        });
        html += `</div><div class="fd-map-down">↓ ${si + 1 < s.sections.length ? `Sang Phần ${si + 2}` : 'Nộp form'}</div>`;
      });
      html += `<div class="fd-map-sec" data-node="end" style="--c:#ef4444"><strong>Nộp biểu mẫu</strong></div></div>`;
      canvas.innerHTML = html;

      requestAnimationFrame(() => {
        const box = document.getElementById('fd-map-box'), svg = document.getElementById('fd-map-svg');
        if (!box || !svg) return;
        const brBox = box.getBoundingClientRect();
        svg.setAttribute('width', brBox.width); svg.setAttribute('height', brBox.height);
        let paths = '', lane = 0;
        box.querySelectorAll('.fd-map-opt.jumps').forEach((el) => {
          const go = el.dataset.go;
          const target = box.querySelector(`[data-node="${go === 'submit' ? 'end' : go}"]`);
          if (!target) return;
          const a = el.getBoundingClientRect(), b = target.getBoundingClientRect();
          const x1 = a.right - brBox.left, y1 = a.top + a.height / 2 - brBox.top;
          const x2 = b.right - brBox.left, y2 = b.top + 20 - brBox.top;
          const bend = Math.max(x1, x2) + 22 + (lane++ % 4) * 14;
          const col = getComputedStyle(el).getPropertyValue('--go') || '#10b981';
          paths += `<path d="M${x1} ${y1} H${bend} V${y2} H${x2}" stroke="${col}" />`;
        });
        svg.innerHTML = paths;
      });
    }

    function renderPreview(canvas) {
      const s = state.spec;
      let html = `<div class="card"><div class="card-body"><h2>${esc(s.title)}</h2><p style="color:var(--text-muted); margin-top:6px;">${esc(s.description)}</p></div></div>`;
      (s.sections || []).forEach((sec, si) => {
        if (si > 0) html += `<h4 style="margin:12px 0 6px; color:var(--cyan);">Phần ${si + 1}: ${esc(sec.title)}</h4>`;
        (sec.questions || []).forEach((q) => {
          html += `<div class="card"><div class="card-body"><strong>${esc(shownTitle(q))}${q.required ? ' <span style="color:var(--danger)">*</span>' : ''}</strong>`;
          if (['RADIO', 'CHECKBOX'].includes(q.type)) {
            html += (q.options || []).map((o) => `<div style="margin-top:6px; font-size:13px;">${q.type === 'CHECKBOX' ? '☐' : '◯'} ${esc(o)}</div>`).join('');
          } else if (q.type === 'SCALE') {
            html += `<div style="margin-top:8px; font-size:13px;">${q.scale?.min ?? 1} — ${q.scale?.max ?? 5} (${esc(q.scale?.low)} → ${esc(q.scale?.high)})</div>`;
          } else {
            html += `<div style="margin-top:8px; border-bottom:1px dashed var(--border-strong); padding-bottom:4px; color:var(--text-hint); font-size:12.5px;">Câu trả lời của bạn</div>`;
          }
          html += `</div></div>`;
        });
      });
      canvas.innerHTML = html;
    }
  });
})();
