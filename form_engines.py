import json
import random
import re
from datetime import date, datetime, time as dtime, timedelta
from urllib.parse import parse_qs, urlparse

import gforms
import requests
from faker import Faker
from gforms import Form

from ai_service import backend_fuzzy_match

faker = Faker("vi_VN")

# ==============================================================================
# 1. VIETNAMESE REALISTIC DATA POOLS (PRESERVING CORE STRENGTHS)
# ==============================================================================

VI_SURNAMES = [
    "nguyen", "tran", "le", "pham", "hoang", "huynh", "phan", "vu", "vo",
    "dang", "bui", "do", "ho", "ngo", "duong", "ly", "dinh", "doan", "lam",
    "trinh", "mai", "dao", "cao", "ha", "luong", "thai", "ta", "chau", "phung",
    "dieu", "quach", "ninh", "tu", "mac", "la", "nham", "luc", "trieu", "vuong",
]
VI_MIDDLE_NAMES = [
    "van", "thi", "duc", "hai", "xuan", "thu", "minh", "quang", "ngoc",
    "huu", "anh", "thanh", "phuong", "quoc", "gia", "bao", "hoang", "dinh",
    "cong", "trong", "tien", "viet", "chi", "khanh", "phuc", "huong", "tu",
    "my", "kim", "bich", "thao", "tam", "dien", "hien",
]
VI_MALE_NAMES = [
    "nam", "duc", "huy", "tuan", "long", "hung", "thang", "trung", "dung",
    "dat", "khoa", "kien", "tung", "hai", "quan", "hoang", "bach", "binh",
    "cuong", "dai", "hieu", "hiep", "loc", "nghia", "nhan", "phi", "phong",
    "sang", "son", "tai", "thuan", "tri", "trong", "truong", "uy", "viet", "vu", "vinh",
]
VI_FEMALE_NAMES = [
    "anh", "linh", "mai", "trang", "huong", "thao", "ha", "ngan", "quynh",
    "lan", "chi", "vy", "nhung", "uyen", "yen", "hang", "ngoc", "tram",
    "chau", "diem", "diep", "duyen", "giang", "hoa", "huyen", "khue", "loan",
    "ly", "nga", "oanh", "phuong", "sen", "thanh", "thuy", "tien", "tra", "truc", "van",
]
VI_EMAIL_DOMAINS = ["gmail.com"] * 9 + ["outlook.com", "yahoo.com"]

VI_SURNAMES_ACCENTED = [
    "Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ",
    "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý", "Đinh", "Đoàn", "Lâm",
    "Trịnh", "Mai", "Đào", "Cao", "Hà", "Lương", "Thái", "Tạ", "Châu", "Phùng",
]
VI_MALE_MIDDLES_ACCENTED = [
    "Văn", "Đức", "Minh", "Quang", "Hữu", "Thành", "Quốc", "Gia", "Bảo",
    "Hoàng", "Đình", "Công", "Trọng", "Tiến", "Việt", "Khánh", "Phúc", "Tuấn", "Anh",
]
VI_FEMALE_MIDDLES_ACCENTED = [
    "Thị", "Thu", "Ngọc", "Phương", "Thanh", "Khánh", "Hồng", "Mai", "Thảo",
    "Bích", "Kim", "Mỹ", "Bảo", "Thùy", "Diệu", "Quỳnh", "Nhật", "Ánh", "Lan",
]
VI_MALE_NAMES_ACCENTED = [
    "Nam", "Đức", "Huy", "Tuấn", "Long", "Hùng", "Thắng", "Trung", "Dũng",
    "Đạt", "Khoa", "Kiên", "Tùng", "Hải", "Quân", "Hoàng", "Bách", "Bình",
    "Cường", "Đại", "Hiếu", "Hiệp", "Lộc", "Nghĩa", "Nhân", "Phong",
    "Sáng", "Sơn", "Tài", "Thuận", "Trí", "Trường", "Việt", "Vũ", "Vinh",
]
VI_FEMALE_NAMES_ACCENTED = [
    "Anh", "Linh", "Mai", "Trang", "Hương", "Thảo", "Hà", "Ngân", "Quỳnh",
    "Lan", "Chi", "Vy", "Nhung", "Uyên", "Yến", "Hằng", "Ngọc", "Trâm",
    "Châu", "Diễm", "Diệp", "Duyên", "Giang", "Hoa", "Huyền", "Khuê",
    "Ly", "Nga", "Oanh", "Phương", "Thanh", "Thủy", "Tiên", "Trúc", "Vân",
]


