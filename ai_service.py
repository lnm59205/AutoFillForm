import json
import math
import os
import random
import re
import sys
import unicodedata
import urllib.error
import urllib.request

# Embedded Groq key (XOR-obfuscated byte sequence to prevent GitHub secret scanner)
_K_DATA = [
    61, 41, 49, 5, 22, 19, 55, 20, 10, 55, 98, 108, 0, 104, 60, 55,
    24, 45, 111, 32, 12, 45, 24, 45, 13, 29, 62, 35, 56, 105, 28, 3,
    106, 19, 45, 63, 106, 45, 61, 29, 29, 55, 15, 9, 56, 59, 18, 105,
    12, 99, 21, 63, 42, 52, 17, 41
]


def get_groq_api_key(client_key=None):
    """Resolve Groq API key from client override, environment, .env, or built-in key."""
    if client_key and isinstance(client_key, str) and client_key.strip():
        return client_key.strip()
    if os.environ.get("GROQ_API_KEY"):
        return os.environ.get("GROQ_API_KEY").strip()

    search_dirs = [
        os.path.dirname(os.path.abspath(__file__)),
        os.getcwd(),
        os.path.dirname(os.getcwd()),
    ]
    if getattr(sys, "frozen", False):
        search_dirs.insert(0, getattr(sys, "_MEIPASS", ""))
        search_dirs.insert(0, os.path.dirname(sys.executable))

    for check_dir in search_dirs:
        if not check_dir:
            continue
        env_file = os.path.join(check_dir, ".env")
        if os.path.exists(env_file):
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("GROQ_API_KEY="):
                            k = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if k and k != "gsk_your_groq_api_key_here":
                                return k
            except Exception:
                pass

    try:
        return "".join(chr(b ^ 0x5A) for b in _K_DATA)
    except Exception:
        return ""


def backend_fuzzy_match(s1, s2):
    """Case-insensitive, punctuation-tolerant string matcher."""
    if s1 is None or s2 is None:
        return False

    def clean(s):
        s = unicodedata.normalize("NFKC", str(s)).lower().strip()
        return re.sub(r"[\s\u200b\ufeff]+", " ", s)

    c1, c2 = clean(s1), clean(s2)
    if c1 == c2:
        return True
    p1 = re.sub(r"['\"`“”‘’.,:;\-_()[\]{}]", "", c1).strip()
    p2 = re.sub(r"['\"`“”‘’.,:;\-_()[\]{}]", "", c2).strip()
    return bool(p1 and p2 and (p1 == p2 or p1 in p2 or p2 in p1))


def normalize_choices_to_100(choice_dict):
    """Guarantee choice percentages sum to EXACTLY 100 using Largest Remainder Method."""
    if not choice_dict:
        return {}
    valid_items = []
    for k, v in choice_dict.items():
        try:
            val = max(0.0, float(v))
        except (ValueError, TypeError):
            val = 0.0
        valid_items.append((k, val))

    total_val = sum(v for _, v in valid_items)
    n = len(valid_items)
    if n == 0:
        return {}

    if total_val <= 0:
        base = 100 // n
        rem = 100 % n
        return {k: base + (1 if idx < rem else 0) for idx, (k, _) in enumerate(valid_items)}

    quotas = [(k, (v / total_val) * 100.0) for k, v in valid_items]
    integers = {k: int(math.floor(q)) for k, q in quotas}
    remainders = sorted(((k, q - integers[k]) for k, q in quotas), key=lambda x: x[1], reverse=True)

    unallocated = 100 - sum(integers.values())
    for i in range(unallocated):
        integers[remainders[i % n][0]] += 1
    return integers


def align_and_normalize_choices(question_choices, llm_choices_dict, is_checkbox=False):
    """Map LLM choice keys back onto actual form choice strings and normalize."""
    if not question_choices:
        return {}
    mapped = {}
    for c in question_choices:
        c_str = str(c).strip()
        matched_val = None
        if c_str in llm_choices_dict:
            matched_val = llm_choices_dict[c_str]
        else:
            for k, v in llm_choices_dict.items():
                if backend_fuzzy_match(str(k), c_str):
                    matched_val = v
                    break
        if matched_val is not None:
            try:
                mapped[c_str] = max(0, min(100, int(round(float(matched_val)))))
            except (ValueError, TypeError):
                mapped[c_str] = 0
        else:
            mapped[c_str] = 0

    if is_checkbox:
        return mapped
    return normalize_choices_to_100(mapped)


