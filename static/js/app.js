// Global variable to hold parsed form structure
let parsedForm = null;
let pollInterval = null;

function cleanString(str) {
    if (!str) return '';
    return str.normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/đ/g, "d")
              .replace(/Đ/g, "D")
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
}

function fuzzyMatch(str1, str2) {
    const c1 = cleanString(str1);
    const c2 = cleanString(str2);
    return c1.includes(c2) || c2.includes(c1);
}

// Helpers for compact v2 CONFIG_ encoding/decoding
const STRATEGY_TO_CODE = {
    custom_list: 200,
    email: 201,
    vi_name: 202,
    vi_phone: 203,
    static: 204
};

const CODE_TO_STRATEGY = {
    200: 'custom_list',
    201: 'email',
    202: 'vi_name',
    203: 'vi_phone',
    204: 'static'
};

function bytesToB64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
        b64 += '=';
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(bytes);
}

function utf8ToB64Url(str) {
    return btoa(unescape(encodeURIComponent(str)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function b64UrlToUtf8(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
        b64 += '=';
    }
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

function expandShortFormUrl(shortToken) {
    if (!shortToken) return '';
    if (shortToken.startsWith('e.')) {
        return 'https://docs.google.com/forms/d/e/1FAIpQL' + shortToken.slice(2) + '/viewform';
    }
    if (shortToken.startsWith('d.')) {
        return 'https://docs.google.com/forms/d/' + shortToken.slice(2) + '/viewform';
    }
    if (shortToken.startsWith('g.')) {
        return 'https://forms.gle/' + shortToken.slice(2);
    }
    if (shortToken.startsWith('u.')) {
        return b64UrlToUtf8(shortToken.slice(2));
    }
    return shortToken;
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
            const stratVal = select ? select.value : 'custom_list';
            bytes.push(STRATEGY_TO_CODE[stratVal] || 200);
            bytes.push(254);

            const staticInput = qItem.querySelector('.static-value-input');
            if (staticInput && staticInput.value.trim()) {
                customTexts[idx] = staticInput.value;
            }
        } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
            const inputs = qItem.querySelectorAll('.choice-percent-input');
            inputs.forEach(inp => {
                const v = Math.max(0, Math.min(100, parseInt(inp.value) || 0));
                bytes.push(v);
            });
            bytes.push(254);
        } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
            const rows = qItem.querySelectorAll('.grid-row-container');
            rows.forEach((row, rIdx) => {
                if (rIdx > 0) bytes.push(253);
                const inputs = row.querySelectorAll('.choice-percent-input');
                inputs.forEach(inp => {
                    const v = Math.max(0, Math.min(100, parseInt(inp.value) || 0));
                    bytes.push(v);
                });
            });
            bytes.push(254);
        }
    });

    const pctB64 = bytesToB64Url(bytes);
    let code = `CONFIG_2_${shortUrl}~${submissions}~${delay}~${pctB64}`;
    if (Object.keys(customTexts).length > 0) {
        code += `~${utf8ToB64Url(JSON.stringify(customTexts))}`;
    }
    return code;
}

function decodeAnyConfigCode(rawInput) {
    const trimmed = (rawInput || '').trim();

    // 1. New compact format: CONFIG_2_...
    if (trimmed.startsWith('CONFIG_2_')) {
        const body = trimmed.slice('CONFIG_2_'.length);
        const parts = body.split('~');
        if (parts.length < 4) {
            throw new Error('Mã cấu hình ngắn không đúng định dạng.');
        }
        const [uPart, subStr, delayStr, pctB64, textB64] = parts;
        const url = expandShortFormUrl(uPart);
        const rawBytes = b64UrlToBytes(pctB64);

        const qSegments = [];
        let currentSeg = [];
        for (let i = 0; i < rawBytes.length; i++) {
            if (rawBytes[i] === 254) {
                qSegments.push(currentSeg);
                currentSeg = [];
            } else {
                currentSeg.push(rawBytes[i]);
            }
        }
        if (currentSeg.length > 0) {
            qSegments.push(currentSeg);
        }

        const customTexts = textB64 ? JSON.parse(b64UrlToUtf8(textB64)) : {};
        return {
            version: 2,
            url: url,
            submissions: parseInt(subStr) || 10,
            delay: parseFloat(delayStr) || 1.0,
            qSegments: qSegments,
            customTexts: customTexts
        };
    }

    // 2. Legacy long format: CONFIG_eyJ...
    if (trimmed.startsWith('CONFIG_')) {
        const b64Part = trimmed.slice('CONFIG_'.length).replace(/-/g, '+').replace(/_/g, '/');
        const jsonStr = decodeURIComponent(escape(atob(b64Part)));
        return JSON.parse(jsonStr);
    }

    throw new Error('Mã cấu hình không hợp lệ.');
}