def generate_vi_phone():
    prefixes = [
        "090", "091", "092", "093", "094", "096", "097", "098", "099",
        "086", "088", "089", "032", "033", "034", "035", "036", "037",
        "038", "039", "070", "076", "077", "078", "079", "081", "082",
        "083", "084", "085",
    ]
    return f"{random.choice(prefixes)}{''.join(random.choices('0123456789', k=7))}"


def generate_unique_email_pool(count):
    pool, used_emails = [], set()
    last_sur, last_name, is_male_turn = "", "", True
    for idx in range(count):
        chosen_email = None
        for _ in range(1000):
            sur = random.choice([s for s in VI_SURNAMES if s != last_sur])
            mid = random.choice(VI_MIDDLE_NAMES)
            name_list = VI_MALE_NAMES if is_male_turn else VI_FEMALE_NAMES
            name = random.choice([n for n in name_list if n != last_name])
            domain = random.choice(VI_EMAIL_DOMAINS)
            birth_year = random.randint(1994, 2006)
            short_year = str(birth_year)[2:]
            ddmm = f"{random.randint(1, 28):02d}{random.randint(1, 12):02d}"
            style = idx % 6
            if style == 0:
                user = f"{sur}{mid}{name}{short_year}"
            elif style == 1:
                user = f"{name}{sur}{birth_year}"
            elif style == 2:
                user = f"{sur}{name}{ddmm}"
            elif style == 3:
                user = f"{name}{mid}{sur}{short_year}"
            elif style == 4:
                user = f"{sur}{name}{random.randint(11, 999)}"
            else:
                user = f"{name}{sur[0]}{mid[0]}{short_year}"
            email = f"{user.replace('.', '').strip()}@{domain}"
            if email not in used_emails:
                used_emails.add(email)
                chosen_email = email
                last_sur, last_name = sur, name
                is_male_turn = not is_male_turn
                break
        if not chosen_email:
            chosen_email = f"user{idx}{random.randint(10000, 99999)}@gmail.com"
            used_emails.add(chosen_email)
        pool.append(chosen_email)
    return pool


def generate_real_vi_fullname():
    is_male = random.choice([True, False])
    sur = random.choice(VI_SURNAMES_ACCENTED)
    if is_male:
        return f"{sur} {random.choice(VI_MALE_MIDDLES_ACCENTED)} {random.choice(VI_MALE_NAMES_ACCENTED)}"
    return f"{sur} {random.choice(VI_FEMALE_MIDDLES_ACCENTED)} {random.choice(VI_FEMALE_NAMES_ACCENTED)}"


def generate_unique_vi_name_pool(count):
    pool, used = [], set()
    is_male_turn, last_sur, last_name = True, "", ""
    for _ in range(count):
        chosen = None
        for _ in range(500):
            sur = random.choice([s for s in VI_SURNAMES_ACCENTED if s != last_sur])
            if is_male_turn:
                mid = random.choice(VI_MALE_MIDDLES_ACCENTED)
                name = random.choice([n for n in VI_MALE_NAMES_ACCENTED if n != last_name])
            else:
                mid = random.choice(VI_FEMALE_MIDDLES_ACCENTED)
                name = random.choice([n for n in VI_FEMALE_NAMES_ACCENTED if n != last_name])
            full = f"{sur} {mid} {name}"
            if full not in used:
                used.add(full)
                chosen = full
                last_sur, last_name = sur, name
                is_male_turn = not is_male_turn
                break
        pool.append(chosen or generate_real_vi_fullname())
    return pool


def generate_unique_phone_pool(count):
    pool, used = [], set()
    for _ in range(count):
        p = generate_vi_phone()
        for _ in range(200):
            if p not in used:
                break
            p = generate_vi_phone()
        used.add(p)
        pool.append(p)
    return pool