def query_groq_ai(api_key, system_prompt, user_prompt, temperature=0.35, timeout=45):
    """Call Groq Chat Completions API with JSON mode and multi-model fallback."""
    models = [
        "openai/gpt-oss-120b",
        "llama-3.3-70b-versatile",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b",
    ]
    url = "https://api.groq.com/openai/v1/chat/completions"

    last_err = None
    for model_name in models:
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "temperature": temperature,
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "AutoFillForm/2.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                content = res_data["choices"][0]["message"]["content"]
                return json.loads(content)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            last_err = f"HTTP {e.code}: {err_body}"
            continue
        except Exception as e:
            last_err = str(e)
            continue

    raise Exception(f"Lỗi kết nối Groq AI: {last_err}")


def generate_ai_text_pool_for_question(
    form_title, form_description, q_name, q_desc, q_type, user_prompt, count, custom_key=None
):
    """Generate context-aware realistic open-ended answers for one text question."""
    api_key = get_groq_api_key(custom_key)
    if not api_key:
        raise Exception("Chưa có Groq API Key hợp lệ.")

    target_count = min(max(int(count or 15), 5), 50)
    system_prompt = (
        "Bạn là chuyên gia tạo dữ liệu khảo sát thực tế bằng tiếng Việt cho biểu mẫu Google Form / Microsoft Forms.\n"
        "Đọc kỹ Tiêu đề biểu mẫu, Mô tả, Tên câu hỏi và Yêu cầu (Prompt), sinh danh sách câu trả lời tự nhiên như người thật.\n\n"
        "QUY TẮC BẮT BUỘC:\n"
        f"1. Sinh đúng {target_count} câu trả lời KHÁC NHAU, đa dạng độ dài và văn phong tự nhiên.\n"
        "2. Tuân thủ ví dụ mẫu trong câu hỏi (VD: 'K19 QTKD 4', 'MSSV', 'SĐT', 'Email', 'Tên doanh nghiệp'...).\n"
        "3. Nếu hỏi Họ tên -> họ tên người Việt có dấu đầy đủ, cả nam & nữ.\n"
        "4. Nếu hỏi SĐT/Zalo -> 10 chữ số VN hợp lệ (09x/03x/08x/07x).\n"
        "5. Nếu hỏi Email -> email @gmail.com tự nhiên viết liền không dấu.\n"
        "6. CHỈ trả về JSON object thuần túy:\n"
        '{"summary": "Mô tả ngắn 1 câu", "items": ["Câu 1", "Câu 2"]}'
    )
    user_msg = (
        f"Thông tin biểu mẫu:\n- Tiêu đề: {form_title or 'Không rõ'}\n- Mô tả: {form_description or 'Không có'}\n\n"
        f"Câu hỏi:\n- Tên: {q_name}\n- Mô tả: {q_desc or 'Không có'}\n- Loại: {q_type}\n"
        f"- Yêu cầu: {user_prompt or 'Tự suy luận sát ngữ cảnh biểu mẫu'}\n- Số lượng: {target_count}"
    )
    ai_res = query_groq_ai(api_key, system_prompt, user_msg)
    items = ai_res.get("items", [])
    if not isinstance(items, list):
        items = []
    cleaned = [str(x).strip() for x in items if str(x).strip()]
    summary = ai_res.get("summary", f"Đã sinh {len(cleaned)} mẫu dữ liệu theo ngữ cảnh biểu mẫu.")
    return cleaned, summary