const defaultPercentagesMap = {
    "bantuocnhomnaosauday": {
        "sinhviendaihocphenikaa": 55,
        "sinhvientruongdaihockhac": 20,
        "nhanvienvanphong": 20,
        "muckhac": 5,
        "khac": 5
    },
    "dotuoicuabanlabaonhieu": {
        "duoi18": 2,
        "1820": 45,
        "2124": 35,
        "2530": 15,
        "3135": 2,
        "tren35": 1
    },
    "banhientangsinhsongtaikhuvucnao": {
        "hanoi": 90,
        "thanhphohochiminh": 5,
        "danang": 2,
        "muckhac": 3,
        "khac": 3
    },
    "neubanlasinhvienbandanghocnamthumay": {
        "nam1": 15,
        "nam2": 15,
        "nam3": 40,
        "nam4": 30,
        "khac": 0
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // 1. AUTHENTICATION & LOGIN/REGISTER HANDLERS
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const btnLogin = document.getElementById('btn-login');
    const btnRegister = document.getElementById('btn-register');
    const btnLogout = document.getElementById('btn-logout');
    const switchToRegister = document.getElementById('switch-to-register');
    const switchToLogin = document.getElementById('switch-to-login');
    const loginFormContainer = document.getElementById('login-form-container');
    const registerFormContainer = document.getElementById('register-form-container');
    const userDisplayName = document.getElementById('user-display-name');

    if (switchToRegister) {
        switchToRegister.addEventListener('click', (e) => {
            e.preventDefault();
            loginFormContainer.classList.add('hidden');
            registerFormContainer.classList.remove('hidden');
        });
    }

    if (switchToLogin) {
        switchToLogin.addEventListener('click', (e) => {
            e.preventDefault();
            registerFormContainer.classList.add('hidden');
            loginFormContainer.classList.remove('hidden');
        });
    }

    if (btnLogin) {
        btnLogin.addEventListener('click', () => {
            const usernameInput = document.getElementById('login-username').value.trim();
            if (!usernameInput) {
                alert("Vui lòng nhập tên đăng nhập.");
                return;
            }
            
            const users = JSON.parse(localStorage.getItem('users') || '[]');
            let user = users.find(u => u.username === usernameInput);
            
            if (!user && usernameInput === "Le Ngoc Minh") {
                user = { name: "Lê Ngọc Minh", username: "Le Ngoc Minh" };
            }

            if (user) {
                localStorage.setItem('currentUser', JSON.stringify(user));
                checkAuthState();
            } else {
                alert("Tài khoản không tồn tại. Vui lòng bấm Đăng ký để tạo tài khoản mới.");
            }
        });
    }

    if (btnRegister) {
        btnRegister.addEventListener('click', () => {
            const nameInput = document.getElementById('register-name').value.trim();
            const usernameInput = document.getElementById('register-username').value.trim();
            
            if (!nameInput || !usernameInput) {
                alert("Vui lòng điền đầy đủ họ tên và tên đăng nhập.");
                return;
            }

            const users = JSON.parse(localStorage.getItem('users') || '[]');
            if (users.some(u => u.username === usernameInput) || usernameInput === "Le Ngoc Minh") {
                alert("Tên đăng nhập này đã tồn tại.");
                return;
            }

            const newUser = { name: nameInput, username: usernameInput };
            users.push(newUser);
            localStorage.setItem('users', JSON.stringify(users));
            localStorage.setItem('currentUser', JSON.stringify(newUser));
            
            alert("Đăng ký tài khoản thành công.");
            checkAuthState();
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('currentUser');
            checkAuthState();
        });
    }

    function checkAuthState() {
        const userJson = localStorage.getItem('currentUser');
        if (userJson) {
            const user = JSON.parse(userJson);
            if (userDisplayName) userDisplayName.textContent = user.name;
            if (loginScreen) loginScreen.classList.add('hidden');
            if (dashboardScreen) dashboardScreen.classList.remove('hidden');
            renderSavedFormsList();
        } else {
            if (loginScreen) loginScreen.classList.remove('hidden');
            if (dashboardScreen) dashboardScreen.classList.add('hidden');
        }
    }

    // 2. DASHBOARD NAVIGATION HANDLERS
    const menuItems = document.querySelectorAll('.menu-item');
    const contentPanels = document.querySelectorAll('.content-panel');

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            if (item.classList.contains('disabled-menu')) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            const targetPanelId = item.dataset.panel;
            
            menuItems.forEach(i => i.classList.remove('active'));
            contentPanels.forEach(p => p.classList.remove('active'));

            item.classList.add('active');
            const targetPanel = document.getElementById(targetPanelId);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }

            if (targetPanelId === 'panel-active-form-view') {
                toggleCampaignWorkspaceViews();
            } else if (targetPanelId === 'panel-manage-form') {
                renderSavedFormsList();
            }
        });
    });

    const btnNavToHome = document.getElementById('btn-nav-to-home');
    if (btnNavToHome) {
        btnNavToHome.addEventListener('click', () => {
            document.querySelector('.menu-item[data-panel="panel-home"]').click();
        });
    }

    function toggleCampaignWorkspaceViews() {
        const workspace = document.getElementById('campaign-workspace');
        const emptyState = document.getElementById('empty-active-state');
        if (parsedForm) {
            workspace.classList.remove('hidden');
            emptyState.classList.add('hidden');
        } else {
            workspace.classList.add('hidden');
            emptyState.classList.remove('hidden');
        }
    }

    // 3. CORE FORM PARSING
    const btnParse = document.getElementById('btn-parse');
    const btnParseText = document.getElementById('btn-parse-text');
    const btnParseSpinner = document.getElementById('btn-parse-spinner');
    const formUrlInput = document.getElementById('form-url');
    const parseError = document.getElementById('parse-error');
    
    const formTitleDisplay = document.getElementById('form-title-display');
    const formDescDisplay = document.getElementById('form-desc-display');
    const questionsContainer = document.getElementById('form-questions-container');
    const checklistContainer = document.getElementById('question-checklist-container');
    
    const btnAutoFillPercent = document.getElementById('btn-auto-fill-percent');
    const btnAiDistribute = document.getElementById('btn-ai-distribute');
    const btnAiText = document.getElementById('btn-ai-text');
    const btnAiSpinner = document.getElementById('btn-ai-spinner');
    const aiPromptInput = document.getElementById('ai-prompt-input');
    const aiStatusMsg = document.getElementById('ai-status-msg');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    
    const statSuccess = document.getElementById('run-success');
    const statFailed = document.getElementById('run-failed');
    const statProgress = document.getElementById('run-progress');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const logsContainer = document.getElementById('logs-container');

    if (btnParse) {
        btnParse.addEventListener('click', async () => {
            let url = formUrlInput.value.trim();
            if (!url) {
                showError("Vui lòng nhập đường dẫn biểu mẫu Google Form hoặc mã cấu hình CONFIG_...");
                return;
            }

            let pendingConfig = null;
            if (url.startsWith('CONFIG_')) {
                try {
                    pendingConfig = decodeAnyConfigCode(url);
                    url = pendingConfig.url;
                } catch (err) {
                    showError("Mã cấu hình không hợp lệ hoặc bị cắt thiếu ký tự. Vui lòng kiểm tra lại.");
                    return;
                }
            }

            btnParse.disabled = true;
            if (btnParseText) btnParseText.classList.add('hidden');
            if (btnParseSpinner) btnParseSpinner.classList.remove('hidden');
            parseError.classList.add('hidden');
            
            try {
                const response = await fetch('/api/parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || "Có lỗi xảy ra khi phân tích biểu mẫu.");
                }

                parsedForm = data;
                parsedForm.url = url;

                saveFormToLocalStorage(url, data);
                
                formTitleDisplay.textContent = data.title;
                formDescDisplay.textContent = data.description || "Không có mô tả.";
                
                if (data.requires_signin) {
                    showError("Cảnh báo: Biểu mẫu này đang bật yêu cầu đăng nhập tài khoản Google (Giới hạn 1 lần trả lời). Bạn cần tắt tùy chọn này trong Cài đặt Google Form để chạy tự động.");
                }

                renderQuestions(data);
                renderQuestionChecklist(data);
                
                document.querySelector('.menu-item[data-panel="panel-active-form-view"]').click();
                
                if (pendingConfig) {
                    applyConfigPayload(pendingConfig);
                    addLog("system", `Đã tải biểu mẫu và khôi phục cấu hình từ mã: "${data.title}"`);
                    alert("Đã tải biểu mẫu và áp dụng mã cấu hình thành công.");
                } else {
                    autoFillZeroPercentages();
                    addLog("system", `Đã tải thành công biểu mẫu: "${data.title}"`);
                }
                
            } catch (err) {
                showError(err.message);
                addLog("error", `Lỗi: ${err.message}`);
            } finally {
                btnParse.disabled = false;
                if (btnParseText) btnParseText.classList.remove('hidden');
                if (btnParseSpinner) btnParseSpinner.classList.add('hidden');
            }
        });
    }

    function saveFormToLocalStorage(url, data) {
        let saved = JSON.parse(localStorage.getItem('saved_forms') || '[]');
        if (!saved.some(f => f.url === url)) {
            saved.push({
                url: url,
                title: data.title,
                description: data.description || '',
                data: data
            });
            localStorage.setItem('saved_forms', JSON.stringify(saved));
        }
    }

    function renderSavedFormsList() {
        const manageContainer = document.getElementById('panel-manage-form');
        const emptyState = document.getElementById('empty-manage-state');
        const saved = JSON.parse(localStorage.getItem('saved_forms') || '[]');

        const oldList = document.getElementById('saved-forms-list-container');
        if (oldList) oldList.remove();

        if (saved.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        const listContainer = document.createElement('div');
        listContainer.id = 'saved-forms-list-container';
        listContainer.style.marginTop = '16px';

        let listHtml = `
            <div class="card">
                <div class="card-header">
                    <h2>Danh sách biểu mẫu đã lưu trên trình duyệt</h2>
                </div>
                <div class="card-body" style="padding: 0;">
                    <table class="premium-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--border); background-color: rgba(15, 23, 42, 0.5);">
                                <th style="padding: 13px 20px; color: var(--text-muted); font-size: 12px;">TÊN BIỂU MẪU</th>
                                <th style="padding: 13px 20px; text-align: right; color: var(--text-muted); font-size: 12px;">THAO TÁC</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        saved.forEach((form, idx) => {
            listHtml += `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding: 14px 20px; font-weight: 600; color: var(--text-main); max-width: 360px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${form.title}">${form.title}</td>
                    <td style="padding: 14px 20px; text-align: right;">
                        <button class="btn btn-primary btn-xs btn-open-saved" data-idx="${idx}">
                            Mở cấu hình
                        </button>
                        <button class="btn btn-danger btn-xs btn-delete-saved" data-idx="${idx}" style="margin-left: 6px;">
                            Xóa
                        </button>
                    </td>
                </tr>
            `;
        });

        listHtml += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        listContainer.innerHTML = listHtml;
        manageContainer.appendChild(listContainer);

        document.querySelectorAll('.btn-open-saved').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                const form = saved[idx];
                parsedForm = form.data;
                parsedForm.url = form.url;

                formTitleDisplay.textContent = parsedForm.title;
                formDescDisplay.textContent = parsedForm.description || "Không có mô tả.";
                renderQuestions(parsedForm);
                renderQuestionChecklist(parsedForm);
                
                if (form.configPayload) {
                    applyConfigPayload(form.configPayload);
                    addLog("system", `Đã khôi phục cấu hình đã lưu cho biểu mẫu: "${parsedForm.title}"`);
                } else {
                    autoFillZeroPercentages();
                    addLog("system", `Đã mở biểu mẫu: "${parsedForm.title}"`);
                }

                document.querySelector('.menu-item[data-panel="panel-active-form-view"]').click();
            });
        });

        document.querySelectorAll('.btn-delete-saved').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                const saved = JSON.parse(localStorage.getItem('saved_forms') || '[]');
                
                if (confirm(`Bạn có chắc chắn muốn xóa biểu mẫu "${saved[idx].title}" khỏi danh sách đã lưu?`)) {
                    saved.splice(idx, 1);
                    localStorage.setItem('saved_forms', JSON.stringify(saved));
                    renderSavedFormsList();
                }
            });
        });
    }

    function detectDefaultStrategy(questionName, elemType) {
        if (elemType === 'UserEmail') return 'email';
        return 'custom_list';
    }

    function getReadableTypeLabel(elemType) {
        const map = {
            'Radio': 'Chọn 1 đáp án',
            'Dropdown': 'Menu thả xuống',
            'Scale': 'Thang đo',
            'Checkboxes': 'Hộp kiểm (Chọn nhiều)',
            'RadioGrid': 'Lưới chọn 1 đáp án',
            'CheckboxGrid': 'Lưới hộp kiểm',
            'Short': 'Trả lời ngắn',
            'Paragraph': 'Đoạn văn',
            'UserEmail': 'Email'
        };
        return map[elemType] || elemType;
    }

    // 4. RENDER DETAILED QUESTION CARDS (PURE TEXT, CLEAN UI)
    function renderQuestions(formData) {
        questionsContainer.innerHTML = '';
        let qIndex = 1;
        
        formData.pages.forEach(page => {
            const pageHeader = document.createElement('div');
            pageHeader.className = 'page-header-separator';
            pageHeader.innerHTML = `<h3 style="font-size: 12px; margin: 12px 0 8px 0; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">${page.title}</h3>`;
            questionsContainer.appendChild(pageHeader);

            page.elements.forEach(elem => {
                const qDiv = document.createElement('div');
                qDiv.className = 'question-item';
                qDiv.dataset.id = elem.id;
                qDiv.dataset.type = elem.type;

                let reqHtml = elem.required ? `<span class="question-required">*</span>` : '';
                let metaHtml = `<span class="question-badge">${getReadableTypeLabel(elem.type)}</span>`;
                let sumStatusHtml = ['Radio', 'Dropdown', 'Scale'].includes(elem.type) ? 
                    `<span class="sum-status-badge invalid">Tổng: 0% (Cần đủ 100%)</span>` : '';
                
                let descHtml = elem.description ? `<p class="question-desc">${elem.description}</p>` : '';

                let innerHtml = `
                    <div class="question-header">
                        <div class="question-title-area">
                            <div class="question-number">${qIndex}</div>
                            <div class="question-title">${elem.name}${reqHtml}</div>
                        </div>
                        <div class="question-meta-group">
                            ${sumStatusHtml}
                            ${metaHtml}
                        </div>
                    </div>
                    ${descHtml}
                `;

                if (['Short', 'Paragraph', 'UserEmail'].includes(elem.type)) {
                    const detectedStrategy = detectDefaultStrategy(elem.name, elem.type);
                    const isListOrStatic = (detectedStrategy === 'custom_list' || detectedStrategy === 'static');
                    const placeholderText = detectedStrategy === 'static'
                        ? 'Nhập nội dung cố định sẽ điền giống nhau cho tất cả các lượt...'
                        : 'Nhập hoặc dán danh sách câu trả lời vào đây (Mỗi dòng tương ứng với 1 lượt điền):\n- Cách 1: Nhập yêu cầu ở ô trên rồi bấm "Tạo bằng AI" để hệ thống tự tạo danh sách.\n- Cách 2: Tự dán danh sách có sẵn của bạn (tên người, tên công ty, ý kiến... mỗi dòng 1 mục).\n- Cách 3: Nếu để trống, khi chạy hệ thống sẽ tự động dùng AI sinh dữ liệu phù hợp với câu hỏi.';
                    const helperText = detectedStrategy === 'static'
                        ? 'Nội dung cố định (Tất cả các lượt chạy sẽ điền cùng giá trị này):'
                        : 'Danh sách dữ liệu điền lần lượt (Mỗi dòng = 1 lượt chạy, có thể chỉnh sửa trực tiếp):';

                    innerHtml += `
                        <div class="strategy-select-container" data-q-name="${(elem.name || '').replace(/"/g, '&quot;')}" data-q-desc="${(elem.description || '').replace(/"/g, '&quot;')}">
                            <label class="strategy-label">Phương thức điền dữ liệu văn bản:</label>
                            <select class="strategy-select" onchange="handleStrategyChange(this)">
                                <option value="custom_list" ${detectedStrategy === 'custom_list' ? 'selected' : ''}>Tạo bằng AI theo ngữ cảnh biểu mẫu / Tự dán danh sách (Mỗi dòng 1 lượt)</option>
                                <option value="email" ${detectedStrategy === 'email' ? 'selected' : ''}>Địa chỉ Email ngẫu nhiên (@gmail.com chuẩn người thật, không trùng)</option>
                                <option value="vi_name" ${detectedStrategy === 'vi_name' ? 'selected' : ''}>Họ và tên tiếng Việt ngẫu nhiên (Không trùng lặp)</option>
                                <option value="vi_phone" ${detectedStrategy === 'vi_phone' ? 'selected' : ''}>Số điện thoại Việt Nam (09x/03x/08x chuẩn 10 số, không trùng)</option>
                                <option value="static" ${detectedStrategy === 'static' ? 'selected' : ''}>Giá trị cố định (Điền giống nhau cho mọi lượt)</option>
                            </select>
                            <div class="static-input-wrapper ${isListOrStatic ? '' : 'hidden'}" style="margin-top:10px;">
                                <div class="question-ai-prompt-bar ${detectedStrategy === 'static' ? 'hidden' : ''}">
                                    <input type="text" class="question-ai-prompt-input" placeholder="Nhập yêu cầu riêng cho câu hỏi này (hoặc để trống rồi bấm nút bên cạnh để AI tự suy luận theo tên Form)..." onkeydown="if(event.key==='Enter'){event.preventDefault(); generateQuestionTextByAI(this.nextElementSibling);}" />
                                    <button type="button" class="btn btn-ai-action" onclick="generateQuestionTextByAI(this)" style="padding:0 14px; font-size:12.5px; min-height:38px;">
                                        Tạo bằng AI
                                    </button>
                                </div>
                                <div class="custom-list-header">
                                    <span class="custom-list-helper">${helperText}</span>
                                    <span class="custom-list-counter ${detectedStrategy === 'static' ? 'hidden' : ''}">Số dòng: 0</span>
                                </div>
                                <textarea class="static-value-input" rows="${detectedStrategy === 'static' ? 2 : 5}" oninput="updateCustomListCount(this)" placeholder="${placeholderText}"></textarea>
                            </div>
                        </div>
                    `;
                } else if (['Radio', 'Dropdown', 'Scale'].includes(elem.type)) {
                    let choicesHtml = '';
                    elem.choices.forEach(choice => {
                        choicesHtml += createChoiceRow(choice, false);
                    });
                    
                    if (elem.has_other) {
                        choicesHtml += createChoiceRow('__other_option__', true);
                    }

                    innerHtml += `
                        <div class="choices-list">
                            ${choicesHtml}
                        </div>
                    `;
                } else if (elem.type === 'Checkboxes') {
                    let choicesHtml = '';
                    elem.choices.forEach(choice => {
                        choicesHtml += createChoiceRow(choice, false);
                    });
                    
                    if (elem.has_other) {
                        choicesHtml += createChoiceRow('__other_option__', true);
                    }

                    innerHtml += `
                        <div class="choices-list">
                            ${choicesHtml}
                        </div>
                        <div style="font-size:12px; color: var(--text-hint); margin-top: 8px;">
                            Ghi chú: Mỗi lựa chọn trong câu Hộp kiểm có xác suất được tích chọn độc lập (0% - 100%), không bắt buộc tổng bằng 100%.
                        </div>
                    `;
                } else if (['RadioGrid', 'CheckboxGrid'].includes(elem.type)) {
                    let gridHtml = '';
                    elem.rows.forEach(row => {
                        let colsHtml = '';
                        elem.choices.forEach(col => {
                            colsHtml += createChoiceRow(col, false);
                        });
                        
                        let isRadio = elem.type === 'RadioGrid';
                        let sumLabelHtml = isRadio ? `
                            <div class="choices-summary" style="margin-top: 6px;">
                                <span>Tổng hàng:</span>
                                <span class="total-percent-display sum-invalid" style="font-weight:700;">0%</span>
                            </div>
                        ` : `
                            <div class="choices-summary" style="margin-top: 6px;">
                                <span style="font-size:11px; color: var(--text-hint);">Từng ô độc lập (0-100%)</span>
                            </div>
                        `;

                        gridHtml += `
                            <div class="grid-row-container" data-row-name="${row}" style="margin-bottom:14px;">
                                <div class="grid-row-title">Hàng: ${row}</div>
                                <div class="choices-list">
                                    ${colsHtml}
                                </div>
                                ${sumLabelHtml}
                            </div>
                        `;
                    });

                    innerHtml += `
                        <div style="margin-top: 10px;">
                            ${gridHtml}
                        </div>
                    `;
                }

                qDiv.innerHTML = innerHtml;
                questionsContainer.appendChild(qDiv);
                qIndex++;
            });
        });

        attachPercentInputEvents();
    }

    function createChoiceRow(choiceVal, isOther) {
        let labelText = isOther ? 'Mục khác (Tự động điền)' : choiceVal;
        return `
            <div class="choice-row" data-choice-value="${choiceVal}">
                <span class="choice-label" title="${labelText}">${labelText}</span>
                <div class="choice-input-wrapper">
                    <input type="number" class="choice-percent-input" value="0" min="0" max="100" placeholder="0" />
                    <span class="percent-sign">%</span>
                </div>
            </div>
        `;
    }

    // 5. RENDER RIGHT-SIDE CHECKLIST STATUS PANEL (PURE TEXT STATUS)
    function renderQuestionChecklist(formData) {
        checklistContainer.innerHTML = '';
        let index = 1;

        formData.pages.forEach(page => {
            page.elements.forEach(elem => {
                if (['Radio', 'Dropdown', 'Scale', 'Checkboxes', 'RadioGrid', 'CheckboxGrid', 'Short', 'Paragraph', 'UserEmail'].includes(elem.type)) {
                    const item = document.createElement('div');
                    item.className = 'checklist-item';
                    item.dataset.qId = elem.id;

                    const typeText = getReadableTypeLabel(elem.type);
                    let statusHtml = `<span class="checklist-status-text invalid">Chưa đủ</span>`;
                    if (['Checkboxes', 'CheckboxGrid', 'Short', 'Paragraph', 'UserEmail'].includes(elem.type)) {
                        statusHtml = `<span class="checklist-status-text valid">Sẵn sàng</span>`;
                    }

                    item.innerHTML = `
                        <div class="checklist-item-index">${index}</div>
                        <div class="checklist-item-info">
                            <div class="checklist-item-title" title="${elem.name}">${elem.name}</div>
                            <div class="checklist-item-type">${typeText}</div>
                        </div>
                        <div class="checklist-item-status-wrapper">
                            ${statusHtml}
                        </div>
                    `;

                    item.addEventListener('click', () => {
                        document.querySelectorAll('.checklist-item').forEach(i => i.classList.remove('active'));
                        item.classList.add('active');

                        const qCard = document.querySelector(`.question-item[data-id="${elem.id}"]`);
                        if (qCard) {
                            qCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            qCard.style.borderColor = 'var(--primary)';
                            setTimeout(() => {
                                qCard.style.borderColor = '';
                            }, 1000);
                        }
                    });

                    checklistContainer.appendChild(item);
                }
                index++;
            });
        });
    }

    window.updateCustomListCount = function(textareaElem) {
        if (!textareaElem) return;
        const wrapper = textareaElem.closest('.static-input-wrapper');
        if (!wrapper) return;
        const counter = wrapper.querySelector('.custom-list-counter');
        if (!counter) return;
        const raw = textareaElem.value || '';
        let lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (lines.length === 1 && lines[0].includes(';')) {
            lines = lines[0].split(';').map(s => s.trim()).filter(Boolean);
        }
        counter.textContent = `Số dòng: ${lines.length}`;
    };

    window.handleStrategyChange = function(selectElem) {
        const staticWrapper = selectElem.nextElementSibling;
        if (!staticWrapper) return;
        const aiBar = staticWrapper.querySelector('.question-ai-prompt-bar');
        const helper = staticWrapper.querySelector('.custom-list-helper');
        const counter = staticWrapper.querySelector('.custom-list-counter');
        const textarea = staticWrapper.querySelector('.static-value-input');

        if (selectElem.value === 'custom_list') {
            staticWrapper.classList.remove('hidden');
            if (aiBar) aiBar.classList.remove('hidden');
            if (helper) {
                helper.textContent = 'Danh sách dữ liệu điền lần lượt (Mỗi dòng = 1 lượt chạy, có thể chỉnh sửa trực tiếp):';
            }
            if (counter) counter.classList.remove('hidden');
            if (textarea) {
                textarea.rows = 5;
                textarea.placeholder = 'Nhập hoặc dán danh sách câu trả lời vào đây (Mỗi dòng tương ứng với 1 lượt điền):\n- Cách 1: Nhập yêu cầu ở ô trên rồi bấm "Tạo bằng AI" để hệ thống tự tạo danh sách.\n- Cách 2: Tự dán danh sách có sẵn của bạn (tên người, tên công ty, ý kiến... mỗi dòng 1 mục).\n- Cách 3: Nếu để trống, khi chạy hệ thống sẽ tự động dùng AI sinh dữ liệu phù hợp với câu hỏi.';
                window.updateCustomListCount(textarea);
            }
        } else if (selectElem.value === 'static') {
            staticWrapper.classList.remove('hidden');
            if (aiBar) aiBar.classList.add('hidden');
            if (helper) {
                helper.textContent = 'Nội dung cố định (Tất cả các lượt chạy sẽ điền cùng giá trị này):';
            }
            if (counter) counter.classList.add('hidden');
            if (textarea) {
                textarea.rows = 2;
                textarea.placeholder = 'Nhập nội dung cố định sẽ điền giống nhau cho tất cả các lượt...';
            }
        } else {
            staticWrapper.classList.add('hidden');
        }
    };

    window.generateQuestionTextByAI = async function(btnElem) {
        if (!btnElem || !parsedForm) return;
        const container = btnElem.closest('.strategy-select-container');
        if (!container) return;

        const qName = container.dataset.qName || 'Câu hỏi';
        const qDesc = container.dataset.qDesc || '';
        const qItem = btnElem.closest('.question-item');
        const qType = qItem ? qItem.dataset.type : 'Short';
        const promptInput = container.querySelector('.question-ai-prompt-input');
        const textarea = container.querySelector('.static-value-input');
        const userPrompt = promptInput ? promptInput.value.trim() : '';
        const submissionsInput = document.getElementById('campaign-submissions');
        const count = submissionsInput ? (parseInt(submissionsInput.value) || 20) : 20;

        const origText = btnElem.textContent;
        btnElem.disabled = true;
        btnElem.textContent = 'Đang tạo...';

        try {
            const res = await fetch('/api/ai-generate-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    form_title: parsedForm.title || '',
                    form_description: parsedForm.description || '',
                    question_name: qName,
                    question_description: qDesc,
                    question_type: qType,
                    prompt: userPrompt,
                    count: count
                })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Lỗi khi gọi AI sinh dữ liệu.');
            }
            const items = data.items || [];
            if (textarea && items.length > 0) {
                textarea.value = items.join('\n');
                window.updateCustomListCount(textarea);
            }
            addLog('system', `AI đã tạo ${items.length} dòng dữ liệu cho câu "${qName}".`);
        } catch (err) {
            alert(`Lỗi AI: ${err.message}`);
            addLog('error', `Lỗi AI tạo dữ liệu câu "${qName}": ${err.message}`);
        } finally {
            btnElem.disabled = false;
            btnElem.textContent = origText;
        }
    };

    function attachPercentInputEvents() {
        const percentInputs = document.querySelectorAll('.choice-percent-input');
        percentInputs.forEach(input => {
            input.addEventListener('focus', () => {
                if (input.value === '0') {
                    input.value = '';
                } else {
                    input.select();
                }
            });

            input.addEventListener('input', () => {
                let rawVal = input.value;
                if (rawVal === '') {
                    updateAllSums();
                    return;
                }
                
                let val = parseInt(rawVal);
                if (isNaN(val) || val < 0) {
                    input.value = 0;
                } else if (val > 100) {
                    input.value = 100;
                }
                updateAllSums();
            });

            input.addEventListener('blur', () => {
                if (input.value.trim() === '') {
                    input.value = 0;
                    updateAllSums();
                }
            });
        });
        updateAllSums();
    }

    function updateAllSums() {
        const qItems = document.querySelectorAll('.question-item');
        qItems.forEach(qItem => {
            const id = qItem.dataset.id;
            const type = qItem.dataset.type;
            
            let isValid = true;
            
            if (['Radio', 'Dropdown', 'Scale'].includes(type)) {
                const inputs = qItem.querySelectorAll('.choice-percent-input');
                let sum = 0;
                inputs.forEach(input => sum += parseInt(input.value) || 0);
                
                const badge = qItem.querySelector('.sum-status-badge');
                if (badge) {
                    if (sum === 100) {
                        badge.textContent = `Tổng: 100% (Hợp lệ)`;
                        badge.className = 'sum-status-badge valid';
                        qItem.classList.remove('invalid-question');
                        qItem.classList.add('valid-question');
                    } else {
                        badge.textContent = `Tổng: ${sum}% (Thiếu ${100 - sum}%)`;
                        if (sum > 100) {
                            badge.textContent = `Tổng: ${sum}% (Thừa ${sum - 100}%)`;
                        }
                        badge.className = 'sum-status-badge invalid';
                        qItem.classList.remove('valid-question');
                        qItem.classList.add('invalid-question');
                        isValid = false;
                    }
                }
            } else if (type === 'RadioGrid') {
                const rows = qItem.querySelectorAll('.grid-row-container');
                rows.forEach(row => {
                    const inputs = row.querySelectorAll('.choice-percent-input');
                    let sum = 0;
                    inputs.forEach(input => sum += parseInt(input.value) || 0);
                    
                    const sumDisplay = row.querySelector('.total-percent-display');
                    if (sumDisplay) {
                        sumDisplay.textContent = sum + '%';
                        if (sum === 100) {
                            sumDisplay.className = 'total-percent-display sum-valid';
                        } else {
                            sumDisplay.className = 'total-percent-display sum-invalid';
                            isValid = false;
                        }
                    }
                });
                
                if (isValid) {
                    qItem.classList.remove('invalid-question');
                    qItem.classList.add('valid-question');
                } else {
                    qItem.classList.remove('valid-question');
                    qItem.classList.add('invalid-question');
                }
            } else {
                qItem.classList.remove('invalid-question');
                qItem.classList.add('valid-question');
            }

            const checklistItem = document.querySelector(`.checklist-item[data-q-id="${id}"]`);
            if (checklistItem) {
                const statusWrapper = checklistItem.querySelector('.checklist-item-status-wrapper');
                if (['Checkboxes', 'CheckboxGrid', 'Short', 'Paragraph', 'UserEmail'].includes(type)) {
                    statusWrapper.innerHTML = `<span class="checklist-status-text valid">Sẵn sàng</span>`;
                } else if (isValid) {
                    statusWrapper.innerHTML = `<span class="checklist-status-text valid">Đủ 100%</span>`;
                } else {
                    statusWrapper.innerHTML = `<span class="checklist-status-text invalid">Chưa đủ</span>`;
                }
            }
        });
    }

    if (btnAutoFillPercent) {
        btnAutoFillPercent.addEventListener('click', autoFillEqualPercentages);
    }

    document.querySelectorAll('.ai-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const promptText = chip.dataset.prompt;
            if (aiPromptInput && promptText) {
                aiPromptInput.value = promptText;
                aiPromptInput.focus();
            }
        });
    });

    if (btnAiDistribute) {
        btnAiDistribute.addEventListener('click', async () => {
            if (!parsedForm) {
                alert("Vui lòng dán link Google Form và bấm 'Phân tích biểu mẫu' trước khi dùng tính năng AI.");
                return;
            }

            const prompt = aiPromptInput ? aiPromptInput.value.trim() : '';
            const submissionsInput = document.getElementById('campaign-submissions');
            const count = submissionsInput ? (parseInt(submissionsInput.value) || 20) : 20;

            const questions = [];
            if (parsedForm.pages) {
                parsedForm.pages.forEach(page => {
                    (page.elements || []).forEach(elem => {
                        if (['Radio', 'Dropdown', 'Scale', 'Checkboxes', 'RadioGrid', 'CheckboxGrid', 'Short', 'Paragraph', 'UserEmail'].includes(elem.type)) {
                            questions.push({
                                id: String(elem.id),
                                name: elem.name || 'Câu hỏi',
                                description: elem.description || '',
                                type: elem.type,
                                choices: elem.choices || [],
                                has_other: !!elem.has_other,
                                rows: elem.rows || []
                            });
                        }
                    });
                });
            }

            if (questions.length === 0) {
                alert("Biểu mẫu này không có câu hỏi nào để AI phân tích.");
                return;
            }

            btnAiDistribute.disabled = true;
            if (btnAiText) btnAiText.classList.add('hidden');
            if (btnAiSpinner) btnAiSpinner.classList.remove('hidden');
            if (aiStatusMsg) {
                aiStatusMsg.className = 'ai-status-msg hidden';
                aiStatusMsg.textContent = '';
            }

            try {
                const response = await fetch('/api/ai-distribute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: prompt,
                        form_title: parsedForm.title || '',
                        form_description: parsedForm.description || '',
                        count: count,
                        questions: questions
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || "Lỗi khi gọi AI.");
                }

                const dist = data.distribution || {};
                const textSamples = data.text_samples || {};
                let updatedCount = 0;

                const qItems = document.querySelectorAll('.question-item');
                qItems.forEach(qItem => {
                    const id = String(qItem.dataset.id);
                    const type = qItem.dataset.type;

                    if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
                        const samples = textSamples[id];
                        if (Array.isArray(samples) && samples.length > 0) {
                            const select = qItem.querySelector('.strategy-select');
                            const textarea = qItem.querySelector('.static-value-input');
                            if (select) {
                                select.value = 'custom_list';
                                window.handleStrategyChange(select);
                            }
                            if (textarea) {
                                textarea.value = samples.join('\n');
                                window.updateCustomListCount(textarea);
                            }
                            updatedCount++;
                        }
                        return;
                    }

                    const qDist = dist[id];
                    if (!qDist) return;

                    if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                        const choiceRows = qItem.querySelectorAll('.choice-row');
                        choiceRows.forEach(row => {
                            const val = row.dataset.choiceValue;
                            const input = row.querySelector('.choice-percent-input');
                            if (input && qDist[val] !== undefined) {
                                input.value = qDist[val];
                            } else if (input && val === '__other_option__' && qDist['Mục khác'] !== undefined) {
                                input.value = qDist['Mục khác'];
                            }
                        });
                        updatedCount++;
                    } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                        const rowContainers = qItem.querySelectorAll('.grid-row-container');
                        rowContainers.forEach(container => {
                            const rowName = container.dataset.rowName;
                            const rowDist = qDist[rowName];
                            if (rowDist) {
                                const choiceRows = container.querySelectorAll('.choice-row');
                                choiceRows.forEach(crow => {
                                    const val = crow.dataset.choiceValue;
                                    const input = crow.querySelector('.choice-percent-input');
                                    if (input && rowDist[val] !== undefined) {
                                        input.value = rowDist[val];
                                    }
                                });
                            }
                        });
                        updatedCount++;
                    }
                });

                updateAllSums();

                const summaryText = data.summary || "Đã phân tích ngữ cảnh biểu mẫu, chia tỷ lệ % và tạo dữ liệu thành công.";
                if (aiStatusMsg) {
                    aiStatusMsg.className = 'ai-status-msg success';
                    aiStatusMsg.innerHTML = `<strong>Hoàn tất:</strong> ${summaryText} (Đã cập nhật ${updatedCount} câu hỏi).`;
                    aiStatusMsg.classList.remove('hidden');
                }

                addLog("system", `AI: "${summaryText}" - Đã cập nhật ${updatedCount} câu hỏi.`);

            } catch (err) {
                if (aiStatusMsg) {
                    aiStatusMsg.className = 'ai-status-msg error';
                    aiStatusMsg.innerHTML = `<strong>Lỗi AI:</strong> ${err.message}`;
                    aiStatusMsg.classList.remove('hidden');
                }
                addLog("error", `Lỗi phân tích AI: ${err.message}`);
            } finally {
                btnAiDistribute.disabled = false;
                if (btnAiText) btnAiText.classList.remove('hidden');
                if (btnAiSpinner) btnAiSpinner.classList.add('hidden');
            }
        });
    }

    function autoFillEqualPercentages() {
        if (!parsedForm) return;
        
        const qItems = document.querySelectorAll('.question-item');
        qItems.forEach(qItem => {
            const type = qItem.dataset.type;
            if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                const inputs = qItem.querySelectorAll('.choice-percent-input');
                if (inputs.length === 0) return;
                
                if (type === 'Checkboxes') {
                    inputs.forEach(input => input.value = 50);
                } else {
                    let base = Math.floor(100 / inputs.length);
                    let remainder = 100 % inputs.length;
                    
                    inputs.forEach((input, index) => {
                        input.value = base + (index < remainder ? 1 : 0);
                    });
                }
            } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                const rows = qItem.querySelectorAll('.grid-row-container');
                rows.forEach(row => {
                    const inputs = row.querySelectorAll('.choice-percent-input');
                    if (inputs.length === 0) return;
                    
                    if (type === 'CheckboxGrid') {
                        inputs.forEach(input => input.value = 50);
                    } else {
                        let base = Math.floor(100 / inputs.length);
                        let remainder = 100 % inputs.length;
                        inputs.forEach((input, index) => {
                            input.value = base + (index < remainder ? 1 : 0);
                        });
                    }
                });
            }
        });
        updateAllSums();
        addLog("system", "Đã chia đều tỷ lệ % cho tất cả các câu hỏi trắc nghiệm.");
    }

    function autoFillZeroPercentages() {
        if (!parsedForm) return;
        
        const inputs = document.querySelectorAll('.choice-percent-input');
        inputs.forEach(input => {
            input.value = 0;
        });
        updateAllSums();
        addLog("system", "Đã tải biểu mẫu. Các đáp án trắc nghiệm đang đặt mặc định là 0%.");
    }

    function getCurrentConfigPayload() {
        if (!parsedForm) return null;
        
        const percentages = {};
        const strategies = {};
        const static_values = {};
        const qItems = document.querySelectorAll('.question-item');
        
        qItems.forEach(qItem => {
            const id = qItem.dataset.id;
            const type = qItem.dataset.type;
            
            if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
                const select = qItem.querySelector('.strategy-select');
                strategies[id] = select ? select.value : 'default';
                const staticInput = qItem.querySelector('.static-value-input');
                if (staticInput) {
                    static_values[id] = staticInput.value;
                }
            } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                percentages[id] = {};
                const choiceRows = qItem.querySelectorAll('.choice-row');
                choiceRows.forEach(row => {
                    const val = row.dataset.choiceValue;
                    const pct = parseInt(row.querySelector('.choice-percent-input').value) || 0;
                    percentages[id][val] = pct;
                });
            } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                percentages[id] = {};
                const rows = qItem.querySelectorAll('.grid-row-container');
                rows.forEach(row => {
                    const rowName = row.dataset.rowName;
                    percentages[id][rowName] = {};
                    const choiceRows = row.querySelectorAll('.choice-row');
                    choiceRows.forEach(crow => {
                        const val = crow.dataset.choiceValue;
                        const pct = parseInt(crow.querySelector('.choice-percent-input').value) || 0;
                        percentages[id][rowName][val] = pct;
                    });
                });
            }
        });
        
        const submissions = parseInt(document.getElementById('campaign-submissions').value) || 10;
        const delay = parseFloat(document.getElementById('campaign-delay').value) || 1.0;
        const distributionMode = 'absolute';
        
        return {
            url: formUrlInput.value.trim().startsWith('CONFIG_') ? parsedForm.url : (parsedForm.url || formUrlInput.value.trim()),
            title: parsedForm.title,
            description: parsedForm.description,
            submissions: submissions,
            delay: delay,
            distribution_mode: distributionMode,
            percentages: percentages,
            strategies: strategies,
            static_values: static_values
        };
    }

    function applyConfigPayload(config) {
        if (!parsedForm) return;

        if (config.submissions) {
            document.getElementById('campaign-submissions').value = config.submissions;
        }
        if (config.delay) {
            document.getElementById('campaign-delay').value = config.delay;
        }

        // Apply compact v2 format (CONFIG_2_...)
        if (config.version === 2 && Array.isArray(config.qSegments)) {
            const qItems = document.querySelectorAll('.question-item');
            qItems.forEach((qItem, idx) => {
                const seg = config.qSegments[idx];
                if (!seg) return;
                const type = qItem.dataset.type;

                if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
                    const stratCode = seg[0];
                    const stratName = CODE_TO_STRATEGY[stratCode] || 'custom_list';
                    const select = qItem.querySelector('.strategy-select');
                    if (select) {
                        select.value = stratName;
                        window.handleStrategyChange(select);
                    }
                    if (config.customTexts && config.customTexts[idx] !== undefined) {
                        const staticInput = qItem.querySelector('.static-value-input');
                        if (staticInput) {
                            staticInput.value = config.customTexts[idx];
                            window.updateCustomListCount(staticInput);
                        }
                    }
                } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                    const inputs = qItem.querySelectorAll('.choice-percent-input');
                    inputs.forEach((inp, cIdx) => {
                        if (seg[cIdx] !== undefined) {
                            inp.value = seg[cIdx];
                        }
                    });
                } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                    const rowSegs = [];
                    let curRow = [];
                    for (let i = 0; i < seg.length; i++) {
                        if (seg[i] === 253) {
                            rowSegs.push(curRow);
                            curRow = [];
                        } else {
                            curRow.push(seg[i]);
                        }
                    }
                    rowSegs.push(curRow);

                    const rowContainers = qItem.querySelectorAll('.grid-row-container');
                    rowContainers.forEach((container, rIdx) => {
                        const rSeg = rowSegs[rIdx] || [];
                        const inputs = container.querySelectorAll('.choice-percent-input');
                        inputs.forEach((inp, cIdx) => {
                            if (rSeg[cIdx] !== undefined) {
                                inp.value = rSeg[cIdx];
                            }
                        });
                    });
                }
            });

            updateAllSums();
            return;
        }

        // Apply legacy v1 format (CONFIG_eyJ... or localStorage object)
        if (config.percentages) {
            const qItems = document.querySelectorAll('.question-item');
            qItems.forEach(qItem => {
                const id = qItem.dataset.id;
                const type = qItem.dataset.type;
                
                if (config.percentages[id]) {
                    if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                        const choiceRows = qItem.querySelectorAll('.choice-row');
                        choiceRows.forEach(row => {
                            const val = row.dataset.choiceValue;
                            if (config.percentages[id][val] !== undefined) {
                                row.querySelector('.choice-percent-input').value = config.percentages[id][val];
                            }
                        });
                    } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                        const rowContainers = qItem.querySelectorAll('.grid-row-container');
                        rowContainers.forEach(container => {
                            const rowName = container.dataset.rowName;
                            if (config.percentages[id][rowName]) {
                                const choiceRows = container.querySelectorAll('.choice-row');
                                choiceRows.forEach(row => {
                                    const val = row.dataset.choiceValue;
                                    if (config.percentages[id][rowName][val] !== undefined) {
                                        row.querySelector('.choice-percent-input').value = config.percentages[id][rowName][val];
                                    }
                                });
                            }
                        });
                    }
                }
            });
        }

        if (config.strategies) {
            const qItems = document.querySelectorAll('.question-item');
            qItems.forEach(qItem => {
                const id = qItem.dataset.id;
                const type = qItem.dataset.type;
                if (['Short', 'Paragraph', 'UserEmail'].includes(type) && config.strategies[id]) {
                    const select = qItem.querySelector('.strategy-select');
                    if (select) {
                        select.value = config.strategies[id];
                        handleStrategyChange(select);
                    }
                    if ((config.strategies[id] === 'static' || config.strategies[id] === 'custom_list') && config.static_values && config.static_values[id]) {
                        const staticInput = qItem.querySelector('.static-value-input');
                        if (staticInput) {
                            staticInput.value = config.static_values[id];
                            window.updateCustomListCount(staticInput);
                        }
                    }
                }
            });
        }

        updateAllSums();
    }

    // Bind configuration Save & Export buttons
    const btnSaveConfig = document.getElementById('btn-save-config');
    if (btnSaveConfig) {
        btnSaveConfig.addEventListener('click', () => {
            if (!parsedForm) return;
            const payload = getCurrentConfigPayload();
            if (!payload) return;
            
            let saved = JSON.parse(localStorage.getItem('saved_forms') || '[]');
            const idx = saved.findIndex(f => f.url === payload.url);
            if (idx !== -1) {
                saved[idx].title = payload.title;
                saved[idx].description = payload.description;
                saved[idx].configPayload = payload;
                localStorage.setItem('saved_forms', JSON.stringify(saved));
            } else {
                saved.push({
                    url: payload.url,
                    title: payload.title,
                    description: payload.description,
                    data: parsedForm,
                    configPayload: payload
                });
                localStorage.setItem('saved_forms', JSON.stringify(saved));
            }
            
            addLog("system", "Đã lưu cấu hình hiện tại vào trình duyệt.");
            alert("Đã lưu cấu hình vào trình duyệt thành công.");
        });
    }

    const btnExportConfig = document.getElementById('btn-export-config');
    if (btnExportConfig) {
        btnExportConfig.addEventListener('click', () => {
            if (!parsedForm) return;
            const payload = getCurrentConfigPayload();
            if (!payload) return;
            
            try {
                const configCode = encodeShortConfigCode(payload.url, payload.submissions, payload.delay);
                
                navigator.clipboard.writeText(configCode).then(() => {
                    addLog("system", `Đã sao chép mã cấu hình rút gọn (${configCode.length} ký tự) vào bộ nhớ tạm.`);
                    alert(`Đã sao chép Mã cấu hình rút gọn (${configCode.length} ký tự) vào bộ nhớ tạm:\n\n${configCode}\n\nBạn có thể dán mã này vào ô nhập ở Trang chủ bất cứ lúc nào (hệ thống vẫn hỗ trợ cả các mã cấu hình dài trước đây).`);
                }).catch(() => {
                    prompt("Sao chép mã cấu hình rút gọn dưới đây:", configCode);
                });
            } catch (err) {
                alert("Lỗi xuất cấu hình: " + err.message);
            }
        });
    }

    // 6. START CAMPAIGN HANDLER
    if (btnStart) {
        btnStart.addEventListener('click', async () => {
            if (!parsedForm) return;

            let validationFailed = false;
            let invalidQuestionNames = [];
            
            const qItems = document.querySelectorAll('.question-item');
            qItems.forEach(qItem => {
                const type = qItem.dataset.type;
                const qTitle = qItem.querySelector('.question-title').textContent.replace('*', '').trim();
                
                if (['Radio', 'Dropdown', 'Scale'].includes(type)) {
                    const badge = qItem.querySelector('.sum-status-badge');
                    if (badge && badge.classList.contains('invalid')) {
                        validationFailed = true;
                        invalidQuestionNames.push(`${qTitle} (Chưa đủ 100%)`);
                    }
                } else if (type === 'RadioGrid') {
                    const rows = qItem.querySelectorAll('.grid-row-container');
                    rows.forEach(row => {
                        const sumDisplay = row.querySelector('.total-percent-display');
                        const rowTitle = row.querySelector('.grid-row-title').textContent.trim();
                        if (sumDisplay && sumDisplay.classList.contains('sum-invalid')) {
                            validationFailed = true;
                            invalidQuestionNames.push(`${qTitle} [${rowTitle}] (Chưa đủ 100%)`);
                        }
                    });
                }
            });

            if (validationFailed) {
                alert(`Chưa thể bắt đầu chạy!\n\nVui lòng kiểm tra lại tổng tỷ lệ % (phải đủ 100%) ở các câu hỏi sau:\n- ${invalidQuestionNames.join('\n- ')}`);
                return;
            }

            const submissions = parseInt(document.getElementById('campaign-submissions').value) || 10;
            const delay = parseFloat(document.getElementById('campaign-delay').value) || 1.0;
            
            const config = {};
            qItems.forEach(qItem => {
                const id = qItem.dataset.id;
                const type = qItem.dataset.type;
                
                if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
                    const select = qItem.querySelector('.strategy-select');
                    const staticInput = qItem.querySelector('.static-value-input');
                    const aiPromptEl = qItem.querySelector('.question-ai-prompt-input');
                    config[id] = {
                        type: type,
                        strategy: select ? select.value : 'custom_list',
                        static_value: staticInput ? staticInput.value : '',
                        ai_prompt: aiPromptEl ? aiPromptEl.value.trim() : ''
                    };
                } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                    const choiceRows = qItem.querySelectorAll('.choice-row');
                    const options = {};
                    choiceRows.forEach(row => {
                        const val = row.dataset.choiceValue;
                        const pct = parseInt(row.querySelector('.choice-percent-input').value) || 0;
                        options[val] = pct;
                    });
                    config[id] = {
                        type: type,
                        options: options
                    };
                } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                    const rows = qItem.querySelectorAll('.grid-row-container');
                    const rowConfigs = {};
                    rows.forEach(row => {
                        const rowName = row.dataset.rowName;
                        const choiceRows = row.querySelectorAll('.choice-row');
                        const options = {};
                        choiceRows.forEach(crow => {
                            const val = crow.dataset.choiceValue;
                            const pct = parseInt(crow.querySelector('.choice-percent-input').value) || 0;
                            options[val] = pct;
                        });
                        rowConfigs[rowName] = options;
                    });
                    config[id] = {
                        type: type,
                        rows: rowConfigs
                    };
                }
            });

            btnStart.classList.add('hidden');
            if (btnStop) btnStop.classList.remove('hidden');
            
            const distributionMode = 'absolute';
            const strictMode = true;
            
            try {
                const res = await fetch('/api/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: parsedForm.url,
                        fields: config,
                        count: submissions,
                        delay: delay,
                        distribution_mode: distributionMode,
                        strict_mode: strictMode,
                        form_data: parsedForm,
                        config: config,
                        total_submissions: submissions
                    })
                });
                
                const resData = await res.json();
                if (!res.ok) {
                    throw new Error(resData.error || "Không thể khởi động chiến dịch.");
                }
                
                addLog("system", "Đang khởi chạy chiến dịch điền biểu mẫu tự động...");
                startPolling();
                
            } catch (err) {
                alert(err.message);
                restoreRunButtons();
            }
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', async () => {
            btnStop.disabled = true;
            btnStop.textContent = 'Đang dừng chiến dịch...';
            await fetch('/api/stop', { method: 'POST' });
        });
    }

    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                
                statSuccess.textContent = data.success;
                statFailed.textContent = data.failed;
                statProgress.textContent = `${data.current}/${data.total}`;
                
                let pct = data.total > 0 ? Math.floor((data.current / data.total) * 100) : 0;
                progressBarFill.style.width = pct + '%';
                
                renderLogs(data.logs);
                
                if (!data.active) {
                    clearInterval(pollInterval);
                    restoreRunButtons();
                }
            } catch (err) {
                console.error("Polling error:", err);
            }
        }, 1000);
    }

    function renderLogs(logsList) {
        logsContainer.innerHTML = '';
        logsList.forEach(log => {
            const line = document.createElement('div');
            line.className = 'log-line';
            
            if (log.includes('✅') || log.includes('Thành công')) {
                line.classList.add('success-log');
            } else if (log.includes('❌') || log.includes('Lỗi') || log.includes('Thất bại')) {
                line.classList.add('error-log');
            } else {
                line.classList.add('system-log');
            }
            
            line.textContent = log;
            logsContainer.appendChild(line);
        });
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    function restoreRunButtons() {
        if (btnStart) btnStart.classList.remove('hidden');
        if (btnStop) {
            btnStop.classList.add('hidden');
            btnStop.disabled = false;
            btnStop.textContent = 'Dừng chiến dịch';
        }
    }

    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', () => {
            logsContainer.innerHTML = '<div class="log-line system-log">Đã xóa nhật ký.</div>';
        });
    }

    function showError(msg) {
        if (parseError) {
            parseError.textContent = msg;
            parseError.classList.remove('hidden');
        }
    }

    function addLog(type, msg) {
        const timestamp = new Date().toTimeString().split(' ')[0];
        const line = document.createElement('div');
        line.className = `log-line ${type}-log`;
        line.textContent = `[${timestamp}] ${msg}`;
        logsContainer.appendChild(line);
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    // 7. QUICK TEXT IMPORT DIALOG
    const btnImportTextTrigger = document.getElementById('btn-import-text-trigger');
    const importTextModal = document.getElementById('import-text-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelImport = document.getElementById('btn-cancel-import');
    const btnSubmitImport = document.getElementById('btn-submit-import');
    const importTextArea = document.getElementById('import-text-area');

    if (btnImportTextTrigger) {
        btnImportTextTrigger.addEventListener('click', () => {
            if (importTextModal) importTextModal.classList.remove('hidden');
            if (importTextArea) importTextArea.focus();
        });
    }

    const closeModal = () => {
        if (importTextModal) importTextModal.classList.add('hidden');
        if (importTextArea) importTextArea.value = '';
    };

    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
    if (btnCancelImport) btnCancelImport.addEventListener('click', closeModal);

    if (btnSubmitImport) {
        btnSubmitImport.addEventListener('click', () => {
            const text = importTextArea.value;
            if (!text.trim()) {
                alert("Vui lòng dán văn bản báo cáo.");
                return;
            }

            const parsedData = parseTextPercentages(text);
            if (parsedData.length === 0) {
                alert("Không tìm thấy dữ liệu tỷ lệ % hợp lệ trong văn bản. Vui lòng kiểm tra lại định dạng.");
                return;
            }

            let matchCount = 0;
            const qItems = document.querySelectorAll('.question-item');
            
            qItems.forEach(qItem => {
                const qTitle = qItem.querySelector('.question-title').textContent.replace('*', '').trim();
                const type = qItem.dataset.type;
                const matchedQ = parsedData.find(q => fuzzyMatch(q.title, qTitle));
                
                if (matchedQ) {
                    matchCount++;
                    if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                        const choiceRows = qItem.querySelectorAll('.choice-row');
                        choiceRows.forEach(row => {
                            const choiceVal = row.dataset.choiceValue;
                            const matchedKey = Object.keys(matchedQ.choices).find(k => fuzzyMatch(k, choiceVal));
                            if (matchedKey !== undefined) {
                                const val = matchedQ.choices[matchedKey];
                                row.querySelector('.choice-percent-input').value = val;
                            }
                        });
                    } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                        const rowContainers = qItem.querySelectorAll('.grid-row-container');
                        rowContainers.forEach(container => {
                            const rowName = container.dataset.rowName;
                            const matchedRowQ = parsedData.find(q => fuzzyMatch(q.title, rowName));
                            if (matchedRowQ) {
                                const choiceRows = container.querySelectorAll('.choice-row');
                                choiceRows.forEach(row => {
                                    const choiceVal = row.dataset.choiceValue;
                                    const matchedKey = Object.keys(matchedRowQ.choices).find(k => fuzzyMatch(k, choiceVal));
                                    if (matchedKey !== undefined) {
                                        const val = matchedRowQ.choices[matchedKey];
                                        row.querySelector('.choice-percent-input').value = val;
                                    }
                                });
                            }
                        });
                    }
                }
            });

            updateAllSums();
            closeModal();
            addLog("system", `Đã tự động khớp và điền tỷ lệ % cho ${matchCount} câu hỏi.`);
            alert(`Đã khớp và điền tỷ lệ % cho ${matchCount} câu hỏi.`);
        });
    }

    function parseTextPercentages(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        const questionData = [];
        let currentQuestion = null;
        
        lines.forEach(line => {
            const isQuestion = line.match(/^câu\s+\d+(\.\d+)*:/i) || line.includes('?') || line.startsWith('PHẦN ');
            
            if (isQuestion) {
                currentQuestion = {
                    title: line,
                    choices: {}
                };
                questionData.push(currentQuestion);
            } else if (currentQuestion) {
                const percentMatch = line.match(/(\d+)\s*%/);
                if (percentMatch) {
                    const percentage = parseInt(percentMatch[1]);
                    let choiceText = line;
                    
                    const colonIdx = line.indexOf(':');
                    if (colonIdx !== -1 && colonIdx < line.indexOf(percentMatch[0])) {
                        choiceText = line.substring(0, colonIdx).trim();
                    } else {
                        choiceText = line.split(percentMatch[0])[0].trim();
                    }
                    
                    choiceText = choiceText.replace(/[:\-–—\s\.\d]+$/, '').replace(/^[\-\–\—\s\.\d]+/, '').trim();
                    
                    if (choiceText) {
                        currentQuestion.choices[choiceText.toLowerCase()] = percentage;
                    }
                }
            }
        });
        
        return questionData;
    }

    checkAuthState();
});