def generate_mssv():
    return f"{random.choice(['20', '21', '22', '23', '24'])}{random.choice(['01', '02', '03', '04', '05', '07', '11'])}{random.randint(100, 9999):04d}"


def generate_unique_mssv_pool(count):
    pool, used = [], set()
    for _ in range(count):
        code = generate_mssv()
        for _ in range(200):
            if code not in used:
                break
            code = generate_mssv()
        used.add(code)
        pool.append(code)
    return pool


def generate_class_code():
    cohort = random.choice(["K17", "K18", "K19", "K20", "K21"])
    major = random.choice(
        ["QTKD", "CNTT", "Kế toán", "Marketing", "Tài chính - Ngân hàng", "Ngôn ngữ Anh", "Logistics", "Thương mại điện tử"]
    )
    return f"{cohort} {major} {random.randint(1, 5)}"


def generate_class_code_pool(count):
    return [generate_class_code() for _ in range(count)]


def generate_vi_address():
    streets = ["Nguyễn Trãi", "Cầu Giấy", "Xuân Thủy", "Giải Phóng", "Lê Văn Lương", "Tây Sơn", "Cách Mạng Tháng 8", "Nguyễn Huệ", "Lê Lợi", "Điện Biên Phủ"]
    cities = ["Hà Nội", "TP. Hồ Chí Minh", "Đà Nẵng", "Hải Phòng", "Cần Thơ"]
    return f"Số {random.randint(10, 350)} {random.choice(streets)}, {random.choice(cities)}"


def generate_vi_address_pool(count):
    return [generate_vi_address() for _ in range(count)]


def parse_custom_list_values(raw_text):
    if not raw_text or not isinstance(raw_text, str):
        return []
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    if len(lines) == 1 and ";" in lines[0]:
        lines = [item.strip() for item in lines[0].split(";") if item.strip()]
    return lines


# ==============================================================================
# 2. PLATFORM DETECTION & URL NORMALIZATION
# ==============================================================================

def detect_platform(url):
    u = (url or "").lower()
    if any(host in u for host in ["forms.office.com", "forms.cloud.microsoft", "forms.microsoft.com"]):
        return "microsoft"
    return "google"


def clean_google_form_url(url):
    if not url:
        return url
    url = url.strip()
    if "/forms/d/e/" in url:
        m = re.search(r"/forms/d/e/([^/?#\s]+)", url)
        if m:
            return f"https://docs.google.com/forms/d/e/{m.group(1)}/viewform"
    elif "/forms/d/" in url:
        m = re.search(r"/forms/d/([^/?#\s]+)", url)
        if m:
            return f"https://docs.google.com/forms/d/{m.group(1)}/viewform"
    return url


# ==============================================================================
# 3. GOOGLE FORMS PARSER (WITH BRANCHING & VALIDATION EXTRACTION) + SUBMITTER
# ==============================================================================

def _extract_fb_public_load_data(url):
    """Fetch viewform HTML and extract FB_PUBLIC_LOAD_DATA_ for section branching & validations."""
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36"},
            timeout=15,
            allow_redirects=True,
        )
        html = resp.text
        m = re.search(r"FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);\s*</script>", html, re.S)
        if not m:
            return None, resp.url
        return json.loads(m.group(1)), resp.url
    except Exception:
        return None, url