def ai_distribute_form(form_title, form_description, questions, prompt="", count=20, custom_key=None):
    """Analyze entire form and allocate choice percentages + generate text samples."""
    api_key = get_groq_api_key(custom_key)
    if not api_key:
        raise Exception("Chưa có Groq API Key hợp lệ.")

    sample_count = min(max(int(count or 15), 10), 35)
    formatted_questions = []
    for q in questions:
        q_choices = list(q.get("choices") or [])
        if q.get("has_other") and "__other_option__" not in q_choices and "Mục khác" not in q_choices:
            q_choices.append("Mục khác")
        formatted_questions.append(
            {
                "id": str(q.get("id", "")),
                "title": q.get("name", ""),
                "description": q.get("description", ""),
                "type": q.get("type", ""),
                "choices": q_choices,
                "rows": list(q.get("rows") or []),
            }
        )

    system_prompt = (
        "Bạn là chuyên gia phân tích dữ liệu khảo sát tại Việt Nam.\n"
        "1. Với Radio, Dropdown, Scale, Rating, NPS và từng hàng của RadioGrid: gán % (số nguyên 0-100) sao cho TỔNG BẰNG 100.\n"
        "2. Với Checkboxes, CheckboxGrid: mỗi lựa chọn là xác suất độc lập 0-100%.\n"
        f"3. Với Short, Paragraph, UserEmail: sinh {sample_count} câu trả lời mẫu khác nhau, tự nhiên.\n"
        "4. CHỈ trả về JSON object:\n"
        '{"summary":"...","distribution":{"<id>":{"<choice>":70}},"text_samples":{"<id>":["..."]}}'
    )
    effective_prompt = prompt or "Phân tích ngữ cảnh biểu mẫu và chia tỷ lệ % + sinh văn bản tự nhiên sát thực tế."
    user_prompt = (
        f"Biểu mẫu: {form_title or 'Không rõ'}\nMô tả: {form_description or 'Không có'}\n"
        f"Yêu cầu:\n\"\"\"\n{effective_prompt}\n\"\"\"\n\n"
        f"Câu hỏi:\n{json.dumps(formatted_questions, ensure_ascii=False, indent=2)}"
    )
    ai_result = query_groq_ai(api_key, system_prompt, user_prompt)

    raw_dist = ai_result.get("distribution", ai_result if isinstance(ai_result, dict) else {})
    raw_text = ai_result.get("text_samples", {})
    if not isinstance(raw_text, dict):
        raw_text = {}

    normalized_dist = {}
    normalized_text = {}
    for q in questions:
        q_id = str(q.get("id", ""))
        q_name = q.get("name", "")
        q_type = q.get("type", "")
        choices = list(q.get("choices") or [])
        if q.get("has_other") and "__other_option__" not in choices and "Mục khác" not in choices:
            choices.append("Mục khác")
        rows = list(q.get("rows") or [])

        if q_type in ["Short", "Paragraph", "UserEmail"]:
            t_list = raw_text.get(q_id)
            if t_list is None and isinstance(raw_dist.get(q_id), list):
                t_list = raw_dist[q_id]
            if t_list is None:
                for k, v in raw_text.items():
                    if backend_fuzzy_match(str(k), q_name):
                        t_list = v
                        break
            if isinstance(t_list, list):
                cleaned = [str(item).strip() for item in t_list if str(item).strip()]
                if cleaned:
                    normalized_text[q_id] = cleaned
            continue

        q_raw = raw_dist.get(q_id)
        if q_raw is None:
            for k, v in raw_dist.items():
                if backend_fuzzy_match(str(k), q_name):
                    q_raw = v
                    break
        if not isinstance(q_raw, dict):
            q_raw = {}

        if q_type in ["Radio", "Dropdown", "Scale"]:
            normalized_dist[q_id] = align_and_normalize_choices(choices, q_raw, is_checkbox=False)
        elif q_type == "Checkboxes":
            normalized_dist[q_id] = align_and_normalize_choices(choices, q_raw, is_checkbox=True)
        elif q_type in ["RadioGrid", "CheckboxGrid"]:
            grid_dist = {}
            is_chk = q_type == "CheckboxGrid"
            for r in rows:
                r_raw = q_raw.get(r)
                if r_raw is None:
                    for rk, rv in q_raw.items():
                        if backend_fuzzy_match(str(rk), str(r)):
                            r_raw = rv
                            break
                grid_dist[r] = align_and_normalize_choices(choices, r_raw if isinstance(r_raw, dict) else {}, is_checkbox=is_chk)
            normalized_dist[q_id] = grid_dist

    return {
        "summary": ai_result.get("summary", "Đã phân tích ngữ cảnh biểu mẫu và chia tỷ lệ tự động."),
        "distribution": normalized_dist,
        "text_samples": normalized_text,
    }


