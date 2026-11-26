import math
import random
import re
from datetime import date, datetime, time as dtime, timedelta

from ai_service import backend_fuzzy_match, generate_ai_text_pool_for_question
from form_engines import (
    compute_visited_pages,
    faker,
    generate_class_code_pool,
    generate_mssv,
    generate_unique_email_pool,
    generate_unique_mssv_pool,
    generate_unique_phone_pool,
    generate_unique_vi_name_pool,
    generate_vi_address_pool,
    parse_custom_list_values,
)


# ==============================================================================
# 1. NATURAL SENTIMENT WEIGHTS (FOR NATURAL MODE)
# ==============================================================================

def score_choice_sentiment(choice_str, index=0, total=1):
    s = str(choice_str).lower().strip()
    if re.match(r"^(\d+)(?:[./\-]|\s*$)", s):
        if total > 1:
            return -1.0 + 2.0 * (index / (total - 1))

    neg_strong = ["rất không hài lòng", "hoàn toàn không đồng ý", "rất không đồng ý", "rất tệ", "rất kém", "không bao giờ"]
    neg_mild = ["không hài lòng", "không đồng ý", "tệ", "kém", "không thích", "ít khi", "hiếm khi", "disagree", "poor"]
    pos_strong = ["rất hài lòng", "hoàn toàn đồng ý", "rất đồng ý", "rất tốt", "tuyệt vời", "luôn luôn", "rất thường xuyên"]
    pos_mild = ["hài lòng", "đồng ý", "tốt", "thích", "thường xuyên", "hiệu quả", "agree", "good"]
    neutral = ["bình thường", "trung bình", "trung lập", "không ý kiến", "thỉnh thoảng", "neutral"]

    for pat in neg_strong:
        if pat in s:
            return -1.0
    for pat in pos_strong:
        if pat in s:
            return 1.0
    for pat in neg_mild:
        if pat in s:
            return -0.6
    for pat in pos_mild:
        if pat in s:
            return 0.6
    for pat in neutral:
        if pat in s:
            return 0.0
    if total > 1:
        return -0.5 + 1.0 * (index / (total - 1))
    return 0.0


def calculate_natural_weights(options, trend="natural_positive"):
    n = len(options)
    if n == 0:
        return {}
    if n == 1:
        return {options[0]: 100.0}
    scores = [score_choice_sentiment(opt, idx, n) for idx, opt in enumerate(options)]
    weights = []
    for s in scores:
        if trend == "natural_negative":
            weights.append(math.exp(-2.0 * s))
        elif trend == "natural_neutral":
            weights.append(math.exp(-3.2 * (s ** 2)))
        else:
            weights.append(math.exp(2.0 * s))
    total_w = sum(weights) or 1.0
    return {options[i]: (weights[i] / total_w) * 100.0 for i in range(n)}


# ==============================================================================
# 2. LOGIC RULES VALIDATION & CONFLICT/CYCLE CHECKER
# ==============================================================================