def _parse_google_branch_and_validation(fb_data):
    """
    Extract section structure, go-to-section branching, and validation rules from FB_PUBLIC_LOAD_DATA_.
    Returns: (page_nav_by_index, branching_by_elem_id, validation_by_elem_id)
    """
    page_nav = {}       # page_idx -> 'next' | 'submit' | target_page_id
    page_id_to_idx = {} # page_item_id -> page_idx
    branching = {}      # str(entry_id) -> {choice_label: target_spec}
    validations = {}    # str(entry_id) -> dict

    if not fb_data or not isinstance(fb_data, list) or len(fb_data) < 2:
        return page_nav, branching, validations

    items = fb_data[1][1] if isinstance(fb_data[1], list) and len(fb_data[1]) > 1 and isinstance(fb_data[1][1], list) else []

    # First pass: collect page indices (type 8 is section header)
    current_page_idx = 0
    page_id_to_idx["__start__"] = 0
    for item in items:
        if not isinstance(item, list) or len(item) < 4:
            continue
        item_id = item[0]
        item_type = item[3]
        if item_type == 8:
            current_page_idx += 1
            page_id_to_idx[str(item_id)] = current_page_idx
            # item[5] or item[4] can carry section-end jump target
            raw_nav = item[5] if len(item) > 5 else None
            if raw_nav is not None:
                if raw_nav == -1:
                    page_nav[current_page_idx - 1] = "submit"
                elif isinstance(raw_nav, (int, str)) and str(raw_nav) in page_id_to_idx:
                    page_nav[current_page_idx - 1] = f"page_id:{raw_nav}"

    # Second pass: resolve page_id targets and inspect questions
    for k, v in list(page_nav.items()):
        if isinstance(v, str) and v.startswith("page_id:"):
            pid = v.split(":", 1)[1]
            if pid in page_id_to_idx:
                page_nav[k] = f"section:{page_id_to_idx[pid]}"
            else:
                page_nav[k] = "next"

    for item in items:
        if not isinstance(item, list) or len(item) < 5 or item[3] == 8:
            continue
        q_meta = item[4]
        if not isinstance(q_meta, list) or not q_meta:
            continue
        for sub in q_meta:
            if not isinstance(sub, list) or not sub:
                continue
            entry_id = str(sub[0])
            # Options & branching
            opts = sub[1] if len(sub) > 1 and isinstance(sub[1], list) else []
            q_branch = {}
            for opt in opts:
                if not isinstance(opt, list) or len(opt) < 1:
                    continue
                opt_label = str(opt[0])
                if len(opt) > 2 and opt[2] is not None:
                    dest = opt[2]
                    if dest == -1:
                        q_branch[opt_label] = "submit"
                    elif str(dest) in page_id_to_idx:
                        q_branch[opt_label] = f"section:{page_id_to_idx[str(dest)]}"
            if q_branch:
                branching[entry_id] = q_branch

            # Response validations (sub[4])
            val_rules = sub[4] if len(sub) > 4 and isinstance(sub[4], list) else []
            if val_rules:
                v_info = {}
                for vr in val_rules:
                    if isinstance(vr, list) and len(vr) >= 2:
                        v_cat = vr[0]
                        v_op = vr[1]
                        v_args = vr[2] if len(vr) > 2 and isinstance(vr[2], list) else []
                        v_info = {"category": v_cat, "op": v_op, "args": v_args}
                        if v_cat == 7 and v_args:
                            # Checkbox selection count validation
                            if v_op == 200:
                                v_info["min_select"] = int(v_args[0])
                            elif v_op == 201:
                                v_info["max_select"] = int(v_args[0])
                            elif v_op == 204:
                                v_info["exact_select"] = int(v_args[0])
                if v_info:
                    validations[entry_id] = v_info

    return page_nav, branching, validations


def parse_google_form(url):
    cleaned = clean_google_form_url(url)
    form = Form()
    form.load(cleaned)

    fb_data, final_url = _extract_fb_public_load_data(cleaned)
    page_nav, branching_map, validation_map = _parse_google_branch_and_validation(fb_data)

    serialized_pages = []
    has_branching = bool(branching_map) or any(v != "next" for v in page_nav.values())

    for page in form.pages:
        serialized_elements = []
        for elem in page.elements:
            if not isinstance(elem, gforms.elements.InputElement):
                continue

            elem_type = elem.__class__.__name__
            choices = []
            if hasattr(elem, "options") and elem.options:
                choices = [opt.value for opt in elem.options if opt.value]
            elif hasattr(elem, "cols") and elem.cols:
                choices = [opt.value for opt in elem.cols if opt.value]

            has_other = bool(hasattr(elem, "other_option") and elem.other_option is not None)
            eid = str(elem.id)

            serialized_elements.append(
                {
                    "id": eid,
                    "name": elem.name or "Câu hỏi không có tiêu đề",
                    "description": elem.description or "",
                    "type": elem_type,
                    "required": bool(elem.required),
                    "choices": choices,
                    "has_other": has_other,
                    "rows": list(elem.rows) if hasattr(elem, "rows") and elem.rows else [],
                    "branching": branching_map.get(eid, {}),
                    "validation": validation_map.get(eid, {}),
                }
            )

        if serialized_elements or len(form.pages) > 1:
            serialized_pages.append(
                {
                    "index": page.index,
                    "title": page.name or f"Trang {page.index + 1}",
                    "description": page.description or "",
                    "after_next_page": page_nav.get(page.index, "next"),
                    "elements": serialized_elements,
                }
            )

    return {
        "platform": "google",
        "url": cleaned,
        "final_url": final_url,
        "title": form.title or form.name or "Google Form",
        "description": form.description or "",
        "requires_signin": bool(form.requires_signin),
        "has_branching": has_branching,
        "pages": serialized_pages,
    }