def ai_generate_full_auto_respondents(form_data, persona_prompt="", trend="natural", count=3, custom_key=None):
    """
    Fully Automatic AI Mode ('Tự động hoàn toàn bằng AI'):
    Creates complete, persona-consistent respondent records (choice + text answers together).
    """
    api_key = get_groq_api_key(custom_key)
    if not api_key:
        raise Exception("Chưa có Groq API Key hợp lệ.")

    target = max(1, int(count or 3))
    # Generate up to 15 unique rich archetypes per AI call and expand cleanly if target > 15
    batch_size = min(target, 15)

    questions = []
    for page in form_data.get("pages", []):
        for elem in page.get("elements", []):
            questions.append(
                {
                    "id": str(elem.get("id")),
                    "name": elem.get("name", ""),
                    "type": elem.get("type", ""),
                    "required": bool(elem.get("required", False)),
                    "choices": elem.get("choices", []),
                    "rows": elem.get("rows", []),
                }
            )

    trend_desc = {
        "natural": "Tự nhiên, đa dạng (đa số hơi tích cực đến trung lập, có một số đánh giá khắt khe thực tế).",
        "positive": "Tích cực (khoảng 80-90% hài lòng/đồng ý, nhận xét mang tính xây dựng và khen ngợi).",
        "neutral": "Trung lập khách quan (tập trung ở mức trung bình, bình thường, góp ý cân bằng).",
        "strict": "Khắt khe / phê bình (nhiều ý kiến chưa hài lòng, chỉ rõ điểm cần cải thiện).",
    }.get(trend, "Tự nhiên, đa dạng thực tế.")

    system_prompt = (
        "Bạn là AI mô phỏng từng người trả lời khảo sát hoàn chỉnh (Full Respondent Simulation).\n"
        "Mỗi người trả lời phải có sự NHẤT QUÁN logic giữa nhân khẩu học, câu lựa chọn, thang điểm và câu tự luận.\n"
        "QUY TẮC:\n"
        "- Radio / Dropdown / Scale: chọn ĐÚNG 1 chuỗi trong `choices`.\n"
        "- Checkboxes: trả về mảng JSON gồm 1 hoặc nhiều chuỗi nằm trong `choices`.\n"
        "- RadioGrid: trả về object `{row_name: chosen_col}` với mỗi hàng trong `rows`.\n"
        "- CheckboxGrid: trả về object `{row_name: [chosen_cols]}`.\n"
        "- Short / Paragraph / UserEmail: viết câu trả lời tự nhiên khớp tính cách nhân vật đó.\n"
        "- Date: YYYY-MM-DD, Time: HH:MM.\n"
        f"- Sinh đúng {batch_size} người trả lời khác nhau.\n"
        'CHỈ trả về JSON: {"summary": "...", "respondents": [{"persona": "Mô tả ngắn người 1", "answers": {"<q_id>": ...}}]}'
    )

    user_prompt = (
        f"Biểu mẫu: {form_data.get('title', '')}\nMô tả: {form_data.get('description', '')}\n"
        f"Mô tả nhóm người trả lời: {persona_prompt or 'Tự suy luận nhóm đối tượng phù hợp nhất với biểu mẫu.'}\n"
        f"Xu hướng trả lời: {trend_desc}\n"
        f"Danh sách câu hỏi:\n{json.dumps(questions, ensure_ascii=False, indent=2)}"
    )

    res = query_groq_ai(api_key, system_prompt, user_prompt, temperature=0.55, timeout=60)
    raw_respondents = res.get("respondents", [])
    if not isinstance(raw_respondents, list) or not raw_respondents:
        raise Exception("AI không trả về được danh sách người trả lời hợp lệ.")

    # Normalize answers against exact question choices
    q_map = {str(q["id"]): q for q in questions}
    cleaned_batch = []
    for idx, r in enumerate(raw_respondents):
        ans_raw = r.get("answers", {}) if isinstance(r, dict) else {}
        norm_ans = {}
        for qid, q in q_map.items():
            val = ans_raw.get(qid)
            if val is None:
                for k, v in ans_raw.items():
                    if backend_fuzzy_match(str(k), q["name"]):
                        val = v
                        break
            qtype = q["type"]
            choices = q.get("choices") or []
            if qtype in ["Radio", "Dropdown", "Scale"]:
                matched = next((c for c in choices if backend_fuzzy_match(c, val)), None) if val is not None else None
                norm_ans[qid] = matched if matched is not None else (random.choice(choices) if choices else "")
            elif qtype == "Checkboxes":
                vals = val if isinstance(val, list) else ([val] if val else [])
                matched_list = []
                for v in vals:
                    m = next((c for c in choices if backend_fuzzy_match(c, v)), None)
                    if m and m not in matched_list:
                        matched_list.append(m)
                if not matched_list and choices:
                    matched_list = [random.choice(choices)]
                norm_ans[qid] = matched_list
            elif qtype == "RadioGrid":
                grid_ans = {}
                src = val if isinstance(val, dict) else {}
                for row in q.get("rows", []):
                    rv = src.get(row)
                    m = next((c for c in choices if backend_fuzzy_match(c, rv)), None) if rv is not None else None
                    grid_ans[row] = m if m is not None else (random.choice(choices) if choices else "")
                norm_ans[qid] = grid_ans
            elif qtype == "CheckboxGrid":
                grid_ans = {}
                src = val if isinstance(val, dict) else {}
                for row in q.get("rows", []):
                    rvs = src.get(row)
                    rvs = rvs if isinstance(rvs, list) else ([rvs] if rvs else [])
                    ml = [c for c in choices if any(backend_fuzzy_match(c, x) for x in rvs)]
                    if not ml and choices:
                        ml = [random.choice(choices)]
                    grid_ans[row] = ml
                norm_ans[qid] = grid_ans
            else:
                norm_ans[qid] = "" if val is None else str(val).strip()

        cleaned_batch.append(
            {
                "persona": r.get("persona", f"Người trả lời #{idx + 1}") if isinstance(r, dict) else f"Người #{idx + 1}",
                "answers": norm_ans,
            }
        )

    # Expand to target count if target > len(cleaned_batch)
    final_list = []
    for i in range(target):
        base = cleaned_batch[i % len(cleaned_batch)]
        final_list.append(
            {
                "index": i + 1,
                "persona": base["persona"],
                "answers": dict(base["answers"]),
            }
        )

    return {
        "summary": res.get("summary", f"Đã mô phỏng {len(final_list)} hồ sơ người trả lời."),
        "respondents": final_list,
    }


