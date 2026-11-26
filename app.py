import csv
import io
import json
import os
import random
import re
import sys
import threading
import time
import webbrowser
from datetime import datetime

import openpyxl
import requests
from flask import Flask, Response, jsonify, render_template, request, send_file
from gforms import Form

from ai_service import (
    ai_design_form,
    ai_distribute_form,
    ai_generate_full_auto_respondents,
    ai_suggest_logic_rules,
    ai_suggest_research_model,
    backend_fuzzy_match,
    generate_ai_text_pool_for_question,
)
from form_engines import (
    clean_google_form_url,
    detect_platform,
    parse_google_form,
    parse_microsoft_form,
    submit_google_form_once,
    submit_microsoft_form_once,
    sync_form_structures,
)
from logic_scheduler import (
    build_schedule,
    generate_campaign_dataset,
    validate_logic_rules,
)
from research_engine import (
    analyze_research_dataset,
    export_apa_report_doc,
    export_coded_csv,
    export_labelled_csv,
    export_spss_syntax,
    export_stata_do,
    generate_research_dataset,
    parse_and_validate_research_csv,
)

if getattr(sys, "frozen", False):
    base_dir = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    app = Flask(
        __name__,
        template_folder=os.path.join(base_dir, "templates"),
        static_folder=os.path.join(base_dir, "static"),
    )
else:
    app = Flask(__name__)


@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "-1"
    return response


# ==============================================================================
# GLOBAL CAMPAIGN RUNNER STATE (WITH SPREAD SCHEDULE & SKIP WAIT)
# ==============================================================================

class RunnerState:
    def __init__(self):
        self.active = False
        self.total = 0
        self.current = 0
        self.success = 0
        self.failed = 0
        self.logs = []
        self.stop_requested = False
        self.skip_wait_event = threading.Event()
        self.next_run_at = ""
        self.estimated_end = ""
        self.mode_label = "Chuẩn"
        self.lock = threading.Lock()

    def reset(self, total, mode_label="Chuẩn", estimated_end=""):
        with self.lock:
            self.active = True
            self.total = total
            self.current = 0
            self.success = 0
            self.failed = 0
            self.logs = []
            self.stop_requested = False
            self.skip_wait_event.clear()
            self.next_run_at = ""
            self.estimated_end = estimated_end
            self.mode_label = mode_label

    def add_log(self, message):
        with self.lock:
            ts = time.strftime("%H:%M:%S")
            self.logs.append(f"[{ts}] {message}")
            if len(self.logs) > 600:
                self.logs.pop(0)

    def stop(self):
        with self.lock:
            self.stop_requested = True
            self.skip_wait_event.set()

    def skip_wait(self):
        with self.lock:
            self.skip_wait_event.set()

    def to_dict(self):
        with self.lock:
            return {
                "active": self.active,
                "total": self.total,
                "current": self.current,
                "success": self.success,
                "failed": self.failed,
                "logs": list(self.logs),
                "stop_requested": self.stop_requested,
                "next_run_at": self.next_run_at,
                "estimated_end": self.estimated_end,
                "mode_label": self.mode_label,
            }


runner_state = RunnerState()


def _format_preview_value(val):
    if val is None:
        return "(Bỏ qua theo nhánh)"
    if isinstance(val, list):
        return ", ".join(str(x) for x in val)
    if isinstance(val, dict):
        return "; ".join(f"{k}: {v}" for k, v in val.items())
    return str(val)