def compute_visited_pages(form_data, answers_dict):
    """Trace which pages a respondent actually visits under section branching."""
    pages = form_data.get("pages", [])
    if not pages:
        return []
    visited = []
    idx = 0
    seen = set()
    while 0 <= idx < len(pages) and idx not in seen:
        seen.add(idx)
        visited.append(idx)
        page = pages[idx]
        jump_target = None
        for elem in page.get("elements", []):
            br = elem.get("branching") or {}
            if br:
                ans = answers_dict.get(str(elem.get("id")))
                if ans is not None and str(ans) in br:
                    jump_target = br[str(ans)]
        if jump_target == "submit":
            break
        if isinstance(jump_target, str) and jump_target.startswith("section:"):
            target_idx = int(jump_target.split(":", 1)[1])
            idx = target_idx
            continue
        after_nav = page.get("after_next_page", "next")
        if after_nav == "submit":
            break
        if isinstance(after_nav, str) and after_nav.startswith("section:"):
            idx = int(after_nav.split(":", 1)[1])
            continue
        idx += 1
    return visited


def submit_google_form_once(form_obj, form_data, answers):
    """
    Submit one Google Form response.
    Uses `gforms` directly when all pages are visited, and uses branching-aware
    `formResponse` POST with exact `pageHistory` when sections are skipped.
    """
    visited_pages = compute_visited_pages(form_data, answers)
    total_pages = len(form_data.get("pages", []))
    is_branched = bool(form_data.get("has_branching")) and len(visited_pages) < total_pages

    if not is_branched:
        form_obj.reset()

        def fill_callback(element, page_index, element_index):
            val = answers.get(str(element.id), answers.get(element.id))
            if val is None or val == "":
                return gforms.elements.Value.EMPTY
            return val

        form_obj.fill(fill_callback)
        form_obj.submit()
        return

    # Branching-aware submission: build exact entries for visited pages only
    visited_set = set(visited_pages)
    visited_elem_ids = set()
    for p_idx in visited_pages:
        if 0 <= p_idx < total_pages:
            for el in form_data["pages"][p_idx].get("elements", []):
                visited_elem_ids.add(str(el["id"]))

    form_obj.reset()

    def selective_callback(element, page_index, element_index):
        if str(element.id) not in visited_elem_ids:
            return gforms.elements.Value.EMPTY
        val = answers.get(str(element.id), answers.get(element.id))
        if val is None or val == "":
            return gforms.elements.Value.EMPTY
        return val

    # If gforms exposes payload / response URL, post directly with pageHistory
    form_url = form_data.get("url", "")
    submit_url = re.sub(r"/viewform.*$", "/formResponse", form_url)
    payload_pairs = [("fvv", "1"), ("pageHistory", ",".join(str(i) for i in visited_pages))]

    for page in form_obj.pages:
        if page.index not in visited_set:
            continue
        for elem in page.elements:
            if not isinstance(elem, gforms.elements.InputElement):
                continue
            eid = str(elem.id)
            val = answers.get(eid, answers.get(elem.id))
            if val is None or val == "":
                continue
            elem_type = elem.__class__.__name__
            if elem_type == "UserEmail":
                payload_pairs.append(("emailAddress", str(val)))
            elif elem_type == "Checkboxes":
                vals = val if isinstance(val, list) else [val]
                for v in vals:
                    payload_pairs.append((f"entry.{eid}", str(v)))
            elif elem_type in ["RadioGrid", "CheckboxGrid"]:
                if isinstance(val, list):
                    row_elems = getattr(elem, "elements", None) or []
                    row_ids = getattr(elem, "row_ids", None) or [getattr(re_el, "id", None) for re_el in row_elems]
                    for r_idx, r_val in enumerate(val):
                        if r_idx < len(row_ids) and row_ids[r_idx]:
                            r_eid = row_ids[r_idx]
                            r_items = r_val if isinstance(r_val, list) else [r_val]
                            for rv in r_items:
                                payload_pairs.append((f"entry.{r_eid}", str(rv)))
            elif elem_type == "Date" and isinstance(val, (date, datetime)):
                payload_pairs.append((f"entry.{eid}_year", str(val.year)))
                payload_pairs.append((f"entry.{eid}_month", str(val.month)))
                payload_pairs.append((f"entry.{eid}_day", str(val.day)))
            elif elem_type == "Time" and isinstance(val, dtime):
                payload_pairs.append((f"entry.{eid}_hour", f"{val.hour:02d}"))
                payload_pairs.append((f"entry.{eid}_minute", f"{val.minute:02d}"))
            else:
                payload_pairs.append((f"entry.{eid}", str(val)))

    resp = requests.post(
        submit_url,
        data=payload_pairs,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36",
            "Referer": form_url,
        },
        timeout=20,
    )
    if resp.status_code not in (200, 302):
        # Fallback to gforms standard fill/submit
        form_obj.fill(selective_callback)
        form_obj.submit()