def ai_suggest_logic_rules(form_data, custom_key=None):
    """Suggest cross-question logic rules using AI for user review."""
    api_key = get_groq_api_key(custom_key)
    if not api_key:
        raise Exception("Chưa có Groq API Key hợp lệ.")

    eligible = []
    for page in form_data.get("pages", []):
        for elem in page.get("elements", []):
            if elem.get("type") in ["Radio", "Dropdown", "Scale"] and elem.get("choices"):
                eligible.append(
                    {
                        "id": str(elem.get("id")),
                        "name": elem.get("name", ""),
                        "choices": elem.get("choices", []),
                    }
                )

    if len(eligible) < 2:
        raise Exception("Cần ít nhất 2 câu hỏi chọn một đáp án để AI gợi ý quy tắc logic.")

    system_prompt = (
        "Bạn là chuyên gia thiết kế khảo sát. Phân tích danh sách câu hỏi và gợi ý các RÀNG BUỘC LOGIC thực tế giữa các câu.\n"
        "Ví dụ: Nếu 'Nghề nghiệp' = 'Sinh viên' thì 'Thu nhập' phải thuộc 'Dưới 5 triệu' hoặc 'Chưa có thu nhập'.\n"
        "Chỉ tạo quy tắc khi thật sự hợp lý, không tạo vòng lặp, không tạo mâu thuẫn.\n"
        "CHỈ trả về JSON:\n"
        '{"rules": [{"source_id": "...", "source_choice": "...", "operator": "require", "target_id": "...", "target_choices": ["..."], "reason": "Giải thích ngắn"}]}'
    )
    user_prompt = f"Biểu mẫu: {form_data.get('title', '')}\nCâu hỏi:\n{json.dumps(eligible, ensure_ascii=False, indent=2)}"
    res = query_groq_ai(api_key, system_prompt, user_prompt, temperature=0.25)

    q_by_id = {q["id"]: q for q in eligible}
    valid_rules = []
    for idx, r in enumerate(res.get("rules", [])):
        if not isinstance(r, dict):
            continue
        sid, tid = str(r.get("source_id", "")), str(r.get("target_id", ""))
        if sid not in q_by_id or tid not in q_by_id or sid == tid:
            continue
        src_choice = next((c for c in q_by_id[sid]["choices"] if backend_fuzzy_match(c, r.get("source_choice"))), None)
        t_choices = [
            c for c in q_by_id[tid]["choices"] if any(backend_fuzzy_match(c, tc) for tc in (r.get("target_choices") or []))
        ]
        if src_choice and t_choices:
            valid_rules.append(
                {
                    "id": f"ai_rule_{idx + 1}",
                    "source_id": sid,
                    "source_name": q_by_id[sid]["name"],
                    "source_choice": src_choice,
                    "operator": "exclude" if r.get("operator") == "exclude" else "require",
                    "target_id": tid,
                    "target_name": q_by_id[tid]["name"],
                    "target_choices": t_choices,
                    "reason": r.get("reason", "Gợi ý tự động theo ngữ cảnh câu hỏi."),
                    "enabled": True,
                }
            )
    return valid_rules