def validate_logic_rules(form_data, rules):
    """
    Validate user-configured logic rules:
    - Check question & choice existence
    - Detect duplicates, direct contradictions, and dependency cycles
    """
    q_map = {}
    for p in (form_data or {}).get("pages", []):
        for el in p.get("elements", []):
            q_map[str(el["id"])] = el

    errors = []
    warnings = []
    seen_pairs = {}
    adj = {}

    for idx, r in enumerate(rules or []):
        if not r.get("enabled", True):
            continue
        sid = str(r.get("source_id", ""))
        tid = str(r.get("target_id", ""))
        s_choice = str(r.get("source_choice", ""))
        op = r.get("operator", "require")
        t_choices = [str(x) for x in (r.get("target_choices") or []) if str(x)]

        if sid not in q_map or tid not in q_map:
            errors.append(f"Quy tắc #{idx + 1}: Câu hỏi nguồn hoặc đích không còn tồn tại.")
            continue
        if sid == tid:
            errors.append(f"Quy tắc #{idx + 1}: Câu nguồn và câu đích không thể giống nhau.")
            continue
        if not s_choice or not t_choices:
            errors.append(f"Quy tắc #{idx + 1}: Thiếu đáp án điều kiện hoặc đáp án bắt buộc.")
            continue

        pair_key = (sid, s_choice, tid)
        if pair_key in seen_pairs:
            prev_op, prev_tc = seen_pairs[pair_key]
            if prev_op == op and set(prev_tc) == set(t_choices):
                warnings.append(f"Quy tắc #{idx + 1} bị trùng lặp với quy tắc trước đó.")
            elif prev_op == "require" and op == "require" and not (set(prev_tc) & set(t_choices)):
                errors.append(
                    f"Mâu thuẫn quy tắc #{idx + 1}: '{q_map[sid]['name']} = {s_choice}' ép '{q_map[tid]['name']}' "
                    f"phải chọn hai tập đáp án không giao nhau."
                )
            elif prev_op != op and set(prev_tc) == set(t_choices):
                errors.append(f"Mâu thuẫn quy tắc #{idx + 1}: Vừa bắt buộc vừa loại trừ cùng đáp án trên '{q_map[tid]['name']}'.")
        else:
            seen_pairs[pair_key] = (op, t_choices)

        adj.setdefault(sid, set()).add(tid)

    # Cycle detection (DFS)
    state = {}  # 0=unvisited, 1=visiting, 2=done

    def dfs(node):
        state[node] = 1
        for nxt in adj.get(node, ()):
            if state.get(nxt) == 1:
                return True
            if state.get(nxt, 0) == 0 and dfs(nxt):
                return True
        state[node] = 2
        return False

    for node in list(adj.keys()):
        if state.get(node, 0) == 0 and dfs(node):
            errors.append("Phát hiện vòng lặp phụ thuộc giữa các quy tắc (A -> B -> ... -> A). Vui lòng gỡ bớt 1 quy tắc.")
            break

    return {"valid": len(errors) == 0, "errors": errors, "warnings": warnings}


# ==============================================================================
# 3. ABSOLUTE & NATURAL CAMPAIGN DATA GENERATOR (WITH RULES + BRANCHING)
# ==============================================================================

def _find_matching_cfg_key(choices_cfg, opt_val):
    if not choices_cfg:
        return None
    opt_str = str(opt_val).strip()
    if opt_str in choices_cfg:
        return opt_str
    for cfg_key in choices_cfg.keys():
        if backend_fuzzy_match(cfg_key, opt_val):
            return cfg_key
    return None


def _find_other_cfg_key(choices_cfg):
    if not choices_cfg:
        return None
    for cfg_key in choices_cfg.keys():
        if cfg_key == "__other_option__" or backend_fuzzy_match(cfg_key, "khác") or backend_fuzzy_match(cfg_key, "mục khác"):
            return cfg_key
    return None


def _hamilton_pool(active_choices, count):
    """Allocate exact integer counts matching percentages using Largest Remainder Method."""
    total_weight = sum(active_choices.values()) or 100.0
    options = list(active_choices.keys())
    counts = {}
    remainders = {}
    for opt in options:
        target = (active_choices[opt] / total_weight) * count
        counts[opt] = int(target)
        remainders[opt] = target - counts[opt]
    unallocated = count - sum(counts.values())
    for i, opt in enumerate(sorted(options, key=lambda o: remainders[o], reverse=True)):
        if i >= unallocated:
            break
        counts[opt] += 1
    pool = []
    for opt, opt_count in counts.items():
        if opt == "__other_option__":
            pool.extend(faker.word() for _ in range(opt_count))
        else:
            pool.extend([opt] * opt_count)
    random.shuffle(pool)
    return pool[:count]


