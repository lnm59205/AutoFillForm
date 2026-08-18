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
    // DOM Elements
    const btnParse = document.getElementById('btn-parse');
    const btnParseText = document.getElementById('btn-parse-text');
    const btnParseSpinner = document.getElementById('btn-parse-spinner');
    const formUrlInput = document.getElementById('form-url');
    const parseError = document.getElementById('parse-error');
    const workspace = document.getElementById('campaign-workspace');
    
    const formTitleDisplay = document.getElementById('form-title-display');
    const formDescDisplay = document.getElementById('form-desc-display');
    const questionsContainer = document.getElementById('form-questions-container');
    
    const btnAutoFillPercent = document.getElementById('btn-auto-fill-percent');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    
    const statSuccess = document.getElementById('stat-success');
    const statFailed = document.getElementById('stat-failed');
    const statProgress = document.getElementById('stat-progress');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressPercentLabel = document.getElementById('progress-percent-label');
    const logsContainer = document.getElementById('logs-container');

    // Parse Form Link
    btnParse.addEventListener('click', async () => {
        const url = formUrlInput.value.trim();
        if (!url) {
            showError("Vui lòng nhập đường dẫn biểu mẫu.");
            return;
        }

        // UI Loading
        btnParse.disabled = true;
        btnParseText.classList.add('hidden');
        btnParseSpinner.classList.remove('hidden');
        parseError.classList.add('hidden');
        workspace.classList.add('hidden');
        
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
            
            // Render basic form details
            formTitleDisplay.textContent = data.title;
            formDescDisplay.textContent = data.description || "Không có mô tả.";
            
            // Check signin requirement
            if (data.requires_signin) {
                showError("CẢNH BÁO: Form này yêu cầu đăng nhập tài khoản Google (Giới hạn 1 câu trả lời hoặc Thu thập email). Tool có thể không điền được nếu không tắt cấu hình này.");
            }

            // Render Form Questions UI
            renderQuestions(data);
            
            // Show Workspace
            workspace.classList.remove('hidden');
            addLog("system", `Đã phân tích thành công biểu mẫu: "${data.title}"`);
            
            // Auto fill default percentages
            autoFillDefaultPercentages();
            
        } catch (err) {
            showError(err.message);
            addLog("error", `Lỗi: ${err.message}`);
        } finally {
            btnParse.disabled = false;
            btnParseText.classList.remove('hidden');
            btnParseSpinner.classList.add('hidden');
        }
    });

    // Render Questions config inside container
    function renderQuestions(formData) {
        questionsContainer.innerHTML = '';
        
        formData.pages.forEach(page => {
            const pageHeader = document.createElement('div');
            pageHeader.className = 'page-header-separator';
            pageHeader.innerHTML = `<h3 style="font-size: 13px; margin: 15px 0 10px 0; color: var(--text-muted); text-transform: uppercase;">${page.title}</h3>`;
            questionsContainer.appendChild(pageHeader);

            page.elements.forEach(elem => {
                const qDiv = document.createElement('div');
                qDiv.className = 'question-item';
                qDiv.dataset.id = elem.id;
                qDiv.dataset.type = elem.type;

                // Title
                let reqHtml = elem.required ? `<span class="question-required">*</span>` : '';
                let metaHtml = `<span class="question-meta">${elem.type}</span>`;
                
                let descHtml = elem.description ? `<p class="question-desc">${elem.description}</p>` : '';

                let innerHtml = `
                    <div class="question-header">
                        <div class="question-title">${elem.name}${reqHtml}</div>
                        ${metaHtml}
                    </div>
                    ${descHtml}
                `;

                // Render dynamic controls depending on type
                if (['Short', 'Paragraph', 'UserEmail'].includes(elem.type)) {
                    // Text generator strategy select
                    innerHtml += `
                        <div class="strategy-select-container">
                            <label style="font-size: 11px; color: var(--text-muted); display:block; margin-bottom:4px;">Bộ sinh dữ liệu ảo:</label>
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
                    // Single choice percentages
                    let choicesHtml = '';
                    elem.choices.forEach(choice => {
                        choicesHtml += createChoiceRow(choice, false);
                    });
                    
                    if (elem.has_other) {
                        choicesHtml += createChoiceRow('__other_option__', true);
                    }

                    innerHtml += `
                        <div class="choices-percent-container">
                            <label style="font-size: 11.5px; color: var(--text-main); font-weight: 500; display:block; margin-bottom:8px;">Phân phối tỷ lệ đáp án (%):</label>
                            <div class="choices-list">
                                ${choicesHtml}
                            </div>
                            <div class="choices-summary">
                                <span>Tổng cộng:</span>
                                <span class="total-percent-display sum-invalid">0%</span>
                            </div>
                        </div>
                    `;
                } else if (elem.type === 'Checkboxes') {
                    // Multi choice percentages
                    let choicesHtml = '';
                    elem.choices.forEach(choice => {
                        choicesHtml += createChoiceRow(choice, false);
                    });
                    
                    if (elem.has_other) {
                        choicesHtml += createChoiceRow('__other_option__', true);
                    }

                    innerHtml += `
                        <div class="choices-percent-container">
                            <label style="font-size: 11.5px; color: var(--text-main); font-weight: 500; display:block; margin-bottom:8px;">Tỷ lệ xuất hiện của mỗi đáp án (%):</label>
                            <div class="choices-list checkbox-choices-list">
                                ${choicesHtml}
                            </div>
                            <div class="choices-summary">
                                <span style="font-size:11px; color: var(--text-hint);">* Tỷ lệ mỗi hộp kiểm độc lập (0-100%), không cần tổng bằng 100%.</span>
                            </div>
                        </div>
                    `;
                } else if (['RadioGrid', 'CheckboxGrid'].includes(elem.type)) {
                    // Grids (Table)
                    let gridHtml = '';
                    elem.rows.forEach(row => {
                        let colsHtml = '';
                        elem.choices.forEach(col => {
                            colsHtml += createChoiceRow(col, false);
                        });
                        
                        let isRadio = elem.type === 'RadioGrid';
                        let sumLabelHtml = isRadio ? `
                            <div class="choices-summary" style="margin-top: 4px;">
                                <span>Tổng cộng:</span>
                                <span class="total-percent-display sum-invalid">0%</span>
                            </div>
                        ` : `
                            <div class="choices-summary" style="margin-top: 4px;">
                                <span style="font-size:10px; color: var(--text-hint);">* Độc lập từng ô</span>
                            </div>
                        `;

                        gridHtml += `
                            <div class="grid-row-container" data-row-name="${row}">
                                <div class="grid-row-title"><i class="fa-solid fa-chevron-right" style="font-size:9px;"></i> Hàng: ${row}</div>
                                <div class="choices-list">
                                    ${colsHtml}
                                </div>
                                ${sumLabelHtml}
                            </div>
                        `;
                    });

                    innerHtml += `
                        <div class="choices-percent-container">
                            <label style="font-size: 11.5px; color: var(--text-main); font-weight: 500; display:block; margin-bottom:8px;">Thiết lập từng hàng:</label>
                            ${gridHtml}
                        </div>
                    `;
                } else {
                    innerHtml += `
                        <p style="font-size: 12px; color: var(--text-hint);"><i class="fa-solid fa-gears"></i> Bộ sinh dữ liệu tự động cho kiểu ${elem.type}</p>
                    `;
                }

                qDiv.innerHTML = innerHtml;
                questionsContainer.appendChild(qDiv);
            }
        );
        });

        // Attach change events to all percentage inputs to update sums
        attachPercentInputEvents();
    }

    function createChoiceRow(choiceVal, isOther) {
        let labelText = isOther ? 'Đáp án khác (Điền chữ tự động)' : choiceVal;
        return `
            <div class="choice-row" data-choice-value="${choiceVal}">
                <span class="choice-label" title="${labelText}">${labelText}</span>
                <div class="choice-input-wrapper">
                    <input type="number" class="choice-percent-input" value="0" min="0" max="100" />
                    <span class="percent-sign">%</span>
                </div>
            </div>
        `;
    }

    window.handleStrategyChange = function(selectElem) {
        const staticWrapper = selectElem.nextElementSibling;
        if (selectElem.value === 'static') {
            staticWrapper.classList.remove('hidden');
        } else {
            staticWrapper.classList.add('hidden');
        }
    };

    // Calculate sum of percentages for single choice inputs
    function attachPercentInputEvents() {
        const percentInputs = document.querySelectorAll('.choice-percent-input');
        percentInputs.forEach(input => {
            input.addEventListener('input', () => {
                // Keep values within 0-100
                let val = parseInt(input.value);
                if (isNaN(val) || val < 0) input.value = 0;
                if (val > 100) input.value = 100;
                
                // Recalculate sums
                updateAllSums();
            });
        });
        updateAllSums();
    }

    function updateAllSums() {
        // 1. Regular Radio/Dropdown/Scale
        const qItems = document.querySelectorAll('.question-item');
        qItems.forEach(qItem => {
            const type = qItem.dataset.type;
            if (['Radio', 'Dropdown', 'Scale'].includes(type)) {
                const inputs = qItem.querySelectorAll('.choice-percent-input');
                let sum = 0;
                inputs.forEach(input => sum += parseInt(input.value) || 0);
                
                const sumDisplay = qItem.querySelector('.total-percent-display');
                sumDisplay.textContent = sum + '%';
                if (sum === 100) {
                    sumDisplay.className = 'total-percent-display sum-valid';
                } else {
                    sumDisplay.className = 'total-percent-display sum-invalid';
                }
            } else if (type === 'RadioGrid') {
                // RadioGrid rows sum
                const rows = qItem.querySelectorAll('.grid-row-container');
                rows.forEach(row => {
                    const inputs = row.querySelectorAll('.choice-percent-input');
                    let sum = 0;
                    inputs.forEach(input => sum += parseInt(input.value) || 0);
                    
                    const sumDisplay = row.querySelector('.total-percent-display');
                    sumDisplay.textContent = sum + '%';
                    if (sum === 100) {
                        sumDisplay.className = 'total-percent-display sum-valid';
                    } else {
                        sumDisplay.className = 'total-percent-display sum-invalid';
                    }
                });
            }
        });
    }

    // Auto equal distribution
    btnAutoFillPercent.addEventListener('click', autoFillEqualPercentages);

    function autoFillEqualPercentages() {
        if (!parsedForm) return;
        
        const qItems = document.querySelectorAll('.question-item');
        qItems.forEach(qItem => {
            const type = qItem.dataset.type;
            if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                const inputs = qItem.querySelectorAll('.choice-percent-input');
                if (inputs.length === 0) return;
                
                if (type === 'Checkboxes') {
                    // Checkboxes: default to 50% for all options
                    inputs.forEach(input => input.value = 50);
                } else {
                    // Single choice: distribute to equal 100%
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

    function autoFillDefaultPercentages() {
        if (!parsedForm) return;
        
        const qItems = document.querySelectorAll('.question-item');
        let matchedCount = 0;
        
        qItems.forEach(qItem => {
            const type = qItem.dataset.type;
            const qTitle = qItem.querySelector('.question-title').textContent.replace('*', '').trim();
            
            // Try to find if this question title has a hardcoded default percentages
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
                    
                    // If some choices were not matched, default them to 0
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
                            // Fallback to equal
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
                // Fallback to equal distribution for this question
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

    // Start Campaign
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
                const sumDisplay = qItem.querySelector('.total-percent-display');
                if (sumDisplay.classList.contains('sum-invalid')) {
                    validationFailed = true;
                    invalidQuestionNames.push(qTitle);
                }
            } else if (type === 'RadioGrid') {
                const rows = qItem.querySelectorAll('.grid-row-container');
                rows.forEach(row => {
                    const sumDisplay = row.querySelector('.total-percent-display');
                    const rowTitle = row.querySelector('.grid-row-title').textContent.trim();
                    if (sumDisplay.classList.contains('sum-invalid')) {
                        validationFailed = true;
                        invalidQuestionNames.push(`${qTitle} [${rowTitle}]`);
                    }
                });
            }
        });

        if (validationFailed) {
            alert(`CẢNH BÁO: Vui lòng sửa lại tỷ lệ % của các câu hỏi sau để tổng bằng 100%:\n\n- ${invalidQuestionNames.join('\n- ')}`);
            return;
        }

        // Build Payload Config
        const url = formUrlInput.value.trim();
        const count = parseInt(document.getElementById('submit-count').value) || 10;
        const delay = parseFloat(document.getElementById('submit-delay').value) || 1.0;
        
        const fields = {};
        
        qItems.forEach(qItem => {
            const id = qItem.dataset.id;
            const type = qItem.dataset.type;
            
            if (['Short', 'Paragraph', 'UserEmail'].includes(type)) {
                const strategy = qItem.querySelector('.strategy-select').value;
                const static_value = qItem.querySelector('.static-value-input').value;
                fields[id] = { strategy, static_value };
            } else if (['Radio', 'Dropdown', 'Scale', 'Checkboxes'].includes(type)) {
                const choices = {};
                const rows = qItem.querySelectorAll('.choice-row');
                rows.forEach(row => {
                    const choiceVal = row.dataset.choiceValue;
                    const percent = parseInt(row.querySelector('.choice-percent-input').value) || 0;
                    choices[choiceVal] = percent;
                });
                fields[id] = { choices };
            } else if (['RadioGrid', 'CheckboxGrid'].includes(type)) {
                const rowsConfig = {};
                const rowContainers = qItem.querySelectorAll('.grid-row-container');
                rowContainers.forEach(container => {
                    const rowName = container.dataset.rowName;
                    const choices = {};
                    const rows = container.querySelectorAll('.choice-row');
                    rows.forEach(row => {
                        const choiceVal = row.dataset.choiceValue;
                        const percent = parseInt(row.querySelector('.choice-percent-input').value) || 0;
                        choices[choiceVal] = percent;
                    });
                    rowsConfig[rowName] = { choices };
                });
                fields[id] = { rows: rowsConfig };
            }
        });

        // UI Transition
        btnStart.classList.add('hidden');
        btnStop.classList.remove('hidden');
        btnStop.disabled = false;
        btnStop.innerHTML = `<i class="fa-solid fa-stop"></i> Dừng Chiến Dịch`;
        
        try {
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, count, delay, fields })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            
            addLog("system", `🚀 Bắt đầu chiến dịch gửi biểu mẫu...`);
            
            // Start Polling Status
            startPolling();
        } catch (err) {
            alert("Lỗi bắt đầu: " + err.message);
            restoreRunButtons();
        }
    });

    // Stop Campaign
    btnStop.addEventListener('click', async () => {
        btnStop.disabled = true;
        btnStop.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang Dừng...`;
        await fetch('/api/stop', { method: 'POST' });
    });

    // Status Polling
    function startPolling() {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                
                // Update stats displays
                statSuccess.textContent = data.success;
                statFailed.textContent = data.failed;
                statProgress.textContent = `${data.current}/${data.total}`;
                
                // Progress Bar
                let pct = data.total > 0 ? Math.floor((data.current / data.total) * 100) : 0;
                progressBarFill.style.width = pct + '%';
                progressPercentLabel.textContent = pct + '%';
                
                // Render Logs
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
        
        // Auto scroll to bottom
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    function restoreRunButtons() {
        btnStart.classList.remove('hidden');
        btnStop.classList.add('hidden');
    }

    // Clear Logs
    btnClearLogs.addEventListener('click', () => {
        logsContainer.innerHTML = '<div class="log-line system-log">Nhật ký đã được xóa.</div>';
    });

    // Helpers
    function showError(msg) {
        parseError.textContent = msg;
        parseError.classList.remove('hidden');
    }

    function addLog(type, msg) {
        const timestamp = new Date().toTimeString().split(' ')[0];
        const line = document.createElement('div');
        line.className = `log-line ${type}-log`;
        line.textContent = `[${timestamp}] ${msg}`;
        logsContainer.appendChild(line);
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    // Modal & Quick Import Logic
    const btnImportTextTrigger = document.getElementById('btn-import-text-trigger');
    const importTextModal = document.getElementById('import-text-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelImport = document.getElementById('btn-cancel-import');
    const btnSubmitImport = document.getElementById('btn-submit-import');
    const importTextArea = document.getElementById('import-text-area');

    if (btnImportTextTrigger) {
        btnImportTextTrigger.addEventListener('click', () => {
            importTextModal.classList.remove('hidden');
            importTextArea.focus();
        });
    }

    const closeModal = () => {
        importTextModal.classList.add('hidden');
        importTextArea.value = '';
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
                alert("Không thể phân tích bất kỳ dữ liệu % nào từ văn bản đã cung cấp. Vui lòng kiểm tra định dạng.");
                return;
            }

            let matchCount = 0;
            const qItems = document.querySelectorAll('.question-item');
            
            qItems.forEach(qItem => {
                const qTitle = qItem.querySelector('.question-title').textContent.replace('*', '').trim();
                const type = qItem.dataset.type;

                // Find a matching question in parsedData
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

            // Update sums after filling
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
});