# ==============================================================================
# 4. MICROSOFT FORMS PARSER & SUBMITTER
# ==============================================================================

def _extract_ms_server_info(html):
    """Extract embedded ServerInfo / form JSON from Microsoft Forms ResponsePage HTML."""
    for pat in [
        r"window\.ServerInfo\s*=\s*(\{.*?\});",
        r"var\s+ServerInfo\s*=\s*(\{.*?\});",
        r"\"formData\"\s*:\s*(\{.*?\})\s*,\s*\"isForm",
    ]:
        m = re.search(pat, html, re.S)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                continue
    return {}


def parse_microsoft_form(url):
    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
    }
    resp = session.get(url.strip(), headers=headers, allow_redirects=True, timeout=20)
    final_url = resp.url

    if "login.microsoftonline.com" in final_url.lower() or "login.live.com" in final_url.lower():
        raise Exception(
            "Biểu mẫu Microsoft Forms đang bật chế độ chỉ cho người trong tổ chức (yêu cầu đăng nhập Microsoft 365). "
            "Hãy vào Thu thập phản hồi → chọn 'Bất kỳ ai cũng có thể trả lời'."
        )

    parsed_u = urlparse(final_url)
    qs = parse_qs(parsed_u.query)
    form_id = (qs.get("id") or qs.get("Id") or [None])[0]
    if not form_id:
        m = re.search(r"id=([A-Za-z0-9_\-]+)", resp.text)
        form_id = m.group(1) if m else None
    if not form_id:
        raise Exception("Không tìm thấy mã biểu mẫu Microsoft Forms từ liên kết này.")

    # Fetch startup JSON
    base_host = f"{parsed_u.scheme}://{parsed_u.netloc}"
    startup_url = f"{base_host}/handlers/ResponsePageStartup.ashx?id={form_id}&mobile=false&type=forms"
    form_json = None
    try:
        s_resp = session.get(startup_url, headers=headers, timeout=20)
        if s_resp.ok:
            s_data = s_resp.json()
            form_json = s_data.get("data", {}).get("form") or s_data.get("form") or s_data
    except Exception:
        form_json = None

    if not form_json or not isinstance(form_json, dict) or not form_json.get("questions"):
        server_info = _extract_ms_server_info(resp.text)
        form_json = server_info.get("form") or server_info.get("prefetchForm") or server_info

    if not form_json or not form_json.get("questions"):
        raise Exception(
            "Không thể đọc cấu trúc câu hỏi Microsoft Forms. Hãy kiểm tra lại biểu mẫu đã mở công khai 'Bất kỳ ai cũng có thể trả lời' chưa."
        )

    tenant_id = form_json.get("tenantId") or form_json.get("ownerTenantId") or ""
    owner_id = form_json.get("ownerId") or ""
    title = form_json.get("title") or "Microsoft Form"
    description = form_json.get("description") or ""

    raw_questions = sorted(form_json.get("questions", []), key=lambda q: q.get("order", 0))
    elements = []
    # Group Likert sub-questions if present
    likert_rows_by_parent = {}
    for rq in raw_questions:
        qi = rq.get("questionInfo")
        if isinstance(qi, str):
            try:
                qi = json.loads(qi)
            except Exception:
                qi = {}
        elif not isinstance(qi, dict):
            qi = {}
        parent_id = rq.get("groupId") or qi.get("GroupId")
        if rq.get("type") == "Question.MatrixChoice" and parent_id:
            likert_rows_by_parent.setdefault(parent_id, []).append(rq)

    for rq in raw_questions:
        qtype_raw = rq.get("type", "")
        qid = str(rq.get("id"))
        if qtype_raw == "Question.MatrixChoice" and rq.get("groupId"):
            # Individual Likert row handled inside parent group
            continue

        qi = rq.get("questionInfo")
        if isinstance(qi, str):
            try:
                qi = json.loads(qi)
            except Exception:
                qi = {}
        elif not isinstance(qi, dict):
            qi = {}

        q_title = rq.get("title") or "Câu hỏi"
        q_desc = rq.get("subtitle") or ""
        required = bool(rq.get("required", False))
        choices = []
        rows = []
        has_other = bool(qi.get("HasOtherAnswer", False))
        branching = {}

        if qtype_raw == "Question.Choice":
            allow_multi = bool(qi.get("AllowMultipleValues", False))
            choice_type = qi.get("ChoiceType", 1)
            mapped_type = "Checkboxes" if allow_multi else ("Dropdown" if choice_type == 2 else "Radio")
            for ch in qi.get("Choices") or []:
                desc_val = ch.get("Description") or ch.get("FormsProDisplayText")
                if desc_val:
                    choices.append(str(desc_val))
                    br = ch.get("BranchInfo")
                    if isinstance(br, dict) and br.get("TargetQuestionId"):
                        branching[str(desc_val)] = f"q:{br['TargetQuestionId']}"
        elif qtype_raw == "Question.TextField":
            mapped_type = "Paragraph" if qi.get("Multiline") else "Short"
        elif qtype_raw == "Question.Rating":
            mapped_type = "Scale"
            max_r = int(qi.get("Length", 5) or 5)
            choices = [str(i) for i in range(1, max_r + 1)]
        elif qtype_raw == "Question.NPS":
            mapped_type = "Scale"
            choices = [str(i) for i in range(0, 11)]
        elif qtype_raw == "Question.DateTime":
            mapped_type = "Date"
        elif qtype_raw == "Question.Ranking":
            mapped_type = "Ranking"
            choices = [str(ch.get("Description")) for ch in (qi.get("Choices") or []) if ch.get("Description")]
        elif qtype_raw in ("Question.MatrixChoiceGroup", "Question.MatrixChoice"):
            mapped_type = "RadioGrid"
            choices = [str(ch.get("Description")) for ch in (qi.get("Columns") or qi.get("Choices") or []) if ch.get("Description")]
            sub_rows = likert_rows_by_parent.get(qid, [])
            if sub_rows:
                rows = [str(sr.get("title") or f"Hàng {idx + 1}") for idx, sr in enumerate(sub_rows)]
            else:
                rows = [str(r.get("Description") or r) for r in (qi.get("Rows") or [])]
        elif qtype_raw == "Question.FileUpload":
            continue
        else:
            mapped_type = "Short"

        elements.append(
            {
                "id": qid,
                "name": q_title,
                "description": q_desc,
                "type": mapped_type,
                "ms_type": qtype_raw,
                "ms_row_ids": [str(sr.get("id")) for sr in likert_rows_by_parent.get(qid, [])],
                "required": required,
                "choices": choices,
                "has_other": has_other,
                "rows": rows,
                "branching": branching,
                "validation": {},
            }
        )

    return {
        "platform": "microsoft",
        "url": url.strip(),
        "final_url": final_url,
        "ms_form_id": form_id,
        "ms_tenant_id": tenant_id,
        "ms_owner_id": owner_id,
        "ms_base_host": base_host,
        "title": title,
        "description": description,
        "requires_signin": False,
        "has_branching": any(el.get("branching") for el in elements),
        "pages": [
            {
                "index": 0,
                "title": title,
                "description": description,
                "after_next_page": "submit",
                "elements": elements,
            }
        ],
    }