def generate_campaign_dataset(form_data, fields_config, count, distribution_mode="absolute", rules=None):
    """
    Pre-generate `count` complete respondent records respecting:
    - Hamilton absolute counts (or natural organic distribution)
    - Checkbox response validation (min/max/exact selection)
    - Cross-question logic rules
    - Google/Microsoft Form section branching (clearing unvisited section answers)
    """
    count = max(1, int(count or 1))
    fields_config = fields_config or {}
    pregenerated = {}
    elem_map = {}

    for page in form_data.get("pages", []):
        for elem in page.get("elements", []):
            eid = str(elem["id"])
            elem_map[eid] = elem
            etype = elem["type"]
            cfg = fields_config.get(eid, {})

            if etype in ["Radio", "Dropdown", "Scale"]:
                opts = list(elem.get("choices") or [])
                choices_cfg = cfg.get("choices") or cfg.get("options") or {}
                active = {}
                for o in opts:
                    mk = _find_matching_cfg_key(choices_cfg, o)
                    if mk is not None:
                        try:
                            w = float(choices_cfg[mk])
                            if w > 0:
                                active[o] = w
                        except (ValueError, TypeError):
                            pass
                if elem.get("has_other"):
                    ok = _find_other_cfg_key(choices_cfg)
                    if ok is not None:
                        try:
                            w = float(choices_cfg[ok])
                            if w > 0:
                                active["__other_option__"] = w
                        except (ValueError, TypeError):
                            pass

                if not active and opts:
                    if distribution_mode.startswith("natural_"):
                        active = calculate_natural_weights(opts, distribution_mode)
                    else:
                        active = {o: 100.0 / len(opts) for o in opts}

                if not active:
                    pregenerated[eid] = [""] * count
                elif distribution_mode == "absolute":
                    pregenerated[eid] = _hamilton_pool(active, count)
                else:
                    o_list = list(active.keys())
                    w_list = [max(0.1, float(active[k]) * random.uniform(0.88, 1.12)) for k in o_list]
                    pregenerated[eid] = [
                        (faker.word() if ch == "__other_option__" else ch)
                        for ch in random.choices(o_list, weights=w_list, k=count)
                    ]

            elif etype == "Checkboxes":
                opts = list(elem.get("choices") or [])
                choices_cfg = cfg.get("choices") or cfg.get("options") or {}
                active = {}
                for o in opts:
                    mk = _find_matching_cfg_key(choices_cfg, o)
                    if mk is not None:
                        try:
                            w = float(choices_cfg[mk])
                            if w > 0:
                                active[o] = w
                        except (ValueError, TypeError):
                            pass
                if not active and opts:
                    active = {o: 50.0 for o in opts}

                val_rule = elem.get("validation") or {}
                min_sel = val_rule.get("exact_select") or val_rule.get("min_select") or (1 if elem.get("required") else 0)
                max_sel = val_rule.get("exact_select") or val_rule.get("max_select") or len(opts)

                pools = {}
                for cv, w in active.items():
                    ty = min(count, max(0, int(round((w / 100.0) * count))))
                    c_pool = [True] * ty + [False] * (count - ty)
                    random.shuffle(c_pool)
                    pools[cv] = c_pool

                vals = []
                o_keys = list(active.keys())
                w_keys = [float(active[k]) for k in o_keys]
                for idx in range(count):
                    sel = [cv for cv, cp in pools.items() if cp[idx]]
                    if max_sel and len(sel) > max_sel:
                        random.shuffle(sel)
                        sel = sel[:max_sel]
                    while len(sel) < min_sel and len(sel) < len(o_keys):
                        cand = random.choices(o_keys, weights=w_keys, k=1)[0]
                        if cand not in sel:
                            sel.append(cand)
                    vals.append(sel)
                pregenerated[eid] = vals

            elif etype in ["RadioGrid", "CheckboxGrid"]:
                rows = elem.get("rows") or []
                cols = elem.get("choices") or []
                rows_cfg = cfg.get("rows") or {}
                row_pools = {}
                for r in rows:
                    rk = next((k for k in rows_cfg if backend_fuzzy_match(k, r)), None)
                    rcfg = rows_cfg.get(rk, {}) if rk else {}
                    ccfg = rcfg.get("choices") or rcfg.get("options") or rcfg if isinstance(rcfg, dict) else {}
                    active = {}
                    for c in cols:
                        mk = _find_matching_cfg_key(ccfg, c)
                        if mk is not None:
                            try:
                                w = float(ccfg[mk])
                                if w > 0:
                                    active[c] = w
                            except (ValueError, TypeError):
                                pass
                    if not active and cols:
                        active = calculate_natural_weights(cols, distribution_mode) if distribution_mode.startswith("natural_") else {c: 100.0 / len(cols) for c in cols}
                    if etype == "RadioGrid":
                        row_pools[r] = _hamilton_pool(active, count) if active else [""] * count
                    else:
                        pools = {}
                        for cv, w in active.items():
                            ty = min(count, max(0, int(round((w / 100.0) * count))))
                            cp = [True] * ty + [False] * (count - ty)
                            random.shuffle(cp)
                            pools[cv] = cp
                        rvals = []
                        for i in range(count):
                            s = [cv for cv, cp in pools.items() if cp[i]]
                            if elem.get("required") and not s and active:
                                s = [random.choice(list(active.keys()))]
                            rvals.append(s)
                        row_pools[r] = rvals

                pregenerated[eid] = [[row_pools[r][i] for r in rows] for i in range(count)]

            elif etype in ["Short", "Paragraph", "UserEmail"]:
                strategy = cfg.get("strategy", "email" if etype == "UserEmail" else "custom_list")
                if strategy == "custom_list":
                    items = parse_custom_list_values(cfg.get("static_value", ""))
                    if not items:
                        try:
                            items, _ = generate_ai_text_pool_for_question(
                                form_data.get("title", ""),
                                form_data.get("description", ""),
                                elem.get("name", ""),
                                elem.get("description", ""),
                                etype,
                                cfg.get("ai_prompt", ""),
                                min(count, 35),
                            )
                        except Exception:
                            items = []
                    pregenerated[eid] = [items[i % len(items)] for i in range(count)] if items else generate_unique_vi_name_pool(count)
                elif strategy == "static" and cfg.get("static_value"):
                    pregenerated[eid] = [str(cfg.get("static_value")).strip()] * count
                elif strategy == "vi_name":
                    pregenerated[eid] = generate_unique_vi_name_pool(count)
                elif strategy == "vi_phone":
                    pregenerated[eid] = generate_unique_phone_pool(count)
                elif strategy == "mssv":
                    pregenerated[eid] = generate_unique_mssv_pool(count)
                elif strategy == "class_code":
                    pregenerated[eid] = generate_class_code_pool(count)
                elif strategy == "vi_address":
                    pregenerated[eid] = generate_vi_address_pool(count)
                elif strategy == "number":
                    pregenerated[eid] = [str(random.randint(18, 60)) for _ in range(count)]
                elif strategy == "text":
                    pregenerated[eid] = [faker.sentence() for _ in range(count)]
                else:
                    pregenerated[eid] = generate_unique_email_pool(count)

            elif etype == "Date":
                pregenerated[eid] = [date.today() - timedelta(days=random.randint(0, 90)) for _ in range(count)]
            elif etype == "Time":
                pregenerated[eid] = [dtime(hour=random.randint(7, 22), minute=random.randint(0, 59)) for _ in range(count)]
            elif etype == "Duration":
                pregenerated[eid] = [timedelta(minutes=random.randint(5, 90)) for _ in range(count)]
            elif etype == "Ranking":
                ch = list(elem.get("choices") or [])
                rows_rk = []
                for _ in range(count):
                    c_copy = list(ch)
                    random.shuffle(c_copy)
                    rows_rk.append(c_copy)
                pregenerated[eid] = rows_rk

    # Assemble row-by-row respondents
    respondents = []
    active_rules = [r for r in (rules or []) if r.get("enabled", True)]
    for i in range(count):
        row = {eid: pregenerated[eid][i] for eid in pregenerated}

        # Enforce logic rules in order
        for rule in active_rules:
            sid = str(rule.get("source_id", ""))
            tid = str(rule.get("target_id", ""))
            if sid not in row or tid not in row:
                continue
            if str(row[sid]) == str(rule.get("source_choice", "")):
                t_choices = list(rule.get("target_choices") or [])
                op = rule.get("operator", "require")
                t_elem = elem_map.get(tid, {})
                all_choices = list(t_elem.get("choices") or [])
                if op == "require" and t_choices:
                    if str(row[tid]) not in t_choices:
                        row[tid] = random.choice(t_choices)
                elif op == "exclude" and t_choices:
                    if str(row[tid]) in t_choices:
                        allowed = [c for c in all_choices if c not in t_choices]
                        if allowed:
                            row[tid] = random.choice(allowed)

        # Respect Google/Microsoft Form section branching
        if form_data.get("has_branching"):
            visited = set(compute_visited_pages(form_data, row))
            for p_idx, page in enumerate(form_data.get("pages", [])):
                if p_idx not in visited:
                    for el in page.get("elements", []):
                        row[str(el["id"])] = None

        respondents.append(row)

    return respondents