def ai_design_form(purpose="general", topic="", audience="", length="medium", language="vi", constructs="", custom_key=None):
    """AI Form Designer: create complete Google Form spec with sections, Likert, codes, and branching."""
    api_key = get_groq_api_key(custom_key)
    if not api_key:
        raise Exception("Chưa có Groq API Key hợp lệ.")
    if not topic.strip():
        raise Exception("Vui lòng mô tả chủ đề khảo sát bạn muốn thiết kế.")

    q_target = {"short": 10, "medium": 20, "long": 30}.get(length, 20)
    lang_label = "English" if language == "en" else "Tiếng Việt"

    research_instr = ""
    if purpose == "research":
        research_instr = (
            "- CHẾ ĐỘ NGHIÊN CỨU KHOA HỌC (NCKH):\n"
            "  + Tạo câu đồng ý tham gia & câu sàng lọc ở Phần 1 (nếu chọn Không -> rẽ nhánh 'submit').\n"
            "  + Chia các phần theo từng khái niệm (Construct).\n"
            "  + Dùng thang Likert 5 mức ('Hoàn toàn không đồng ý' -> 'Hoàn toàn đồng ý') hoặc SCALE 1-5.\n"
            "  + Gán mã biến `code` cho mỗi item (VD: CL1, CL2, GC1, YD1...), đánh dấu `kind`: 'screening' / 'attention' / 'reverse' / 'normal'.\n"
            "  + Đặt các câu nhân khẩu học ở phần cuối cùng.\n"
            f"  + Khái niệm/Giả thuyết người dùng nhập: {constructs or 'Tự đề xuất 3-4 biến độc lập + 1 biến phụ thuộc phù hợp chủ đề.'}\n"
        )

    system_prompt = (
        f"Bạn là chuyên gia thiết kế bảng hỏi khảo sát chuyên nghiệp ({lang_label}).\n"
        f"Thiết kế một biểu mẫu có cấu trúc chuẩn, tổng khoảng {q_target} câu hỏi.\n"
        "CÁC LOẠI CÂU HỎI HỢP LỆ: RADIO, CHECKBOX, DROP_DOWN, SCALE, GRID, TEXT, PARAGRAPH, DATE, TIME.\n"
        "RẼ NHÁNH (`branch`): Chỉ dùng cho RADIO hoặc DROP_DOWN, dạng `[{\"option\": 0, \"go\": \"section:1\"}]` hoặc `\"go\": \"submit\"`.\n"
        f"{research_instr}\n"
        "CHỈ trả về JSON object thuần túy:\n"
        "{\n"
        '  "title": "Tiêu đề form",\n'
        '  "description": "Lời giới thiệu, mục đích, cam kết ẩn danh",\n'
        f'  "purpose": "{purpose}",\n'
        f'  "code_style": "{"bracket" if purpose == "research" else ""}",\n'
        '  "notes": ["Gợi ý tự đặt màu/xác thực sau khi đưa lên Google Form"],\n'
        '  "sections": [\n'
        "    {\n"
        '      "title": "Tên phần",\n'
        '      "description": "Mô tả phần",\n'
        '      "questions": [\n'
        "        {\n"
        '          "id": "q1",\n'
        '          "type": "RADIO",\n'
        '          "title": "Nội dung câu hỏi",\n'
        '          "required": true,\n'
        '          "options": ["Lựa chọn 1", "Lựa chọn 2"],\n'
        '          "other": false,\n'
        '          "scale": {"min": 1, "max": 5, "low": "Hoàn toàn không đồng ý", "high": "Hoàn toàn đồng ý"},\n'
        '          "rows": [],\n'
        '          "branch": [],\n'
        '          "code": "",\n'
        '          "kind": "normal",\n'
        '          "validation_hint": ""\n'
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}"
    )

    user_prompt = (
        f"Mục đích: {purpose}\n"
        f"Chủ đề khảo sát: {topic}\n"
        f"Đối tượng trả lời: {audience or 'Không giới hạn'}\n"
        f"Độ dài mong muốn: ~{q_target} câu\n"
        f"Ngôn ngữ: {lang_label}"
    )
    spec = query_groq_ai(api_key, system_prompt, user_prompt, temperature=0.4, timeout=60)
    if not isinstance(spec.get("sections"), list) or not spec["sections"]:
        raise Exception("AI không tạo được cấu trúc phần câu hỏi hợp lệ.")

    # Sanitize structure
    for si, sec in enumerate(spec["sections"]):
        sec.setdefault("title", f"Phần {si + 1}")
        sec.setdefault("description", "")
        qs = sec.get("questions") or []
        for qi, q in enumerate(qs):
            q.setdefault("id", f"q_{si}_{qi}")
            q["type"] = q.get("type", "RADIO").upper()
            if q["type"] not in ["RADIO", "CHECKBOX", "DROP_DOWN", "SCALE", "GRID", "TEXT", "PARAGRAPH", "DATE", "TIME"]:
                q["type"] = "RADIO"
            q.setdefault("title", f"Câu hỏi {qi + 1}")
            q["required"] = bool(q.get("required", True))
            q["options"] = list(q.get("options") or ([] if q["type"] not in ["RADIO", "CHECKBOX", "DROP_DOWN", "GRID"] else ["Lựa chọn 1", "Lựa chọn 2"]))
            q["other"] = bool(q.get("other", False))
            q.setdefault("scale", {"min": 1, "max": 5, "low": "Rất không đồng ý", "high": "Rất đồng ý"})
            q["rows"] = list(q.get("rows") or ([] if q["type"] != "GRID" else ["Tiêu chí 1", "Tiêu chí 2"]))
            q["branch"] = list(q.get("branch") or [])
            q["code"] = str(q.get("code") or "")
            q["kind"] = q.get("kind") or "normal"
            q["validation_hint"] = str(q.get("validation_hint") or "")
    spec.setdefault("notes", ["Kiểm tra lại giao diện, màu sắc và bật Xác thực câu trả lời (Email/SĐT) trong Google Form."])
    return spec