def submit_microsoft_form_once(form_data, answers):
    """Submit a single response payload to Microsoft Forms public API."""
    base_host = form_data.get("ms_base_host") or "https://forms.office.com"
    tenant_id = form_data.get("ms_tenant_id")
    owner_id = form_data.get("ms_owner_id")
    form_id = form_data.get("ms_form_id")

    if tenant_id and owner_id:
        submit_url = f"{base_host}/formapi/api/{tenant_id}/users/{owner_id}/forms('{form_id}')/responses"
    else:
        submit_url = f"{base_host}/formapi/api/forms('{form_id}')/responses"

    formatted_answers = []
    for page in form_data.get("pages", []):
        for elem in page.get("elements", []):
            eid = str(elem["id"])
            val = answers.get(eid)
            if val is None or val == "":
                continue
            mtype = elem.get("ms_type", "")
            etype = elem.get("type", "")
            if etype == "Checkboxes":
                arr = val if isinstance(val, list) else [val]
                formatted_answers.append({"questionId": eid, "answer1": json.dumps(arr, ensure_ascii=False)})
            elif etype == "Ranking":
                choices = list(elem.get("choices") or [])
                random.shuffle(choices)
                formatted_answers.append({"questionId": eid, "answer1": ",".join(choices)})
            elif etype in ["RadioGrid", "CheckboxGrid"] and elem.get("ms_row_ids"):
                row_ids = elem["ms_row_ids"]
                vals = val if isinstance(val, list) else [val.get(r, "") for r in elem.get("rows", [])] if isinstance(val, dict) else []
                for r_idx, r_id in enumerate(row_ids):
                    if r_idx < len(vals) and vals[r_idx]:
                        formatted_answers.append({"questionId": r_id, "answer1": str(vals[r_idx])})
            elif etype == "Date" and isinstance(val, (date, datetime)):
                formatted_answers.append({"questionId": eid, "answer1": val.strftime("%Y-%m-%d")})
            elif mtype in ("Question.Rating", "Question.NPS"):
                formatted_answers.append({"questionId": eid, "answer1": str(val)})
            else:
                formatted_answers.append({"questionId": eid, "answer1": str(val)})

    now_dt = datetime.utcnow()
    start_dt = now_dt - timedelta(seconds=random.randint(35, 140))
    payload = {
        "startDate": start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "submitDate": now_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "answers": json.dumps(formatted_answers, ensure_ascii=False),
    }

    resp = requests.post(
        submit_url,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36",
            "Referer": form_data.get("final_url") or form_data.get("url") or base_host,
        },
        timeout=20,
    )
    if not resp.ok:
        raise Exception(f"Microsoft Forms trả về HTTP {resp.status_code}: {resp.text[:180]}")


# ==============================================================================
# 5. FORM SYNC DIFF ENGINE
# ==============================================================================

def sync_form_structures(old_form, new_form):
    """Compare old parsed form with freshly synced form and report added/removed/changed items."""
    def flatten(fdata):
        res = {}
        for p in fdata.get("pages", []):
            for el in p.get("elements", []):
                res[str(el["id"])] = el
        return res

    old_map = flatten(old_form or {})
    new_map = flatten(new_form or {})

    added = [el["name"] for qid, el in new_map.items() if qid not in old_map]
    removed = [el["name"] for qid, el in old_map.items() if qid not in new_map]
    modified = []
    unchanged = 0

    for qid, nel in new_map.items():
        if qid not in old_map:
            continue
        oel = old_map[qid]
        if (
            oel.get("choices") != nel.get("choices")
            or oel.get("rows") != nel.get("rows")
            or oel.get("type") != nel.get("type")
        ):
            modified.append(nel["name"])
        else:
            unchanged += 1

    return {
        "added": added,
        "removed": removed,
        "modified": modified,
        "unchanged": unchanged,
    }
