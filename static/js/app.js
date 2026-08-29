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
    },
    "trungbinhmoingaybansudungdienthoaithongminhmaytinhlaptop": {
        "duoi2gio": 1,
        "24gio": 4,
        "46gio": 10,
        "68gio": 35,
        "tren8gio": 50
    },
    "banthuongsudungthietbidientuvaothoidiemnaotrongngay": {
        "sang": 60,
        "buoitrua": 70,
        "buoichieu": 80,
        "buoitoi": 85,
        "sau22gio": 75,
        "truockhidingu": 80
    },
    "banthuongsudungdienthoaihoacmaytinhtrongvong1giotruockhidingu": {
        "gannhukhongbaogio": 2,
        "hiemkhi": 3,
        "thinthoang": 10,
        "thuongxuyen": 25,
        "gannhumoingay": 60
    },
    "saukhisudungdienthoaihoacmaytinhtrongthoigiandaibancongthuo": {
        "khongbaogio": 1,
        "hiemkhi": 4,
        "thinthoang": 10,
        "gannhumoingay": 30,
        "thuongxuyen": 55
    },
    "banthuonggapnhungbieuhiennaosaudaysauthoigiansudungthietbi": {
        "camgiacmoimat": 85,
        "camgiackhomat": 65,
        "camgiacnanghoackhachiuquanhmat": 45,
        "nhucdau": 40,
        "khotaptrung": 45,
        "muonnhammathoacnghimat": 75,
        "camgiaccangthangmetmoi": 50,
        "khonggapbieuhiennao": 1,
        "muckhac": 2,
        "khac": 2
    },
    "mucdokhoachiuomatcuabansaumotngaysudungthietbidientuthuong": {
        "1hoantoankhongkhoachiu": 2,
        "1": 2,
        "2khoachiunhe": 8,
        "2": 8,
        "3khoachiuvoiphai": 35,
        "3": 35,
        "4khoachiunhieu": 45,
        "4": 45,
        "5ratkhoachiu": 10,
        "5": 10
    },
    "banthuongcamthaykhoachiuomatvaothoidiemnao": {
        "buoisang": 10,
        "buoichieu": 35,
        "buoitoi": 60,
        "saukhihoctaplamviecnhieugio": 80,
        "truockhidingu": 70,
        "khongcothoidiemcuthe": 2,
        "khac": 1
    },
    "bancothuongcamthaykhothugiansaumotngayhoctaplamviec": {
        "khongbaogio": 1,
        "hiemkhi": 4,
        "thinthoang": 20,
        "thuongxuyen": 50,
        "gannhumoingay": 25
    },
    "bancothuongsudungthietbidientungaytruockhingu": {
        "khongbaogio": 1,
        "hiemkhi": 4,
        "thinthoang": 10,
        "thuongxuyen": 25,
        "gannhumoingay": 60
    },
    "khicamthaymoimathoaccanthugiansauthoigiansudungthietbi": {
        "nhammatnghimat": 70,
        "ngu": 45,
        "ruamat": 30,
        "uongnuoc": 25,
        "sudungthuocnhomat": 50,
        "dapmatnamat": 10,
        "sudungtuichuom": 5,
        "sudungmatnamatlamam": 12,
        "massagemat": 35,
        "dispagoidauduongsinh": 8,
        "khonglamgi": 5,
        "muckhac": 2,
        "khac": 2
    },
    "bandatungsudungsanphamchuommatmatnamathoacsanpham": {
        "datungsudung": 45,
        "chuatungsudung": 55
    },
    "neudatungsudungbanthuongsudungsanphamnao": {
        "tuichuommat": 15,
        "matnamatlamamdungmotlandung": 50,
        "matnamatlamamdungmotlan": 50,
        "tuichuomdien": 15,
        "matnamatthuong": 20,
        "matnamatthuongthuong": 20,
        "chuatungsudung": 0
    },
    "banthuongsudungnhungsanphamtrevoitansuatnhuthenao": {
        "haumukhongsudung": 10,
        "12lanthang": 25,
        "12lantuan": 45,
        "35lantuan": 15,
        "gannhumoingay": 5
    },
    "mucdohailongcuabanvoigiaiphaphientaila": {
        "1ratkhonghailong": 5,
        "1": 5,
        "2khonghailong": 25,
        "2": 25,
        "3binhthuong": 50,
        "3": 50,
        "4hailong": 15,
        "4": 15,
        "5rathailong": 5,
        "5": 5
    },
    "dieughikhienbanchuathucsuthailongvoigiaiphaphientai": {
        "giacao": 40,
        "khongtiensudung": 30,
        "khomangtheo": 25,
        "phaisudungnhieubuoc": 35,
        "khongphuhoapvoithoiquencanhan": 15,
        "dungmotlantaonhieurac": 55,
        "khongthichmui": 10,
        "thietkekhongdep": 15,
        "khongbietronguongocthanhphan": 30,
        "khongtaocamgiacthugiannhumongmuon": 35,
        "toichuatungsudunggiaiphapnao": 0,
        "muckhac": 2,
        "khac": 2
    },
    "neubanchuatungsudungsanphamhotrothugianmatlydo": {
        "chuathaycanthiet": 20,
        "chuabietsanphamphuhoap": 45,
        "giachuaphuhoap": 15,
        "khongtinhtuonghieuqua": 10,
        "khongcothoigian": 5,
        "chuatungduocgioithieu": 5,
        "muckhac": 0,
        "khac": 0
    },
    "neusudungmotsanphamhotrothugianmatbanmongmuonsanpham": {
        "tietkiemthoigian": 60,
        "cothesudungtainha": 70,
        "cothemangdilamdihoc": 55,
        "cothemangdilam": 55,
        "cothemangdihoc": 55,
        "cokhanangtaisudung": 80,
        "nguongoctunhien": 75,
        "muihuongdechiu": 60,
        "thietkedep": 50,
        "giahoply": 65,
        "baobithanthienmoitruong": 50,
        "nguongocnguyenlieuroorang": 65,
        "phuhoaplamquatang": 40,
        "khac": 2
    },
    "yeutonaoquantrongnhatvoibanhilachonmotsanpham": {
        "gia": 15,
        "congdungtrainghiemsudung": 40,
        "nguongocnguyenlieu": 15,
        "doantoan": 10,
        "thietke": 5,
        "muihuong": 2,
        "tinhtienloi": 3,
        "khanangtaisudung": 10,
        "thuonghieu": 0,
        "khac": 0
    },
    "banthichsanphamthugianmatcophongcachthietkenhuthenao": {
        "toigian": 30,
        "mocmacganguithiennhien": 55,
        "hientai": 5,
        "thanhlich": 5,
        "dethuong": 3,
        "sangtrong": 1,
        "khongquantrong": 1
    },
    "saukhidocmotatrenmucdoquantamcuabandoivoisanphammockien": {
        "1hoantoankhongquantam": 1,
        "1": 1,
        "2itquantam": 4,
        "2": 4,
        "3phanvan": 15,
        "3": 15,
        "4quantam": 50,
        "4": 50,
        "5ratquantam": 30,
        "5": 30
    },
    "bandanhgiamucdophuhoapcuamockienvoinhucaucuaminhnhuthenao": {
        "1hoantoankhongphuhoap": 1,
        "1": 1,
        "2khongphuhoap": 4,
        "2": 4,
        "3binhthuong": 15,
        "3": 15,
        "4khaphuhoap": 55,
        "4": 55,
        "5ratphuhoap": 25,
        "5": 25
    },
    "diemnaocuamockienkhienbanquantamnhat": {
        "cothesudungtainha": 60,
        "thietkenhogon": 45,
        "cothetaisudung": 65,
        "thanhphanconguongoctunhien": 70,
        "sudungnguyenlieubandia": 75,
        "muihuongthaomoc": 45,
        "tinhthammy": 35,
        "baobithanthienmoitruong": 50,
        "giadukien": 40,
        "cothesudungnhuquatang": 35,
        "khac": 0
    },
    "dieughicothekhienbankhongmuonmuamockien": {
        "giacao": 30,
        "khongchacchanvehieuqua": 40,
        "loangaivedoantoan": 10,
        "khongthichmuithaomoc": 5,
        "khongthichcamgiacchuomam": 5,
        "khongquensudungsanphamdangtuichuom": 20,
        "loangaiveveisinh": 15,
        "khongthichthietke": 5,
        "khongconhucau": 5,
        "khongtinhtuongthuonghieumoi": 25,
        "muckhac": 0,
        "khac": 0
    },
    "nemockiencochatluongvadacdiemnhumotamucgianaoban": {
        "duoi50000dong": 2,
        "5000099000dong": 10,
        "100000149000dong": 55,
        "150000199000dong": 30,
        "200000249000dong": 2,
        "tu250000dongtrolen": 1
    },
    "omucgianaobanchorangmockienbatdautronenguadat": {
        "100000dong": 2,
        "150000dong": 8,
        "200000dong": 35,
        "250000dong": 45,
        "300000dong": 7,
        "tren300000dong": 3
    },
    "neusanphamcogiacaohoansanphamthuongkhoang510": {
        "sangsangmua": 45,
        "cothecannhacmua": 45,
        "khongquantam": 7,
        "khongmuonmua": 3
    },
    "neumockienduocbantrenshopeehoactiktokshopvoimucgiaphu": {
        "1chacchankhongmua": 1,
        "1": 1,
        "2cothekhongmua": 4,
        "2": 4,
        "3chuaquyetdinh": 15,
        "3": 15,
        "4cokhanangmua": 50,
        "4": 50,
        "5ratcokhanangmua": 30,
        "5": 30
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
            
            // Get saved users or use default
            const users = JSON.parse(localStorage.getItem('users') || '[]');
            let user = users.find(u => u.username === usernameInput);
            
            // If they just use default "Le Ngoc Minh" or match a registered user
            if (!user && usernameInput === "Le Ngoc Minh") {
                user = { name: "Lê Ngọc Minh", username: "Le Ngoc Minh" };
            }

            if (user) {
                localStorage.setItem('currentUser', JSON.stringify(user));
                checkAuthState();
            } else {
                alert("Tài khoản không tồn tại. Vui lòng bấm Đăng ký ngay để tạo tài khoản mới!");
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
                alert("Tên đăng nhập này đã tồn tại!");
                return;
            }

            const newUser = { name: nameInput, username: usernameInput };
            users.push(newUser);
            localStorage.setItem('users', JSON.stringify(users));
            localStorage.setItem('currentUser', JSON.stringify(newUser));
            
            alert("Đăng ký tài khoản thành công!");
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
            // Render previously loaded forms on dashboard load
            renderSavedFormsList();
        } else {
            if (loginScreen) loginScreen.classList.remove('hidden');
            if (dashboardScreen) dashboardScreen.classList.add('hidden');
        }
    }

    // 2. DASHBOARD NAVIGATION HANDLERS (PANELS SWITCHING)
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
            
            // Remove active classes
            menuItems.forEach(i => i.classList.remove('active'));
            contentPanels.forEach(p => p.classList.remove('active'));

            // Set active
            item.classList.add('active');
            const targetPanel = document.getElementById(targetPanelId);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }

            // Sync empty screen panels logic
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
                showError("Vui lòng nhập đường dẫn biểu mẫu hoặc mã cấu hình.");
                return;
            }

            let pendingConfig = null;
            if (url.startsWith('CONFIG_')) {
                try {
                    const jsonStr = decodeURIComponent(escape(atob(url.replace('CONFIG_', ''))));
                    pendingConfig = JSON.parse(jsonStr);
                    url = pendingConfig.url;
                } catch (err) {
                    showError("Mã cấu hình không hợp lệ hoặc bị lỗi.");
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
                    throw new Error(data.error || "Có lỗi xảy ra khi phân tích form.");
                }

                parsedForm = data;
                parsedForm.url = url;

                // Persist form to localStorage database
                saveFormToLocalStorage(url, data);
                
                // Load details
                formTitleDisplay.textContent = data.title;
                formDescDisplay.textContent = data.description || "Không có mô tả.";
                
                if (data.requires_signin) {
                    showError("CẢNH BÁO: Form này yêu cầu đăng nhập tài khoản Google (Giới hạn 1 câu trả lời). Hệ thống có thể không điền tự động được.");
                }

                // Render both Questions and Right-side Question Checklist
                renderQuestions(data);
                renderQuestionChecklist(data);
                
                // Show campaign Workspace & Navigate to it
                document.querySelector('.menu-item[data-panel="panel-active-form-view"]').click();
                
                if (pendingConfig) {
                    applyConfigPayload(pendingConfig);
                    addLog("system", `Đã tải và tự động cấu hình biểu mẫu từ mã: "${data.title}"`);
                    alert("Tải cấu hình thành công!");
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

    // Save and retrieve loaded forms database in localStorage
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

        // Remove old lists if any
        const oldList = document.getElementById('saved-forms-list-container');
        if (oldList) oldList.remove();

        if (saved.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        const listContainer = document.createElement('div');
        listContainer.id = 'saved-forms-list-container';
        listContainer.style.marginTop = '20px';

        let listHtml = `
            <div class="card">
                <div class="card-header">
                    <h2><i class="fa-solid fa-list-check"></i> Các biểu mẫu của bạn</h2>
                </div>
                <div class="card-body" style="padding: 0;">
                    <table class="premium-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--border); background-color: rgba(10, 14, 23, 0.4);">
                                <th style="padding: 14px 20px;">TÊN BIỂU MẪU</th>
                                <th style="padding: 14px 20px; display: none;">MÔ TẢ</th>
                                <th style="padding: 14px 20px; text-align: right;">HÀNH ĐỘNG</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        saved.forEach((form, idx) => {
            listHtml += `
                <tr style="border-bottom: 1px solid var(--border);" class="table-row-hover">
                    <td style="padding: 16px 20px; font-weight: 700; color: var(--text-main); max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${form.title}">${form.title}</td>
                    <td style="padding: 16px 20px; text-align: right;">
                        <button class="btn btn-primary btn-xs btn-open-saved" data-idx="${idx}">
                            <i class="fa-solid fa-sliders"></i> Cấu hình
                        </button>
                        <button class="btn btn-danger btn-xs btn-delete-saved" data-idx="${idx}" style="margin-left: 8px;">
                            <i class="fa-solid fa-trash-can"></i> Xóa
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

        // Attach clicks to Open buttons
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
                    addLog("system", `Đã phục hồi cấu hình phần trăm đã lưu cho: "${parsedForm.title}"`);
                } else {
                    autoFillZeroPercentages();
                    addLog("system", `Đã tải biểu mẫu lưu trữ (chưa có cấu hình %): "${parsedForm.title}"`);
                }

                document.querySelector('.menu-item[data-panel="panel-active-form-view"]').click();
            });
        });

        // Attach clicks to Delete buttons
        document.querySelectorAll('.btn-delete-saved').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                const saved = JSON.parse(localStorage.getItem('saved_forms') || '[]');
                
                if (confirm(`Bạn có chắc chắn muốn xóa biểu mẫu "${saved[idx].title}" khỏi danh sách đã lưu?`)) {
                    saved.splice(idx, 1);
                    localStorage.setItem('saved_forms', JSON.stringify(saved));
                    renderSavedFormsList(); // re-render list
                }
            });
        });
    }

    // 4. RENDER DETAILED QUESTION CARDS (SCREENSHOT 3)
    function renderQuestions(formData) {
        questionsContainer.innerHTML = '';
        let qIndex = 1;
        
        formData.pages.forEach(page => {
            const pageHeader = document.createElement('div');
            pageHeader.className = 'page-header-separator';
            pageHeader.innerHTML = `<h3 style="font-size: 12px; margin: 15px 0 10px 0; color: var(--text-hint); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">${page.title}</h3>`;
            questionsContainer.appendChild(pageHeader);

            page.elements.forEach(elem => {
                const qDiv = document.createElement('div');
                qDiv.className = 'question-item';
                qDiv.dataset.id = elem.id;
                qDiv.dataset.type = elem.type;

                // Render Header Title & Status Badges
                let reqHtml = elem.required ? `<span class="question-required">*</span>` : '';
                let metaHtml = `<span class="question-badge">${elem.type}</span>`;
                let sumStatusHtml = ['Radio', 'Dropdown', 'Scale'].includes(elem.type) ? 
                    `<span class="sum-status-badge invalid">Tổng: 0% (Thiếu 100%)</span>` : '';
                
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

                // Render dynamic choices in GRID style (Screenshot 3)
                if (['Short', 'Paragraph', 'UserEmail'].includes(elem.type)) {
                    innerHtml += `
                        <div class="strategy-select-container">
                            <label style="font-size: 12px; color: var(--text-muted); font-weight: 600; display:block; margin-bottom:4px;">Bộ sinh dữ liệu ảo:</label>
                            <select class="strategy-select" onchange="handleStrategyChange(this)">
                                <option value="default">(Mặc định tự nhận diện)</option>
                                <option value="vi_name">Họ & Tên Tiếng Việt</option>
                                <option value="vi_phone">Số Điện Thoại VN (09x/03x...)</option>
                                <option value="email">Địa Chỉ Email Ngẫu Nhiên</option>
                                <option value="number">Số Tuổi Ngẫu Nhiên (18 - 60)</option>
                                <option value="text">Văn Bản Ngẫu Nhiên</option>
                                <option value="static">Giá Trị Cố Định</option>
                            </select>
                            <div class="static-input-wrapper hidden" style="margin-top:8px;">
                                <input type="text" class="static-value-input" placeholder="Nhập giá trị điền cố định..." />
                            </div>
                        </div>
                    `;
                } else if (['Radio', 'Dropdown', 'Scale'].includes(elem.type)) {
                    let choicesHtml = '';
                    elem.choices.forEach(choice => {
                        choicesHtml += createChoiceRow(choice, false, elem.type);
                    });
                    
                    if (elem.has_other) {
                        choicesHtml += createChoiceRow('__other_option__', true, elem.type);
                    }

                    innerHtml += `
                        <div class="choices-list">
                            ${choicesHtml}
                        </div>
                    `;
                } else if (elem.type === 'Checkboxes') {
                    let choicesHtml = '';
                    elem.choices.forEach(choice => {
                        choicesHtml += createChoiceRow(choice, false, elem.type);
                    });
                    
                    if (elem.has_other) {
                        choicesHtml += createChoiceRow('__other_option__', true, elem.type);
                    }

                    innerHtml += `
                        <div class="choices-list">
                            ${choicesHtml}
                        </div>
                        <div style="font-size:11.5px; color: var(--text-hint); margin-top: 10px;">
                            * Tỷ lệ mỗi hộp kiểm độc lập (0-100%), không yêu cầu tổng % bằng 100%.
                        </div>
                    `;
                } else if (['RadioGrid', 'CheckboxGrid'].includes(elem.type)) {
                    let gridHtml = '';
                    elem.rows.forEach(row => {
                        let colsHtml = '';
                        elem.choices.forEach(col => {
                            colsHtml += createChoiceRow(col, false, elem.type);
                        });
                        
                        let isRadio = elem.type === 'RadioGrid';
                        let sumLabelHtml = isRadio ? `
                            <div class="choices-summary" style="margin-top: 8px;">
                                <span>Tổng hàng:</span>
                                <span class="total-percent-display sum-invalid" style="font-weight:700;">0%</span>
                            </div>
                        ` : `
                            <div class="choices-summary" style="margin-top: 8px;">
                                <span style="font-size:10px; color: var(--text-hint);">* Từng ô độc lập</span>
                            </div>
                        `;

                        gridHtml += `
                            <div class="grid-row-container" data-row-name="${row}" style="margin-bottom:14px;">
                                <div class="grid-row-title"><i class="fa-solid fa-chevron-right" style="font-size:9px; color:var(--primary);"></i> Hàng: ${row}</div>
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

        // Attach events
        attachPercentInputEvents();
    }

    function createChoiceRow(choiceVal, isOther, type) {
        let labelText = isOther ? 'Đáp án khác (Tự động)' : choiceVal;
        let iconClass = ['Checkboxes', 'CheckboxGrid'].includes(type) ? 'fa-regular fa-square' : 'fa-regular fa-circle-dot';
        return `
            <div class="choice-row" data-choice-value="${choiceVal}">
                <span class="choice-label" title="${labelText}"><i class="${iconClass}"></i> ${labelText}</span>
                <div class="choice-input-wrapper">
                    <input type="number" class="choice-percent-input" value="0" min="0" max="100" />
                    <span class="percent-sign">%</span>
                </div>
            </div>
        `;
    }

    // 5. RENDER RIGHT-SIDE CHECKLIST STATUS PANEL (SCREENSHOT 3)
    function renderQuestionChecklist(formData) {
        checklistContainer.innerHTML = '';
        let index = 1;

        formData.pages.forEach(page => {
            page.elements.forEach(elem => {
                // Only choice questions require status tracking in the list
                if (['Radio', 'Dropdown', 'Scale', 'Checkboxes', 'RadioGrid', 'CheckboxGrid'].includes(elem.type)) {
                    const item = document.createElement('div');
                    item.className = 'checklist-item';
                    item.dataset.qId = elem.id;

                    let typeText = 'Lựa chọn';
                    if (elem.type === 'Checkboxes') typeText = 'Hộp kiểm';
                    else if (elem.type === 'RadioGrid') typeText = 'Hàng Lựa chọn';
                    else if (elem.type === 'CheckboxGrid') typeText = 'Hàng Hộp kiểm';

                    let iconHtml = `<i class="fa-solid fa-circle-exclamation checklist-item-status invalid"></i>`;
                    if (elem.type === 'Checkboxes' || elem.type === 'CheckboxGrid') {
                        iconHtml = `<i class="fa-solid fa-circle-check checklist-item-status valid"></i>`;
                    }

                    item.innerHTML = `
                        <div class="checklist-item-index">${index}</div>
                        <div class="checklist-item-info">
                            <div class="checklist-item-title" title="${elem.name}">${elem.name}</div>
                            <div class="checklist-item-type">${typeText}</div>
                        </div>
                        <div class="checklist-item-status-wrapper">
                            ${iconHtml}
                        </div>
                    `;

                    // Click event to scroll to question card smoothly
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

    window.handleStrategyChange = function(selectElem) {
        const staticWrapper = selectElem.nextElementSibling;
        if (selectElem.value === 'static') {
            staticWrapper.classList.remove('hidden');
        } else {
            staticWrapper.classList.add('hidden');
        }
    };

    function attachPercentInputEvents() {
        const percentInputs = document.querySelectorAll('.choice-percent-input');
        percentInputs.forEach(input => {
            input.addEventListener('input', () => {
                let val = parseInt(input.value);
                if (isNaN(val) || val < 0) input.value = 0;
                if (val > 100) input.value = 100;
                
                updateAllSums();
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

            // Update checklist icon status
            const checklistItem = document.querySelector(`.checklist-item[data-q-id="${id}"]`);
            if (checklistItem) {
                const statusWrapper = checklistItem.querySelector('.checklist-item-status-wrapper');
                if (isValid) {
                    statusWrapper.innerHTML = `<i class="fa-solid fa-circle-check checklist-item-status valid"></i>`;
                } else {
                    statusWrapper.innerHTML = `<i class="fa-solid fa-circle-exclamation checklist-item-status invalid"></i>`;
                }
            }
        });
    }

    // Auto equal distribution logic
    if (btnAutoFillPercent) {
        btnAutoFillPercent.addEventListener('click', autoFillEqualPercentages);
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
        addLog("system", "⚡ Đã phân phối đều tỷ lệ % các lựa chọn đáp án.");
    }

    function autoFillZeroPercentages() {
        if (!parsedForm) return;
        
        const inputs = document.querySelectorAll('.choice-percent-input');
        inputs.forEach(input => {
            input.value = 0;
        });
        updateAllSums();
        addLog("system", "ℹ️ Đã tải biểu mẫu. Tất cả các đáp án được đặt mặc định là 0%.");
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
        
        return {
            url: formUrlInput.value.trim().startsWith('CONFIG_') ? parsedForm.url : formUrlInput.value.trim(),
            title: parsedForm.title,
            description: parsedForm.description,
            submissions: submissions,
            delay: delay,
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
                    if (config.strategies[id] === 'static' && config.static_values && config.static_values[id]) {
                        const staticInput = qItem.querySelector('.static-value-input');
                        if (staticInput) staticInput.value = config.static_values[id];
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
            
            addLog("system", "💾 Đã lưu cấu hình phần trăm hiện tại vào trình duyệt.");
            alert("Lưu cấu hình thành công!");
        });
    }

    const btnExportConfig = document.getElementById('btn-export-config');
    if (btnExportConfig) {
        btnExportConfig.addEventListener('click', () => {
            if (!parsedForm) return;
            const payload = getCurrentConfigPayload();
            if (!payload) return;
            
            try {
                const jsonStr = JSON.stringify(payload);
                const base64Str = btoa(unescape(encodeURIComponent(jsonStr)));
                const configCode = "CONFIG_" + base64Str;
                
                navigator.clipboard.writeText(configCode).then(() => {
                    addLog("system", "📋 Đã sao chép mã cấu hình chia sẻ vào bộ nhớ tạm.");
                    alert("Đã sao chép Mã cấu hình vào bộ nhớ tạm! Bạn có thể lưu mã này vào Notepad để dùng lại bất cứ lúc nào.");
                }).catch(err => {
                    alert("Không thể sao chép tự động. Hãy sao chép mã này:\n\n" + configCode);
                });
            } catch (err) {
                alert("Lỗi xuất cấu hình: " + err.message);
            }
        });
    }

    function autoFillDefaultPercentages() {
        if (!parsedForm) return;
        
        const qItems = document.querySelectorAll('.question-item');
        let matchedCount = 0;
        
        qItems.forEach(qItem => {
            const type = qItem.dataset.type;
            const qTitle = qItem.querySelector('.question-title').textContent.replace('*', '').trim();
            const matchedKey = Object.keys(defaultPercentagesMap).find(k => fuzzyMatch(k, qTitle));
            
            if (matchedKey) {
                matchedCount++;
                const questionConfig = defaultPercentagesMap[matchedKey];
                
                if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                    const choiceRows = qItem.querySelectorAll('.choice-row');
                    let filledCount = 0;
                    
                    choiceRows.forEach(row => {
                        const choiceVal = row.dataset.choiceValue;
                        const matchedChoiceKey = Object.keys(questionConfig).find(k => fuzzyMatch(k, choiceVal));
                        if (matchedChoiceKey !== undefined) {
                            const val = questionConfig[matchedChoiceKey];
                            row.querySelector('.choice-percent-input').value = val;
                            filledCount++;
                        }
                    });
                    
                    if (filledCount < choiceRows.length) {
                        choiceRows.forEach(row => {
                            const input = row.querySelector('.choice-percent-input');
                            if (!input.value) {
                                input.value = 0;
                            }
                        });
                    }
                } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                    const rowContainers = qItem.querySelectorAll('.grid-row-container');
                    rowContainers.forEach(container => {
                        const rowName = container.dataset.rowName;
                        const matchedRowKey = Object.keys(defaultPercentagesMap).find(k => fuzzyMatch(k, rowName));
                        
                        if (matchedRowKey) {
                            const rowConfig = defaultPercentagesMap[matchedRowKey];
                            const choiceRows = container.querySelectorAll('.choice-row');
                            choiceRows.forEach(row => {
                                const choiceVal = row.dataset.choiceValue;
                                const matchedChoiceKey = Object.keys(rowConfig).find(k => fuzzyMatch(k, choiceVal));
                                if (matchedChoiceKey !== undefined) {
                                    row.querySelector('.choice-percent-input').value = rowConfig[matchedChoiceKey];
                                } else {
                                    row.querySelector('.choice-percent-input').value = 0;
                                }
                            });
                        } else {
                            const inputs = container.querySelectorAll('.choice-percent-input');
                            if (type === 'CheckboxGrid') {
                                inputs.forEach(input => input.value = 50);
                            } else {
                                let base = Math.floor(100 / inputs.length);
                                let remainder = 100 % inputs.length;
                                inputs.forEach((input, index) => {
                                    input.value = base + (index < remainder ? 1 : 0);
                                });
                            }
                        }
                    });
                }
            } else {
                if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                    const inputs = qItem.querySelectorAll('.choice-percent-input');
                    if (inputs.length > 0) {
                        if (type === 'Checkboxes') {
                            inputs.forEach(input => input.value = 50);
                        } else {
                            let base = Math.floor(100 / inputs.length);
                            let remainder = 100 % inputs.length;
                            inputs.forEach((input, index) => {
                                input.value = base + (index < remainder ? 1 : 0);
                            });
                        }
                    }
                } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                    const rows = qItem.querySelectorAll('.grid-row-container');
                    rows.forEach(row => {
                        const inputs = row.querySelectorAll('.choice-percent-input');
                        if (inputs.length > 0) {
                            if (type === 'CheckboxGrid') {
                                inputs.forEach(input => input.value = 50);
                            } else {
                                let base = Math.floor(100 / inputs.length);
                                let remainder = 100 % inputs.length;
                                inputs.forEach((input, index) => {
                                    input.value = base + (index < remainder ? 1 : 0);
                                });
                            }
                        }
                    });
                }
            }
        });
        
        updateAllSums();
        if (matchedCount > 0) {
            addLog("system", `⚡ Đã tự động điền tỷ lệ % mặc định khớp với ${matchedCount} câu hỏi của bạn.`);
        } else {
            addLog("system", "⚡ Đã phân phối đều tỷ lệ % các lựa chọn đáp án.");
        }
    }

    // 6. START CAMPAIGN HANDLER
    if (btnStart) {
        btnStart.addEventListener('click', async () => {
            if (!parsedForm) return;

            // Validation checks
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
                        invalidQuestionNames.push(qTitle);
                    }
                } else if (type === 'RadioGrid') {
                    const rows = qItem.querySelectorAll('.grid-row-container');
                    rows.forEach(row => {
                        const sumDisplay = row.querySelector('.total-percent-display');
                        const rowTitle = row.querySelector('.grid-row-title').textContent.trim();
                        if (sumDisplay && sumDisplay.classList.contains('sum-invalid')) {
                            validationFailed = true;
                            invalidQuestionNames.push(`${qTitle} [${rowTitle}]`);
                        }
                    });
                }
            });

            if (validationFailed) {
                alert(`⚠️ Không thể chạy chiến dịch!\n\nCác câu hỏi sau chưa đạt đủ 100%:\n- ${invalidQuestionNames.join('\n- ')}`);
                return;
            }

            // Gather configurations
            const submissions = parseInt(document.getElementById('campaign-submissions').value) || 10;
            const delay = parseFloat(document.getElementById('campaign-delay').value) || 1.0;
            
            // Build payload question values
            const config = {};
            qItems.forEach(qItem => {
                const id = qItem.dataset.id;
                const type = qItem.dataset.type;
                
                if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
                    const select = qItem.querySelector('.strategy-select');
                    const staticVal = qItem.querySelector('.static-value-input').value;
                    config[id] = {
                        type: type,
                        strategy: select.value,
                        static_value: staticVal
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
            
            // Call API
            try {
                const res = await fetch('/api/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: parsedForm.url,
                        fields: config,
                        count: submissions,
                        delay: delay,
                        form_data: parsedForm,
                        config: config,
                        total_submissions: submissions
                    })
                });
                
                const resData = await res.json();
                if (!res.ok) {
                    throw new Error(resData.error || "Không thể khởi động chiến dịch.");
                }
                
                addLog("system", "🏁 Đã khởi động chiến dịch điền giả lập tự động...");
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
            btnStop.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang Dừng...`;
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
            
            if (log.includes('✅')) {
                line.classList.add('success-log');
            } else if (log.includes('❌') || log.includes('Lỗi')) {
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
            btnStop.innerHTML = `<i class="fa-solid fa-square-check"></i> Đang Dừng...`;
        }
    }

    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', () => {
            logsContainer.innerHTML = '<div class="log-line system-log">Nhật ký đã được xóa.</div>';
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

    // 7. QUICK TEXT IMPORT DIALOG (MODAL HANDLERS)
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
                alert("Không thể phân tích dữ liệu % từ văn bản. Vui lòng kiểm tra định dạng.");
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
            addLog("system", `⚡ Nhập nhanh thành công! Đã tự động điền tỷ lệ % cho ${matchCount} câu hỏi.`);
            alert(`Thành công! Đã khớp và điền tự động tỷ lệ % cho ${matchCount} câu hỏi.`);
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

    // Initialize auth state at the end of DOMContentLoaded
    checkAuthState();
});