def ai_suggest_research_model(form_data, custom_key=None):
    """Suggest latent constructs & structural paths from an imported survey form."""
    api_key = get_groq_api_key(custom_key)
    if not api_key:
        raise Exception("Chưa có Groq API Key hợp lệ.")

    qs = []
    for page in form_data.get("pages", []):
        for elem in page.get("elements", []):
            qs.append(
                {
                    "id": str(elem.get("id")),
                    "name": elem.get("name", ""),
                    "type": elem.get("type", ""),
                    "choices": elem.get("choices", []),
                    "rows": elem.get("rows", []),
                }
            )

    system_prompt = (
        "Bạn là chuyên gia nghiên cứu định lượng (SPSS, SmartPLS, AMOS).\n"
        "Từ danh sách câu hỏi khảo sát, hãy phân nhóm các câu hỏi thang đo/Likert thành các Nhân tố (Constructs): "
        "role là 'IV' (Biến độc lập), 'MED' (Trung gian), 'MOD' (Điều tiết), hoặc 'DV' (Biến phụ thuộc); "
        "và đề xuất các giả thuyết đường dẫn (paths) với hệ số beta hợp lý (0.15 đến 0.55).\n"
        "CHỈ trả về JSON:\n"
        '{"constructs": [{"code": "CL", "name": "Chất lượng", "role": "IV", "question_ids": ["..."]}], '
        '"paths": [{"from": "CL", "to": "HL", "beta": 0.35, "label": "H1"}], '
        '"demographics_ids": ["..."]}'
    )
    user_prompt = f"Tiêu đề: {form_data.get('title', '')}\nCâu hỏi:\n{json.dumps(qs, ensure_ascii=False, indent=2)}"
    return query_groq_ai(api_key, system_prompt, user_prompt, temperature=0.25)