# ==============================================================================
# 4. SPREAD SCHEDULER & NIGHT MODE ENGINE
# ==============================================================================

def _is_night_hour(dt):
    return dt.hour >= 22 or dt.hour < 7


def _advance_past_night(dt):
    if dt.hour >= 22:
        nxt = (dt + timedelta(days=1)).replace(hour=7, minute=0, second=0, microsecond=0)
        return nxt + timedelta(seconds=random.randint(15, 240))
    if dt.hour < 7:
        nxt = dt.replace(hour=7, minute=0, second=0, microsecond=0)
        return nxt + timedelta(seconds=random.randint(15, 240))
    return dt


def build_schedule(count, schedule_cfg=None, base_dt=None):
    """
    Build strictly ascending target timestamps for `count` responses.
    schedule_cfg:
      - mode: 'immediate' | 'window' | 'interval'
      - delay_sec: float (for immediate)
      - window_minutes: int (for window mode, 15 min .. 30 days)
      - interval_min_sec: float
      - interval_max_sec: float
      - start_at: ISO string (optional)
      - rhythm: 'even' | 'natural'
      - night_mode: 'normal' | 'pause' | 'reduce'
    """
    count = max(1, int(count or 1))
    cfg = schedule_cfg or {}
    mode = cfg.get("mode", "immediate")
    rhythm = cfg.get("rhythm", "natural")
    night_mode = cfg.get("night_mode", "normal")

    now = base_dt or datetime.now()
    start_dt = now
    if cfg.get("start_at"):
        try:
            parsed = datetime.fromisoformat(str(cfg["start_at"]).replace("Z", "+00:00"))
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone().replace(tzinfo=None)
            if parsed > now:
                start_dt = parsed
        except Exception:
            pass

    if night_mode == "pause":
        start_dt = _advance_past_night(start_dt)

    timestamps = []
    if mode == "immediate":
        delay = max(0.1, float(cfg.get("delay_sec", 1.0) or 1.0))
        cur = start_dt
        for i in range(count):
            if i > 0:
                cur = cur + timedelta(seconds=delay)
            timestamps.append(cur)
        return timestamps

    if mode == "window":
        window_min = max(1, min(30 * 24 * 60, float(cfg.get("window_minutes", 60) or 60)))
        total_sec = window_min * 60.0
        if count == 1:
            timestamps.append(start_dt)
        else:
            step = total_sec / (count - 1)
            cur = start_dt
            for i in range(count):
                if i > 0:
                    delta = step if rhythm == "even" else max(1.0, step * random.uniform(0.55, 1.45))
                    if night_mode == "reduce" and _is_night_hour(cur):
                        delta *= 3.8
                    cur = cur + timedelta(seconds=delta)
                if night_mode == "pause":
                    cur = _advance_past_night(cur)
                if timestamps and cur <= timestamps[-1]:
                    cur = timestamps[-1] + timedelta(seconds=1)
                timestamps.append(cur)
        return timestamps

    # mode == 'interval'
    min_s = max(1.0, float(cfg.get("interval_min_sec", 60) or 60))
    max_s = max(min_s, float(cfg.get("interval_max_sec", 180) or 180))
    cur = start_dt
    for i in range(count):
        if i > 0:
            delta = (min_s + max_s) / 2.0 if rhythm == "even" else random.uniform(min_s, max_s)
            if night_mode == "reduce" and _is_night_hour(cur):
                delta *= 4.0
            cur = cur + timedelta(seconds=delta)
        if night_mode == "pause":
            cur = _advance_past_night(cur)
        if timestamps and cur <= timestamps[-1]:
            cur = timestamps[-1] + timedelta(seconds=1)
        timestamps.append(cur)
    return timestamps