def campaign_worker(form_data, pre_rows, schedule_cfg):
    global runner_state
    platform = form_data.get("platform", "google")
    url = form_data.get("url", "")
    count = len(pre_rows)

    form_obj = None
    try:
        if platform == "google":
            runner_state.add_log("🔄 Đang kết nối biểu mẫu Google Forms...")
            form_obj = Form()
            form_obj.load(url)
            if form_obj.requires_signin:
                runner_state.add_log("❌ Lỗi: Biểu mẫu yêu cầu đăng nhập tài khoản Google.")
                runner_state.active = False
                return
            runner_state.add_log(f"✅ Đã kết nối Google Form: \"{form_obj.title}\"")
        else:
            runner_state.add_log(f"✅ Sẵn sàng gửi vào Microsoft Forms: \"{form_data.get('title')}\"")

        timestamps = build_schedule(count, schedule_cfg)
        if timestamps:
            runner_state.estimated_end = timestamps[-1].strftime("%d/%m/%Y %H:%M:%S")
        runner_state.add_log(f"🚀 Khởi chạy {count} lượt ({runner_state.mode_label}). Dự kiến xong: {runner_state.estimated_end or 'ngay'}")
    except Exception as e:
        runner_state.add_log(f"❌ Lỗi khởi tạo chiến dịch: {str(e)}")
        runner_state.active = False
        return

    # Flatten question titles for logging
    q_titles = {}
    for p in form_data.get("pages", []):
        for el in p.get("elements", []):
            q_titles[str(el["id"])] = el.get("name", "Câu hỏi")

    successful_runs = 0
    while successful_runs < count:
        if runner_state.stop_requested:
            runner_state.add_log("⏹️ Đã dừng chiến dịch theo yêu cầu.")
            break

        # Wait until scheduled slot (unless immediate or user clicks "Chạy ngay")
        if successful_runs < len(timestamps):
            target_dt = timestamps[successful_runs]
            wait_sec = (target_dt - datetime.now()).total_seconds()
            if wait_sec > 0.5:
                runner_state.next_run_at = target_dt.strftime("%H:%M:%S %d/%m")
                runner_state.add_log(f"⏳ Chờ lịch gửi lượt #{successful_runs + 1} lúc {runner_state.next_run_at} (Bấm 'Chạy ngay' để bỏ qua chờ)...")
                runner_state.skip_wait_event.clear()
                # Sleep in 0.5s increments or until skip/stop event
                while wait_sec > 0 and not runner_state.stop_requested and not runner_state.skip_wait_event.is_set():
                    runner_state.skip_wait_event.wait(timeout=min(1.0, wait_sec))
                    wait_sec = (target_dt - datetime.now()).total_seconds()
                if runner_state.skip_wait_event.is_set() and not runner_state.stop_requested:
                    runner_state.add_log(f"⚡ Đã kích hoạt 'Chạy ngay' cho lượt #{successful_runs + 1}.")
                runner_state.next_run_at = ""
                if runner_state.stop_requested:
                    runner_state.add_log("⏹️ Đã dừng chiến dịch theo yêu cầu.")
                    break

        runner_state.current = successful_runs + 1
        row_answers = pre_rows[successful_runs]

        try:
            if platform == "microsoft":
                submit_microsoft_form_once(form_data, row_answers)
            else:
                submit_google_form_once(form_obj, form_data, row_answers)

            successful_runs += 1
            runner_state.success = successful_runs

            sample_parts = []
            for qid, val in row_answers.items():
                if val is not None and val != "":
                    v_str = _format_preview_value(val)
                    if len(v_str) > 28:
                        v_str = v_str[:28] + "..."
                    sample_parts.append(f"{q_titles.get(qid, 'Câu')}: {v_str}")
                if len(sample_parts) >= 2:
                    break
            runner_state.add_log(f"✅ Lượt #{successful_runs}/{count} thành công — {', '.join(sample_parts)}")

        except Exception as e:
            runner_state.failed += 1
            runner_state.add_log(f"❌ Lỗi ở lượt #{successful_runs + 1} (Tự động gửi bù...): {str(e)}")
            time.sleep(1.5)

    runner_state.next_run_at = ""
    runner_state.active = False
    runner_state.add_log(f"🎉 Hoàn tất chiến dịch! Thành công: {runner_state.success}/{count} | Lỗi đã thử bù: {runner_state.failed}")


# ==============================================================================
# ROUTES: CORE & PARSING
# ==============================================================================

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/manifest.json")
def pwa_manifest():
    return app.send_static_file("manifest.json")


@app.route("/sw.js")
def pwa_sw():
    return app.send_static_file("sw.js")


@app.route("/api/parse", methods=["POST"])
def api_parse():
    data = request.json or {}
    raw_url = (data.get("url") or "").strip()
    if not raw_url:
        return jsonify({"error": "Đường dẫn biểu mẫu không được để trống."}), 400
    try:
        platform = detect_platform(raw_url)
        if platform == "microsoft":
            parsed = parse_microsoft_form(raw_url)
        else:
            parsed = parse_google_form(raw_url)
        return jsonify(parsed)
    except Exception as e:
        return jsonify({"error": f"Không thể phân tích biểu mẫu: {str(e)}"}), 500


@app.route("/api/sync", methods=["POST"])
def api_sync():
    data = request.json or {}
    old_form = data.get("old_form") or {}
    url = (data.get("url") or old_form.get("url") or "").strip()
    if not url:
        return jsonify({"error": "Thiếu đường dẫn biểu mẫu để đồng bộ."}), 400
    try:
        new_form = parse_microsoft_form(url) if detect_platform(url) == "microsoft" else parse_google_form(url)
        diff = sync_form_structures(old_form, new_form)
        return jsonify({"form": new_form, "diff": diff})
    except Exception as e:
        return jsonify({"error": f"Không thể đồng bộ biểu mẫu: {str(e)}"}), 500


# ==============================================================================
# ROUTES: AI ENDPOINTS
# ==============================================================================

@app.route("/api/ai-generate-text", methods=["POST"])
def api_ai_generate_text():
    data = request.json or {}
    q_name = (data.get("question_name") or "").strip()
    if not q_name:
        return jsonify({"error": "Thiếu tên câu hỏi cần sinh dữ liệu."}), 400
    try:
        items, summary = generate_ai_text_pool_for_question(
            data.get("form_title", ""),
            data.get("form_description", ""),
            q_name,
            data.get("question_description", ""),
            data.get("question_type", "Short"),
            data.get("prompt", ""),
            int(data.get("count", 20) or 20),
            data.get("custom_api_key", ""),
        )
        return jsonify({"success": True, "summary": summary, "items": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai-distribute", methods=["POST"])
def api_ai_distribute():
    data = request.json or {}
    questions = data.get("questions") or []
    if not questions:
        return jsonify({"error": "Không có câu hỏi nào để AI phân bổ."}), 400
    try:
        res = ai_distribute_form(
            data.get("form_title", ""),
            data.get("form_description", ""),
            questions,
            data.get("prompt", ""),
            int(data.get("count", 20) or 20),
            data.get("custom_api_key", ""),
        )
        return jsonify({"success": True, **res})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai-full-auto-preview", methods=["POST"])
def api_ai_full_auto_preview():
    data = request.json or {}
    form_data = data.get("form_data")
    if not form_data:
        return jsonify({"error": "Chưa tải biểu mẫu."}), 400
    try:
        count = min(max(int(data.get("count", 3) or 3), 1), 15)
        res = ai_generate_full_auto_respondents(
            form_data,
            data.get("persona_prompt", ""),
            data.get("trend", "natural"),
            count,
            data.get("custom_api_key", ""),
        )
        return jsonify({"success": True, **res})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# ROUTES: LOGIC RULES & PRE-RUN PREVIEW
# ==============================================================================

@app.route("/api/rules/suggest", methods=["POST"])
def api_rules_suggest():
    data = request.json or {}
    form_data = data.get("form_data")
    if not form_data:
        return jsonify({"error": "Chưa tải biểu mẫu."}), 400
    try:
        rules = ai_suggest_logic_rules(form_data, data.get("custom_api_key", ""))
        return jsonify({"success": True, "rules": rules})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/rules/validate", methods=["POST"])
def api_rules_validate():
    data = request.json or {}
    res = validate_logic_rules(data.get("form_data") or {}, data.get("rules") or [])
    return jsonify(res)


@app.route("/api/campaign/preview", methods=["POST"])
def api_campaign_preview():
    data = request.json or {}
    form_data = data.get("form_data")
    if not form_data:
        return jsonify({"error": "Chưa có dữ liệu biểu mẫu."}), 400

    count = max(1, min(5000, int(data.get("count", 10) or 10)))
    fields = data.get("fields") or {}
    dist_mode = data.get("distribution_mode", "absolute")
    rules = data.get("rules") or []
    schedule_cfg = data.get("schedule") or {}

    rule_check = validate_logic_rules(form_data, rules)
    if not rule_check["valid"]:
        return jsonify({"error": "Quy tắc logic đang có mâu thuẫn: " + " | ".join(rule_check["errors"])}), 400

    try:
        sample_n = min(count, 8)
        rows = generate_campaign_dataset(form_data, fields, sample_n, dist_mode, rules)
        timestamps = build_schedule(count, schedule_cfg)
        est_end = timestamps[-1].strftime("%d/%m/%Y %H:%M:%S") if timestamps else ""
        est_start = timestamps[0].strftime("%d/%m/%Y %H:%M:%S") if timestamps else ""

        q_headers = []
        for p in form_data.get("pages", []):
            for el in p.get("elements", []):
                q_headers.append({"id": str(el["id"]), "name": el.get("name", "Câu hỏi")})

        preview_rows = []
        for idx, row in enumerate(rows):
            formatted = {qh["id"]: _format_preview_value(row.get(qh["id"])) for qh in q_headers}
            formatted["_ts"] = timestamps[idx].strftime("%d/%m/%Y %H:%M:%S") if idx < len(timestamps) else ""
            preview_rows.append(formatted)

        return jsonify(
            {
                "success": True,
                "headers": q_headers,
                "rows": preview_rows,
                "estimated_start": est_start,
                "estimated_end": est_end,
                "warnings": rule_check.get("warnings", []),
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================================================
# ROUTES: EXCEL / CSV BATCH FILL
# ==============================================================================

@app.route("/api/excel/template", methods=["POST"])
def api_excel_template():
    data = request.json or {}
    form_data = data.get("form_data")
    if not form_data:
        return jsonify({"error": "Chưa có biểu mẫu."}), 400

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "DuLieuKhaoSat"
    ws_ex = wb.create_sheet("HuongDan_ViDu")

    headers = []
    sample_row = []
    guide_rows = [["Tên câu hỏi (Cột Excel)", "Loại câu hỏi", "Bắt buộc", "Các lựa chọn hợp lệ"]]

    for p in form_data.get("pages", []):
        for el in p.get("elements", []):
            etype = el.get("type", "")
            choices = el.get("choices") or []
            rows = el.get("rows") or []
            if etype in ("RadioGrid", "CheckboxGrid") and rows:
                for r in rows:
                    col_name = f"{el['name']} [{r}]"
                    headers.append(col_name)
                    sample_row.append(choices[0] if choices else "")
                    guide_rows.append([col_name, etype, "Có" if el.get("required") else "Không", " | ".join(choices)])
            else:
                headers.append(el["name"])
                if etype in ("Radio", "Dropdown", "Scale", "Checkboxes"):
                    sample_row.append(choices[0] if choices else "")
                elif etype == "UserEmail":
                    sample_row.append("nguyenvana2003@gmail.com")
                elif etype == "Date":
                    sample_row.append("2026-10-15")
                else:
                    sample_row.append("Câu trả lời mẫu")
                guide_rows.append([el["name"], etype, "Có" if el.get("required") else "Không", " | ".join(choices)])

    ws.append(headers)
    ws.append(sample_row)
    for gr in guide_rows:
        ws_ex.append(gr)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(
        buf,
        as_attachment=True,
        download_name="autofillform_mau.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.route("/api/excel/parse", methods=["POST"])
def api_excel_parse():
    """Parse uploaded .xlsx or .csv file, auto-match columns, and validate row-by-row."""
    form_data_raw = request.form.get("form_data")
    mapping_raw = request.form.get("mapping")
    if not form_data_raw:
        return jsonify({"error": "Thiếu cấu trúc biểu mẫu."}), 400
    form_data = json.loads(form_data_raw)
    custom_mapping = json.loads(mapping_raw) if mapping_raw else None

    file = request.files.get("file")
    if not file:
        return jsonify({"error": "Vui lòng chọn file .xlsx hoặc .csv."}), 400

    filename = (file.filename or "").lower()
    raw_rows = []
    try:
        if filename.endswith(".csv"):
            text = file.read().decode("utf-8-sig", errors="replace")
            reader = csv.reader(io.StringIO(text))
            raw_rows = [[str(c).strip() for c in r] for r in reader if any(str(c).strip() for c in r)]
        elif filename.endswith(".xlsx") or filename.endswith(".xlsm"):
            wb = openpyxl.load_workbook(file, data_only=True)
            ws = wb.active
            for r in ws.iter_rows(values_only=True):
                row_vals = ["" if c is None else str(c).strip() for c in r]
                if any(row_vals):
                    raw_rows.append(row_vals)
        else:
            return jsonify({"error": "Định dạng hỗ trợ: .xlsx hoặc .csv (file .xls cũ hãy lưu sang .xlsx hoặc .csv)."}), 400
    except Exception as e:
        return jsonify({"error": f"Không thể đọc file: {str(e)}"}), 400

    if len(raw_rows) < 2:
        return jsonify({"error": "File cần có ít nhất 1 dòng tiêu đề và 1 dòng dữ liệu."}), 400
    if len(raw_rows) - 1 > 5000:
        return jsonify({"error": "File vượt quá giới hạn 5.000 dòng."}), 400

    headers = raw_rows[0]
    data_rows = raw_rows[1:]

    # Build target fields list (expanding grids into row targets)
    targets = []
    for p in form_data.get("pages", []):
        for el in p.get("elements", []):
            eid = str(el["id"])
            etype = el.get("type", "")
            if etype in ("RadioGrid", "CheckboxGrid") and el.get("rows"):
                for r_idx, r_name in enumerate(el["rows"]):
                    targets.append(
                        {
                            "key": f"{eid}::row::{r_idx}",
                            "eid": eid,
                            "row_idx": r_idx,
                            "row_name": r_name,
                            "label": f"{el['name']} [{r_name}]",
                            "type": etype,
                            "choices": el.get("choices") or [],
                            "has_other": False,
                            "required": el.get("required", False),
                        }
                    )
            else:
                targets.append(
                    {
                        "key": eid,
                        "eid": eid,
                        "label": el["name"],
                        "type": etype,
                        "choices": el.get("choices") or [],
                        "has_other": bool(el.get("has_other")),
                        "required": el.get("required", False),
                    }
                )

    t_by_key = {t["key"]: t for t in targets}

    # Auto-suggest mapping if not provided
    if not custom_mapping:
        custom_mapping = {}
        used = set()
        for h in headers:
            matched_key = ""
            for t in targets:
                if t["key"] not in used and backend_fuzzy_match(h, t["label"]):
                    matched_key = t["key"]
                    used.add(matched_key)
                    break
            custom_mapping[h] = matched_key

    # Validate rows
    valid_records = []
    error_rows = []
    for row_num, r_vals in enumerate(data_rows, start=2):
        record = {}
        grid_acc = {}
        errs = []
        for col_idx, h in enumerate(headers):
            t_key = custom_mapping.get(h, "")
            if not t_key or t_key not in t_by_key:
                continue
            t = t_by_key[t_key]
            cell = r_vals[col_idx].strip() if col_idx < len(r_vals) else ""

            if not cell:
                if t["required"]:
                    errs.append(f"Thiếu '{t['label']}'")
                continue

            etype = t["type"]
            choices = t["choices"]
            if etype in ("Radio", "Dropdown", "Scale"):
                matched = next((c for c in choices if backend_fuzzy_match(c, cell)), None)
                if matched:
                    record[t["eid"]] = matched
                elif t["has_other"]:
                    record[t["eid"]] = cell
                else:
                    errs.append(f"'{t['label']}': '{cell}' không khớp lựa chọn")
            elif etype == "Checkboxes":
                parts = [x.strip() for x in re.split(r"[,;]", cell) if x.strip()]
                matched_list = []
                for pt in parts:
                    mc = next((c for c in choices if backend_fuzzy_match(c, pt)), None)
                    if mc:
                        matched_list.append(mc)
                    elif t["has_other"]:
                        matched_list.append(pt)
                    else:
                        errs.append(f"'{t['label']}': '{pt}' không hợp lệ")
                record[t["eid"]] = matched_list
            elif etype in ("RadioGrid", "CheckboxGrid"):
                eid = t["eid"]
                grid_acc.setdefault(eid, {})
                if etype == "RadioGrid":
                    mc = next((c for c in choices if backend_fuzzy_match(c, cell)), None)
                    if mc:
                        grid_acc[eid][t["row_idx"]] = mc
                    else:
                        errs.append(f"'{t['label']}': '{cell}' không hợp lệ")
                else:
                    parts = [x.strip() for x in re.split(r"[,;]", cell) if x.strip()]
                    ml = [c for pt in parts for c in choices if backend_fuzzy_match(c, pt)]
                    if ml:
                        grid_acc[eid][t["row_idx"]] = ml
                    else:
                        errs.append(f"'{t['label']}': '{cell}' không hợp lệ")
            else:
                record[t["eid"]] = cell

        # Merge grid rows into record list aligned to elem.rows
        for p in form_data.get("pages", []):
            for el in p.get("elements", []):
                eid = str(el["id"])
                if eid in grid_acc:
                    record[eid] = [grid_acc[eid].get(i, "") for i in range(len(el.get("rows") or []))]

        if errs:
            error_rows.append({"row": row_num, "reasons": errs})
        else:
            valid_records.append(record)

    return jsonify(
        {
            "success": True,
            "headers": headers,
            "targets": [{"key": t["key"], "label": t["label"]} for t in targets],
            "mapping": custom_mapping,
            "total_rows": len(data_rows),
            "valid_count": len(valid_records),
            "error_count": len(error_rows),
            "error_rows": error_rows[:50],
            "valid_records": valid_records,
        }
    )


# ==============================================================================
# ROUTES: CAMPAIGN START / STOP / SKIP / STATUS
# ==============================================================================

@app.route("/api/start", methods=["POST"])
def api_start():
    global runner_state
    if runner_state.active:
        return jsonify({"error": "Đang có một chiến dịch điền form đang chạy."}), 400

    data = request.json or {}
    form_data = data.get("form_data") or {}
    url = form_data.get("url") or clean_google_form_url(data.get("url"))
    if not url:
        return jsonify({"error": "Đường dẫn biểu mẫu trống."}), 400
    form_data["url"] = url

    run_mode = data.get("run_mode", "standard")  # standard | full_ai | excel | research_push
    schedule_cfg = data.get("schedule") or {"mode": "immediate", "delay_sec": float(data.get("delay", 1.0) or 1.0)}

    try:
        if run_mode == "excel":
            pre_rows = data.get("excel_rows") or []
            if not pre_rows:
                return jsonify({"error": "Không có dòng dữ liệu hợp lệ từ file Excel/CSV."}), 400
            # Fill any unmapped fields using standard generator
            fallback_rows = generate_campaign_dataset(
                form_data, data.get("fields") or {}, len(pre_rows), "absolute", data.get("rules") or []
            )
            merged = []
            for i, er in enumerate(pre_rows):
                row_obj = dict(fallback_rows[i])
                row_obj.update(er)
                merged.append(row_obj)
            pre_rows = merged
            mode_label = "Điền từ Excel/CSV"
        elif run_mode == "full_ai":
            count = max(1, min(1000, int(data.get("count", 10) or 10)))
            ai_res = ai_generate_full_auto_respondents(
                form_data,
                data.get("persona_prompt", ""),
                data.get("ai_trend", "natural"),
                count,
                data.get("custom_api_key", ""),
            )
            pre_rows = [r["answers"] for r in ai_res["respondents"]]
            mode_label = "Tự động hoàn toàn bằng AI"
        elif run_mode == "research_push":
            raw_res_rows = data.get("research_rows") or []
            if not raw_res_rows:
                return jsonify({"error": "Chưa có dữ liệu mô phỏng SPSS để gửi."}), 400
            fallback_rows = generate_campaign_dataset(
                form_data, data.get("fields") or {}, len(raw_res_rows), "absolute", data.get("rules") or []
            )
            pre_rows = []
            for i, rr in enumerate(raw_res_rows):
                row_obj = dict(fallback_rows[i])
                row_obj.update(rr)
                pre_rows.append(row_obj)
            mode_label = "Đẩy dữ liệu Nghiên cứu SPSS"
        else:
            count = max(1, min(5000, int(data.get("count", 10) or 10)))
            fields = data.get("fields") or data.get("config") or {}
            dist_mode = data.get("distribution_mode", "absolute")
            rules = data.get("rules") or []
            rule_check = validate_logic_rules(form_data, rules)
            if not rule_check["valid"]:
                return jsonify({"error": "Lỗi quy tắc logic: " + " | ".join(rule_check["errors"])}), 400
            pre_rows = generate_campaign_dataset(form_data, fields, count, dist_mode, rules)
            mode_label = "Chia Tuyệt Đối 100%" if dist_mode == "absolute" else "Phân Phối Tự Nhiên"
    except Exception as e:
        return jsonify({"error": f"Lỗi chuẩn bị dữ liệu chạy: {str(e)}"}), 400

    count = len(pre_rows)
    timestamps = build_schedule(count, schedule_cfg)
    est_end = timestamps[-1].strftime("%d/%m/%Y %H:%M:%S") if timestamps else ""
    runner_state.reset(count, mode_label=mode_label, estimated_end=est_end)

    thread = threading.Thread(target=campaign_worker, args=(form_data, pre_rows, schedule_cfg), daemon=True)
    thread.start()
    return jsonify({"status": "started", "total": count, "estimated_end": est_end})


@app.route("/api/stop", methods=["POST"])
def api_stop():
    runner_state.stop()
    return jsonify({"status": "stopping"})


@app.route("/api/skip-wait", methods=["POST"])
def api_skip_wait():
    runner_state.skip_wait()
    return jsonify({"status": "skipped"})


@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify(runner_state.to_dict())


# ==============================================================================
# ROUTES: AI FORM DESIGNER
# ==============================================================================

@app.route("/api/designer/generate", methods=["POST"])
def api_designer_generate():
    data = request.json or {}
    try:
        spec = ai_design_form(
            data.get("purpose", "general"),
            data.get("topic", ""),
            data.get("audience", ""),
            data.get("length", "medium"),
            data.get("language", "vi"),
            data.get("constructs", ""),
            data.get("custom_api_key", ""),
        )
        return jsonify({"success": True, "spec": spec})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/designer/apps-script", methods=["POST"])
def api_designer_apps_script():
    """Generate a Google Apps Script (.gs) that builds the exact designed Google Form + branching."""
    spec = (request.json or {}).get("spec")
    if not spec:
        return jsonify({"error": "Thiếu cấu trúc form."}), 400

    spec_json = json.dumps(spec, ensure_ascii=False, indent=2)
    gs_code = f"""// =========================================================================
// Google Apps Script tự động tạo Google Form từ AutoFillForm AI Designer
// Cách dùng:
// 1. Truy cập https://script.google.com -> Dự án mới (New project)
// 2. Dán toàn bộ code này vào trình soạn thảo -> Lưu (Ctrl+S)
// 3. Chọn hàm createMyGoogleForm -> Bấm Run (Chạy) -> Cấp quyền Google Forms
// 4. Mở link Edit / Viewform hiển thị trong Execution Log!
// =========================================================================

function createMyGoogleForm() {{
  var spec = {spec_json};
  var form = FormApp.create(spec.title || 'Khảo sát mới');
  form.setDescription(spec.description || '');
  if (spec.purpose === 'quiz') form.setIsQuiz(true);

  var sectionBreaks = [null];
  var sections = spec.sections || [];
  var choiceItems = [];

  sections.forEach(function(sec, si) {{
    if (si > 0) {{
      var sb = form.addPageBreakItem().setTitle(sec.title || ('Phần ' + (si + 1)));
      if (sec.description) sb.setHelpText(sec.description);
      sectionBreaks.push(sb);
    }}
    (sec.questions || []).forEach(function(q) {{
      var codePrefix = '';
      if (q.code && spec.code_style) {{
        if (spec.code_style === 'bracket') codePrefix = '[' + q.code + '] ';
        else if (spec.code_style === 'dot') codePrefix = q.code + '. ';
        else if (spec.code_style === 'dash') codePrefix = q.code + ' - ';
      }}
      var fullTitle = codePrefix + (q.title || 'Câu hỏi');
      var item = null;

      if (q.type === 'RADIO') {{
        item = form.addMultipleChoiceItem().setTitle(fullTitle);
        choiceItems.push({{ item: item, q: q }});
      }} else if (q.type === 'CHECKBOX') {{
        item = form.addCheckboxItem().setTitle(fullTitle);
        item.setChoiceValues(q.options || ['Lựa chọn 1']);
        if (q.other) item.showOtherOption(true);
      }} else if (q.type === 'DROP_DOWN') {{
        item = form.addListItem().setTitle(fullTitle);
        choiceItems.push({{ item: item, q: q }});
      }} else if (q.type === 'SCALE') {{
        var sc = q.scale || {{ min: 1, max: 5, low: '', high: '' }};
        item = form.addScaleItem().setTitle(fullTitle)
          .setBounds(sc.min === 0 ? 0 : 1, sc.max || 5)
          .setLabels(sc.low || '', sc.high || '');
      }} else if (q.type === 'GRID') {{
        item = form.addGridItem().setTitle(fullTitle)
          .setRows(q.rows || ['Hàng 1'])
          .setColumns(q.options || ['Cột 1']);
      }} else if (q.type === 'PARAGRAPH') {{
        item = form.addParagraphTextItem().setTitle(fullTitle);
      }} else if (q.type === 'DATE') {{
        item = form.addDateItem().setTitle(fullTitle);
      }} else if (q.type === 'TIME') {{
        item = form.addTimeItem().setTitle(fullTitle);
      }} else {{
        item = form.addTextItem().setTitle(fullTitle);
      }}
      if (item && q.required && typeof item.setRequired === 'function') {{
        item.setRequired(true);
      }}
    }});
  }});

  // Apply branching after all sections exist
  choiceItems.forEach(function(entry) {{
    var q = entry.q, item = entry.item;
    var branchMap = {{}};
    (q.branch || []).forEach(function(b) {{ branchMap[b.option] = b.go; }});
    var choices = (q.options || []).map(function(optLabel, oi) {{
      var go = branchMap[oi];
      if (go === 'submit') return item.createChoice(optLabel, FormApp.PageNavigationType.SUBMIT);
      if (go && go.indexOf('section:') === 0) {{
        var idx = parseInt(go.split(':')[1], 10);
        if (sectionBreaks[idx]) return item.createChoice(optLabel, sectionBreaks[idx]);
      }}
      return item.createChoice(optLabel, FormApp.PageNavigationType.CONTINUE);
    }});
    item.setChoices(choices);
    if (q.other && typeof item.showOtherOption === 'function') item.showOtherOption(true);
  }});

  Logger.log('Edit URL: ' + form.getEditUrl());
  Logger.log('Published URL: ' + form.getPublishedUrl());
}}
"""
    return jsonify({"success": True, "script": gs_code})


# ==============================================================================
# ROUTES: RESEARCH SPSS / SMARTPLS / AMOS / STATA MODULE
# ==============================================================================

@app.route("/api/research/suggest-model", methods=["POST"])
def api_research_suggest_model():
    data = request.json or {}
    form_data = data.get("form_data")
    if not form_data:
        return jsonify({"error": "Chưa có biểu mẫu để AI gợi ý mô hình."}), 400
    try:
        res = ai_suggest_research_model(form_data, data.get("custom_api_key", ""))
        return jsonify({"success": True, **res})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/research/generate", methods=["POST"])
def api_research_generate():
    model_spec = (request.json or {}).get("model") or {}
    try:
        dataset = generate_research_dataset(model_spec)
        analysis = analyze_research_dataset(dataset)
        return jsonify({"success": True, "dataset": dataset, "analysis": analysis})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/research/import-csv", methods=["POST"])
def api_research_import_csv():
    model_raw = request.form.get("model")
    if not model_raw:
        return jsonify({"error": "Thiếu cấu trúc mô hình nghiên cứu."}), 400
    model_spec = json.loads(model_raw)
    mapping_raw = request.form.get("mapping")
    mapping = json.loads(mapping_raw) if mapping_raw else None
    exclude_spec = request.form.get("exclude_rows", "")
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "Vui lòng chọn file CSV."}), 400
    try:
        csv_text = file.read().decode("utf-8-sig", errors="replace")
        res = parse_and_validate_research_csv(csv_text, model_spec, mapping, exclude_spec)
        analysis = analyze_research_dataset(res["dataset"]) if res["valid_count"] >= 10 else None
        return jsonify({"success": True, **res, "analysis": analysis})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/research/export", methods=["POST"])
def api_research_export():
    data = request.json or {}
    fmt = data.get("format", "coded_csv")
    dataset = data.get("dataset") or {}
    analysis = data.get("analysis") or {}
    try:
        if fmt == "coded_csv":
            content = export_coded_csv(dataset)
            return Response(
                content.encode("utf-8-sig"),
                mimetype="text/csv; charset=utf-8",
                headers={"Content-Disposition": "attachment; filename=spss_coded_data.csv"},
            )
        if fmt == "labelled_csv":
            content = export_labelled_csv(dataset)
            return Response(
                content.encode("utf-8-sig"),
                mimetype="text/csv; charset=utf-8",
                headers={"Content-Disposition": "attachment; filename=spss_labelled_data.csv"},
            )
        if fmt == "spss_sps":
            content = export_spss_syntax(dataset)
            return Response(
                content.encode("utf-8"),
                mimetype="text/plain; charset=utf-8",
                headers={"Content-Disposition": "attachment; filename=autofillform_spss.sps"},
            )
        if fmt == "stata_do":
            content = export_stata_do(dataset)
            return Response(
                content.encode("utf-8"),
                mimetype="text/plain; charset=utf-8",
                headers={"Content-Disposition": "attachment; filename=autofillform_stata.do"},
            )
        if fmt == "apa_doc":
            if not analysis and dataset.get("rows"):
                analysis = analyze_research_dataset(dataset)
            content = export_apa_report_doc(analysis)
            return Response(
                content.encode("utf-8"),
                mimetype="application/msword; charset=utf-8",
                headers={"Content-Disposition": "attachment; filename=bao_cao_apa_spss.doc"},
            )
        return jsonify({"error": "Định dạng xuất không hợp lệ."}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ==============================================================================
# ROUTES: GOOGLE SHEET TIMESTAMP EDITOR
# ==============================================================================

def _parse_row_selection(sel_mode, range_str, total_rows):
    if sel_mode == "all":
        return list(range(total_rows))
    chosen = set()
    for part in re.split(r"[,;\s]+", (range_str or "").strip()):
        if not part:
            continue
        m = re.match(r"^(\d+)-(\d+)$", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            for idx in range(max(1, min(a, b)), min(total_rows, max(a, b)) + 1):
                chosen.add(idx - 1)
        elif part.isdigit():
            idx = int(part) - 1
            if 0 <= idx < total_rows:
                chosen.add(idx)
    return sorted(chosen)


@app.route("/api/timestamp/load", methods=["POST"])
def api_timestamp_load():
    """Load CSV from a shared Google Sheet link or uploaded CSV/XLSX file."""
    sheet_url = (request.form.get("sheet_url") or (request.json or {}).get("sheet_url") or "").strip() if not request.files else request.form.get("sheet_url", "").strip()
    rows = []

    try:
        if request.files and request.files.get("file"):
            f = request.files["file"]
            fname = (f.filename or "").lower()
            if fname.endswith(".xlsx"):
                wb = openpyxl.load_workbook(f, data_only=True)
                ws = wb.active
                rows = [["" if c is None else str(c) for c in r] for r in ws.iter_rows(values_only=True)]
            else:
                txt = f.read().decode("utf-8-sig", errors="replace")
                rows = list(csv.reader(io.StringIO(txt)))
        elif sheet_url:
            m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", sheet_url)
            if not m:
                return jsonify({"error": "Link Google Sheet không hợp lệ."}), 400
            sid = m.group(1)
            gid_m = re.search(r"gid=(\d+)", sheet_url)
            gid = gid_m.group(1) if gid_m else "0"
            export_url = f"https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"
            resp = requests.get(export_url, timeout=15)
            if not resp.ok or "<!DOCTYPE html>" in resp.text[:200]:
                return jsonify({"error": "Không đọc được Google Sheet. Hãy chia sẻ Sheet ở chế độ 'Bất kỳ ai có liên kết đều có thể xem/chỉnh sửa'."}), 400
            rows = list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig", errors="replace"))))
        else:
            return jsonify({"error": "Vui lòng nhập link Google Sheet hoặc tải lên file CSV/XLSX."}), 400
    except Exception as e:
        return jsonify({"error": f"Lỗi đọc dữ liệu Sheet: {str(e)}"}), 400

    rows = [r for r in rows if any(str(c).strip() for c in r)]
    if len(rows) < 2:
        return jsonify({"error": "Bảng tính cần có hàng tiêu đề và ít nhất 1 dòng phản hồi."}), 400
    if len(rows) - 1 > 20000:
        return jsonify({"error": "Vượt quá giới hạn 20.000 dòng."}), 400

    headers = rows[0]
    ts_col_idx = 0
    for idx, h in enumerate(headers):
        hl = h.lower()
        if "timestamp" in hl or "dấu thời gian" in hl or "thời gian" in hl:
            ts_col_idx = idx
            break

    return jsonify(
        {
            "success": True,
            "headers": headers,
            "ts_col_idx": ts_col_idx,
            "total_rows": len(rows) - 1,
            "rows": rows[1:],
        }
    )


@app.route("/api/timestamp/preview", methods=["POST"])
def api_timestamp_preview():
    data = request.json or {}
    rows = data.get("rows") or []
    ts_col_idx = int(data.get("ts_col_idx", 0) or 0)
    sel_mode = data.get("selection_mode", "all")
    range_str = data.get("range_spec", "")
    ts_format = data.get("ts_format", "%d/%m/%Y %H:%M:%S")
    schedule_cfg = data.get("schedule") or {}

    if not rows:
        return jsonify({"error": "Chưa có dữ liệu Sheet để tạo xem trước."}), 400

    selected_indices = _parse_row_selection(sel_mode, range_str, len(rows))
    if not selected_indices:
        return jsonify({"error": "Không có dòng nào khớp với phạm vi đã chọn."}), 400

    base_dt = None
    if schedule_cfg.get("start_at"):
        try:
            base_dt = datetime.fromisoformat(str(schedule_cfg["start_at"]))
        except Exception:
            base_dt = datetime.now()

    new_dts = build_schedule(len(selected_indices), schedule_cfg, base_dt=base_dt or datetime.now())
    preview = []
    updated_map = {}
    for pos, r_idx in enumerate(selected_indices):
        new_str = new_dts[pos].strftime(ts_format)
        updated_map[r_idx] = new_str
        old_str = rows[r_idx][ts_col_idx] if ts_col_idx < len(rows[r_idx]) else ""
        sample = rows[r_idx][1] if len(rows[r_idx]) > 1 else ""
        preview.append({"row": r_idx + 1, "old_ts": old_str, "new_ts": new_str, "sample": sample})

    # Generate Google Apps Script for 1-click in-place Sheet timestamp update
    gs_updates = [[r_idx + 2, new_ts] for r_idx, new_ts in updated_map.items()]
    apps_script = (
        "// Dán vào Extensions -> Apps Script trong Google Sheet của bạn và bấm Run\n"
        "function applyNewTimestamps() {\n"
        "  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();\n"
        f"  var col = {ts_col_idx + 1};\n"
        f"  var updates = {json.dumps(gs_updates, ensure_ascii=False)};\n"
        "  updates.forEach(function(u) { sheet.getRange(u[0], col).setValue(u[1]); });\n"
        "}\n"
    )

    return jsonify(
        {
            "success": True,
            "updated_count": len(selected_indices),
            "preview": preview[:200],
            "updated_map": {str(k): v for k, v in updated_map.items()},
            "apps_script": apps_script,
        }
    )


@app.route("/api/timestamp/export", methods=["POST"])
def api_timestamp_export():
    data = request.json or {}
    headers = data.get("headers") or []
    rows = data.get("rows") or []
    ts_col_idx = int(data.get("ts_col_idx", 0) or 0)
    updated_map = data.get("updated_map") or {}
    fmt = data.get("format", "csv")

    out_rows = []
    for idx, r in enumerate(rows):
        nr = list(r)
        if str(idx) in updated_map and ts_col_idx < len(nr):
            nr[ts_col_idx] = updated_map[str(idx)]
        out_rows.append(nr)

    if fmt == "xlsx":
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(headers)
        for r in out_rows:
            ws.append(r)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return send_file(
            buf,
            as_attachment=True,
            download_name="sheet_updated_timestamps.xlsx",
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(out_rows)
    return Response(
        buf.getvalue().encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=sheet_updated_timestamps.csv"},
    )


if __name__ == "__main__":
    is_frozen = getattr(sys, "frozen", False)
    app.config["TEMPLATES_AUTO_RELOAD"] = not is_frozen
    print("--------------------------------------------------")
    print(" AutoFillForm Studio Server Running!")
    print(" Mo trinh duyet truy cap: http://127.0.0.1:5000")
    print("--------------------------------------------------")

    if is_frozen:
        def open_browser():
            time.sleep(1.2)
            webbrowser.open("http://127.0.0.1:5000")
        threading.Thread(target=open_browser, daemon=True).start()
        app.run(host="127.0.0.1", port=5000, debug=False)
    else:
        app.run(host="127.0.0.1", port=5000, debug=True)
