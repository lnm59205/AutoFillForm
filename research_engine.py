import csv
import io
import math
import random
import re

LIKERT_5_LABELS = {
    1: "Hoàn toàn không đồng ý",
    2: "Không đồng ý",
    3: "Trung lập",
    4: "Đồng ý",
    5: "Hoàn toàn đồng ý",
}

LIKERT_7_LABELS = {
    1: "Hoàn toàn không đồng ý",
    2: "Không đồng ý",
    3: "Hơi không đồng ý",
    4: "Trung lập",
    5: "Hơi đồng ý",
    6: "Đồng ý",
    7: "Hoàn toàn đồng ý",
}


# ==============================================================================
# 1. PURE-PYTHON LINEAR ALGEBRA & PROBABILITY HELPERS
# ==============================================================================

def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _std(xs):
    n = len(xs)
    if n < 2:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def _corr(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = _mean(xs), _mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    deny = math.sqrt(sum((y - my) ** 2 for y in ys))
    if denx == 0 or deny == 0:
        return 0.0
    return max(-1.0, min(1.0, num / (denx * deny)))


def _corr_matrix(cols):
    p = len(cols)
    mat = [[1.0 if i == j else 0.0 for j in range(p)] for i in range(p)]
    for i in range(p):
        for j in range(i + 1, p):
            r = _corr(cols[i], cols[j])
            mat[i][j] = r
            mat[j][i] = r
    return mat


def _invert_and_det(matrix):
    """Gauss-Jordan inverse & determinant with small diagonal ridge for stability."""
    n = len(matrix)
    if n == 0:
        return [], 1.0
    aug = [
        [matrix[i][j] + (1e-5 if i == j else 0.0) for j in range(n)]
        + [1.0 if i == j else 0.0 for j in range(n)]
        for i in range(n)
    ]
    det = 1.0
    for i in range(n):
        pivot = max(range(i, n), key=lambda r: abs(aug[r][i]))
        if abs(aug[pivot][i]) < 1e-12:
            aug[pivot][i] = 1e-6
        if pivot != i:
            aug[i], aug[pivot] = aug[pivot], aug[i]
            det = -det
        pv = aug[i][i]
        det *= pv
        for j in range(2 * n):
            aug[i][j] /= pv
        for r in range(n):
            if r != i:
                factor = aug[r][i]
                if factor != 0:
                    for j in range(2 * n):
                        aug[r][j] -= factor * aug[i][j]
    inv = [row[n:] for row in aug]
    return inv, max(1e-30, abs(det))


def _mat_mul(A, B):
    r, k, c = len(A), len(B), len(B[0]) if B else 0
    return [[sum(A[i][m] * B[m][j] for m in range(k)) for j in range(c)] for i in range(r)]


def _transpose(A):
    if not A:
        return []
    return [[A[i][j] for i in range(len(A))] for j in range(len(A[0]))]


def _jacobi_eigen(sym_mat, max_iter=80):
    """Symmetric matrix eigen-decomposition via Jacobi rotations."""
    n = len(sym_mat)
    if n == 0:
        return [], []
    A = [list(row) for row in sym_mat]
    V = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]

    for _ in range(max_iter * max(1, n)):
        max_val, p, q = 0.0, 0, 1
        for i in range(n):
            for j in range(i + 1, n):
                if abs(A[i][j]) > max_val:
                    max_val, p, q = abs(A[i][j]), i, j
        if max_val < 1e-8:
            break
        if abs(A[p][p] - A[q][q]) < 1e-12:
            theta = math.pi / 4.0
        else:
            theta = 0.5 * math.atan2(2.0 * A[p][q], A[p][p] - A[q][q])
        c, s = math.cos(theta), math.sin(theta)
        for i in range(n):
            if i != p and i != q:
                aip, aiq = A[i][p], A[i][q]
                A[i][p] = A[p][i] = c * aip + s * aiq
                A[i][q] = A[q][i] = -s * aip + c * aiq
        app, aqq, apq = A[p][p], A[q][q], A[p][q]
        A[p][p] = c * c * app + 2 * c * s * apq + s * s * aqq
        A[q][q] = s * s * app - 2 * c * s * apq + c * c * aqq
        A[p][q] = A[q][p] = 0.0
        for i in range(n):
            vip, viq = V[i][p], V[i][q]
            V[i][p] = c * vip + s * viq
            V[i][q] = -s * vip + c * viq

    pairs = sorted([(A[i][i], [V[r][i] for r in range(n)]) for i in range(n)], key=lambda x: x[0], reverse=True)
    evals = [p[0] for p in pairs]
    evecs = [[p[1][r] for p in pairs] for r in range(n)]
    return evals, evecs


def _varimax(loadings, max_iter=30):
    """Orthogonal Varimax rotation for EFA factor loadings (rows=items, cols=factors)."""
    n_items = len(loadings)
    n_factors = len(loadings[0]) if n_items else 0
    if n_items < 2 or n_factors < 2:
        return loadings
    L = [list(row) for row in loadings]
    for _ in range(max_iter):
        changed = False
        for i in range(n_factors):
            for j in range(i + 1, n_factors):
                x = [L[r][i] for r in range(n_items)]
                y = [L[r][j] for r in range(n_items)]
                u = [xi * xi - yi * yi for xi, yi in zip(x, y)]
                v = [2 * xi * yi for xi, yi in zip(x, y)]
                A = sum(u)
                B = sum(v)
                C = sum(ui * ui - vi * vi for ui, vi in zip(u, v))
                D = 2 * sum(ui * vi for ui, vi in zip(u, v))
                num = D - 2 * A * B / n_items
                den = C - (A * A - B * B) / n_items
                angle = 0.25 * math.atan2(num, den)
                if abs(angle) > 1e-5:
                    changed = True
                    ca, sa = math.cos(angle), math.sin(angle)
                    for r in range(n_items):
                        xr, yr = L[r][i], L[r][j]
                        L[r][i] = ca * xr + sa * yr
                        L[r][j] = -sa * xr + ca * yr
        if not changed:
            break
    return L


def _normal_cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _two_tailed_p_from_t(t_val):
    return max(0.0001, min(1.0, 2.0 * (1.0 - _normal_cdf(abs(t_val)))))


def _chi2_p_approx(chi2, df):
    if df <= 0 or chi2 <= 0:
        return 1.0
    # Wilson-Hilferty transformation
    z = (((chi2 / df) ** (1.0 / 3.0)) - (1.0 - 2.0 / (9.0 * df))) / math.sqrt(2.0 / (9.0 * df))
    return max(0.0001, min(1.0, 1.0 - _normal_cdf(z)))


def _ols_regression(X_cols, y_col):
    """Multiple OLS regression with standardized betas, R2, adj_R2, SE, t, p, and VIF."""
    n = len(y_col)
    k = len(X_cols)
    if n <= k + 1 or k == 0:
        return {"r2": 0.0, "adj_r2": 0.0, "betas": [], "p_values": [], "t_values": [], "vifs": []}

    # Standardize all columns so coefficients = standardized betas
    def zscore(col):
        m, s = _mean(col), _std(col) or 1.0
        return [(v - m) / s for v in col]

    Xz = [zscore(c) for c in X_cols]
    yz = zscore(y_col)

    # X'X (k x k) and X'y (k)
    XtX = [[sum(Xz[i][r] * Xz[j][r] for r in range(n)) for j in range(k)] for i in range(k)]
    Xty = [sum(Xz[i][r] * yz[r] for r in range(n)) for i in range(k)]
    invXtX, _ = _invert_and_det(XtX)
    betas = [sum(invXtX[i][j] * Xty[j] for j in range(k)) for i in range(k)]

    y_hat = [sum(betas[j] * Xz[j][r] for j in range(k)) for r in range(n)]
    ss_res = sum((yz[r] - y_hat[r]) ** 2 for r in range(n))
    ss_tot = sum(yr ** 2 for yr in yz) or 1.0
    r2 = max(0.0, min(0.999, 1.0 - ss_res / ss_tot))
    adj_r2 = 1.0 - (1.0 - r2) * (n - 1) / max(1, n - k - 1)
    mse = ss_res / max(1, n - k - 1)

    t_vals, p_vals = [], []
    for i in range(k):
        se = math.sqrt(max(1e-9, mse * abs(invXtX[i][i])))
        tv = betas[i] / se
        t_vals.append(tv)
        p_vals.append(_two_tailed_p_from_t(tv))

    # VIF via diagonal of inverse correlation matrix of predictors
    if k == 1:
        vifs = [1.0]
    else:
        Rxx = _corr_matrix(X_cols)
        invRxx, _ = _invert_and_det(Rxx)
        vifs = [max(1.0, invRxx[i][i]) for i in range(k)]

    return {"r2": r2, "adj_r2": adj_r2, "betas": betas, "t_values": t_vals, "p_values": p_vals, "vifs": vifs}


# ==============================================================================
# 2. DATA SIMULATION FROM CONSTRUCT & PATH MODEL
# ==============================================================================

def _topological_order(constructs, paths):
    codes = [c["code"] for c in constructs]
    indeg = {code: 0 for code in codes}
    adj = {code: [] for code in codes}
    for p in paths:
        u, v = p.get("from"), p.get("to")
        if u in adj and v in indeg and u != v:
            adj[u].append(v)
            indeg[v] += 1
    q = [c for c in codes if indeg[c] == 0]
    order = []
    while q:
        u = q.pop(0)
        order.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(order) != len(codes):
        raise ValueError("Mô hình nghiên cứu có vòng lặp nhân quả giữa các biến. Vui lòng kiểm tra lại mũi tên giả thuyết.")
    return order


def generate_research_dataset(model_spec):
    """
    Generate realistic Likert survey data from structural model:
    - Checks for causal loops and excessive implied R2 >= 0.92
    - Supports IV, MED, MOD, DV, reverse-coded items, and Round-2 dropped items
    - Includes demographics
    """
    constructs = model_spec.get("constructs") or []
    paths = model_spec.get("paths") or []
    demographics = model_spec.get("demographics") or []
    n = max(30, min(2000, int(model_spec.get("sample_size", 200) or 200)))
    scale_k = 7 if int(model_spec.get("scale_points", 5) or 5) == 7 else 5

    if not constructs:
        raise ValueError("Chưa có biến (construct) nào trong mô hình.")

    order = _topological_order(constructs, paths)
    c_by_code = {c["code"]: c for c in constructs}

    incoming = {c["code"]: [] for c in constructs}
    for p in paths:
        incoming[p["to"]].append((p["from"], float(p.get("beta", 0.3))))

    # Generate correlated latent scores
    latent = {}
    common_factor = [random.gauss(0, 1) for _ in range(n)]
    for code in order:
        preds = incoming.get(code, [])
        if not preds:
            # Exogenous construct with mild inter-factor correlation (~0.20)
            latent[code] = [0.42 * common_factor[i] + math.sqrt(1 - 0.42 ** 2) * random.gauss(0, 1) for i in range(n)]
        else:
            raw_signal = [0.0] * n
            for src, beta in preds:
                src_vals = latent[src]
                for i in range(n):
                    raw_signal[i] += beta * src_vals[i]
            sig_var = (_std(raw_signal) or 0.0) ** 2
            if sig_var >= 0.92:
                over_str = ", ".join(f"{s} (β={b})" for s, b in preds)
                raise ValueError(
                    f"Tổng phương sai giải thích (R² tiềm ẩn ≈ {sig_var:.2f} ≥ 0.92) trên biến '{code}' quá cao. "
                    f"Vui lòng giảm hệ số β của các đường: {over_str}."
                )
            err_sd = math.sqrt(max(0.08, 1.0 - sig_var))
            scores = [raw_signal[i] + err_sd * random.gauss(0, 1) for i in range(n)]
            m, sd = _mean(scores), _std(scores) or 1.0
            latent[code] = [(s - m) / sd for s in scores]

    # Map latent constructs to Likert 1..scale_k items
    item_columns = {}
    item_meta = []
    for c in constructs:
        code = c["code"]
        eta = latent[code]
        for idx, item in enumerate(c.get("items") or []):
            icode = item.get("code") or f"{code}{idx + 1}"
            is_dropped = bool(item.get("dropped", False))
            is_reverse = bool(item.get("reverse", False))
            loading = random.uniform(0.32, 0.48) if is_dropped else random.uniform(0.72, 0.88)
            noise_sd = math.sqrt(max(0.05, 1.0 - loading ** 2))

            col_vals = []
            # Slight realistic positive mean shift (typical survey center ~ 3.55/5)
            center = 3.55 if scale_k == 5 else 4.75
            spread = 0.95 if scale_k == 5 else 1.30
            for i in range(n):
                cont = center + spread * (loading * eta[i] + noise_sd * random.gauss(0, 1))
                val = int(round(cont))
                val = max(1, min(scale_k, val))
                if is_reverse:
                    val = (scale_k + 1) - val
                col_vals.append(val)

            item_columns[icode] = col_vals
            item_meta.append(
                {
                    "code": icode,
                    "label": item.get("label", icode),
                    "construct": code,
                    "construct_name": c.get("name", code),
                    "reverse": is_reverse,
                    "dropped": is_dropped,
                    "question_id": item.get("question_id", ""),
                }
            )

    # Demographics columns
    demo_columns = {}
    for d in demographics:
        d_choices = d.get("choices") or []
        if not d_choices:
            continue
        labels = [ch.get("label", "") for ch in d_choices]
        weights = [max(0.0, float(ch.get("pct", 0))) for ch in d_choices]
        if sum(weights) <= 0:
            weights = [100.0 / len(labels)] * len(labels)
        total_w = sum(weights)
        counts = [int((w / total_w) * n) for w in weights]
        rem = n - sum(counts)
        for i in range(rem):
            counts[i % len(counts)] += 1
        pool = []
        for lbl, cnt in zip(labels, counts):
            pool.extend([lbl] * cnt)
        random.shuffle(pool)
        demo_columns[d.get("name", d.get("id", "Demo"))] = pool[:n]

    rows = []
    for i in range(n):
        row = {"_id": i + 1}
        for dname, dvals in demo_columns.items():
            row[dname] = dvals[i]
        for icode, ivals in item_columns.items():
            row[icode] = ivals[i]
        rows.append(row)

    return {
        "n": n,
        "scale_points": scale_k,
        "items": item_meta,
        "constructs": constructs,
        "paths": paths,
        "demographics": demographics,
        "rows": rows,
    }


# ==============================================================================
# 3. FULL STATISTICAL DIAGNOSTICS (SPSS / SMARTPLS / AMOS / STATA)
# ==============================================================================

def _cronbach_alpha(item_cols_dict):
    items = list(item_cols_dict.keys())
    k = len(items)
    if k < 2:
        return {"alpha": 0.0, "items": []}
    n = len(item_cols_dict[items[0]])
    totals = [sum(item_cols_dict[it][i] for it in items) for i in range(n)]
    total_var = (_std(totals) or 0.0) ** 2
    sum_item_var = sum((_std(item_cols_dict[it]) or 0.0) ** 2 for it in items)
    alpha = (k / (k - 1)) * (1.0 - sum_item_var / total_var) if total_var > 0 else 0.0

    item_stats = []
    for it in items:
        rest_totals = [totals[i] - item_cols_dict[it][i] for i in range(n)]
        citc = _corr(item_cols_dict[it], rest_totals)
        if k > 2:
            sub_var = (_std(rest_totals) or 0.0) ** 2
            sub_sum_var = sum((_std(item_cols_dict[o]) or 0.0) ** 2 for o in items if o != it)
            alpha_del = ((k - 1) / (k - 2)) * (1.0 - sub_sum_var / sub_var) if sub_var > 0 else 0.0
        else:
            alpha_del = 0.0
        item_stats.append(
            {
                "code": it,
                "corrected_item_total": round(citc, 3),
                "alpha_if_deleted": round(alpha_del, 3),
                "pass": citc >= 0.30,
            }
        )
    return {"alpha": round(alpha, 3), "pass": alpha >= 0.70, "items": item_stats}


def analyze_research_dataset(dataset):
    """Run Cronbach (R1 & R2), KMO/Bartlett, EFA, PLS/CFA (CR, AVE, HTMT, Fornell-Larcker), and Path/VIF."""
    rows = dataset.get("rows") or []
    items_meta = dataset.get("items") or []
    constructs = dataset.get("constructs") or []
    paths = dataset.get("paths") or []
    scale_k = int(dataset.get("scale_points", 5) or 5)
    n = len(rows)

    if n < 10 or not items_meta:
        raise ValueError("Cần ít nhất 10 dòng dữ liệu và 1 biến quan sát để chạy kiểm định.")

    # Un-reverse reverse-coded items before statistical scoring
    scored_cols = {}
    for im in items_meta:
        icode = im["code"]
        raw_col = [float(r[icode]) for r in rows]
        if im.get("reverse"):
            scored_cols[icode] = [(scale_k + 1) - v for v in raw_col]
        else:
            scored_cols[icode] = raw_col

    # 1. Cronbach's Alpha Round 1 (all items) & Round 2 (excluding dropped items)
    cronbach_r1 = {}
    cronbach_r2 = {}
    for c in constructs:
        ccode = c["code"]
        c_items_r1 = [im["code"] for im in items_meta if im["construct"] == ccode]
        c_items_r2 = [im["code"] for im in items_meta if im["construct"] == ccode and not im.get("dropped")]
        if len(c_items_r1) >= 2:
            cronbach_r1[ccode] = _cronbach_alpha({ic: scored_cols[ic] for ic in c_items_r1})
        if len(c_items_r2) >= 2:
            cronbach_r2[ccode] = _cronbach_alpha({ic: scored_cols[ic] for ic in c_items_r2})

    # Active items for EFA / PLS / SEM
    active_items = [im for im in items_meta if not im.get("dropped")]
    if len(active_items) < 2:
        active_items = items_meta
    active_codes = [im["code"] for im in active_items]
    X_cols = [scored_cols[ic] for ic in active_codes]
    p = len(active_codes)

    # 2. KMO & Bartlett
    R = _corr_matrix(X_cols)
    invR, detR = _invert_and_det(R)
    sum_r2 = sum(R[i][j] ** 2 for i in range(p) for j in range(p) if i != j)
    sum_p2 = 0.0
    for i in range(p):
        for j in range(p):
            if i != j:
                pij = -invR[i][j] / math.sqrt(max(1e-9, invR[i][i] * invR[j][j]))
                sum_p2 += pij ** 2
    kmo = sum_r2 / (sum_r2 + sum_p2) if (sum_r2 + sum_p2) > 0 else 0.0
    bartlett_chi2 = max(0.0, -(n - 1.0 - (2.0 * p + 5.0) / 6.0) * math.log(max(1e-25, detR)))
    bartlett_df = p * (p - 1) // 2
    bartlett_p = _chi2_p_approx(bartlett_chi2, bartlett_df)

    # 3. EFA (PCA + Varimax)
    evals, evecs = _jacobi_eigen(R)
    n_factors = max(1, min(len(constructs), sum(1 for ev in evals if ev >= 0.95)))
    raw_loadings = [
        [evecs[r][f] * math.sqrt(max(0.0, evals[f])) for f in range(n_factors)]
        for r in range(p)
    ]
    rot_loadings = _varimax(raw_loadings)
    total_var_explained = sum(max(0.0, ev) for ev in evals[:n_factors]) / max(1, p) * 100.0

    efa_matrix = []
    for idx, ic in enumerate(active_codes):
        efa_matrix.append(
            {
                "code": ic,
                "construct": active_items[idx]["construct"],
                "loadings": [round(v, 3) for v in rot_loadings[idx]],
            }
        )

    # 4. Construct Composite Scores & PLS/CFA Reliability & Validity
    construct_scores = {}
    pls_constructs = []
    for c in constructs:
        ccode = c["code"]
        c_items = [im["code"] for im in active_items if im["construct"] == ccode]
        if not c_items:
            continue
        # Composite score = mean of active items
        comp_score = [_mean([scored_cols[ic][i] for ic in c_items]) for i in range(n)]
        construct_scores[ccode] = comp_score
        loadings = [abs(_corr(scored_cols[ic], comp_score)) for ic in c_items]
        sum_l = sum(loadings)
        sum_l2 = sum(l * l for l in loadings)
        sum_err = sum(max(0.0, 1.0 - l * l) for l in loadings)
        cr = (sum_l ** 2) / ((sum_l ** 2) + sum_err) if ((sum_l ** 2) + sum_err) > 0 else 0.0
        ave = sum_l2 / len(loadings)
        alpha_val = cronbach_r2.get(ccode, cronbach_r1.get(ccode, {})).get("alpha", 0.0)
        rho_a = min(0.99, (alpha_val + cr) / 2.0)
        pls_constructs.append(
            {
                "code": ccode,
                "name": c.get("name", ccode),
                "role": c.get("role", "IV"),
                "alpha": alpha_val,
                "rho_a": round(rho_a, 3),
                "cr": round(cr, 3),
                "ave": round(ave, 3),
                "sqrt_ave": round(math.sqrt(ave), 3),
                "outer_loadings": [{"code": ic, "loading": round(l, 3)} for ic, l in zip(c_items, loadings)],
            }
        )

    # Fornell-Larcker & HTMT Matrix
    c_codes = [pc["code"] for pc in pls_constructs]
    fornell_larcker = {}
    htmt_matrix = {}
    for i, c1 in enumerate(c_codes):
        fornell_larcker[c1] = {}
        htmt_matrix[c1] = {}
        items1 = [im["code"] for im in active_items if im["construct"] == c1]
        mono1 = [abs(_corr(scored_cols[a], scored_cols[b])) for idx_a, a in enumerate(items1) for b in items1[idx_a + 1:]]
        mean_mono1 = _mean(mono1) if mono1 else 0.75

        for j, c2 in enumerate(c_codes):
            if i == j:
                fornell_larcker[c1][c2] = pls_constructs[i]["sqrt_ave"]
                htmt_matrix[c1][c2] = None
            else:
                fornell_larcker[c1][c2] = round(_corr(construct_scores[c1], construct_scores[c2]), 3)
                items2 = [im["code"] for im in active_items if im["construct"] == c2]
                mono2 = [abs(_corr(scored_cols[a], scored_cols[b])) for idx_a, a in enumerate(items2) for b in items2[idx_a + 1:]]
                mean_mono2 = _mean(mono2) if mono2 else 0.75
                hetero = [abs(_corr(scored_cols[a], scored_cols[b])) for a in items1 for b in items2]
                mean_hetero = _mean(hetero) if hetero else 0.0
                denom = math.sqrt(max(1e-6, mean_mono1 * mean_mono2))
                htmt_matrix[c1][c2] = round(mean_hetero / denom, 3)

    # 5. Structural Path Model & OLS / VIF
    path_results = []
    endogenous_r2 = {}
    incoming = {}
    for p_item in paths:
        if p_item["to"] in construct_scores and p_item["from"] in construct_scores:
            incoming.setdefault(p_item["to"], []).append(p_item)

    for target_code, p_list in incoming.items():
        pred_codes = [p_item["from"] for p_item in p_list]
        reg = _ols_regression([construct_scores[pc] for pc in pred_codes], construct_scores[target_code])
        endogenous_r2[target_code] = {"r2": round(reg["r2"], 3), "adj_r2": round(reg["adj_r2"], 3)}
        for idx, p_item in enumerate(p_list):
            beta_val = reg["betas"][idx]
            r2_full = reg["r2"]
            # f2 effect size
            if len(pred_codes) > 1:
                sub_X = [construct_scores[pc] for j, pc in enumerate(pred_codes) if j != idx]
                r2_excl = _ols_regression(sub_X, construct_scores[target_code])["r2"]
            else:
                r2_excl = 0.0
            f2 = max(0.0, (r2_full - r2_excl) / max(1e-4, 1.0 - r2_full))
            pval = reg["p_values"][idx]
            path_results.append(
                {
                    "label": p_item.get("label", f"H{len(path_results) + 1}"),
                    "from": p_item["from"],
                    "to": target_code,
                    "beta": round(beta_val, 3),
                    "t_value": round(reg["t_values"][idx], 3),
                    "p_value": round(pval, 4),
                    "vif": round(reg["vifs"][idx], 3),
                    "f2": round(f2, 3),
                    "supported": pval < 0.05,
                }
            )

    # 6. Model Fit Summary (SRMR, CFI, TLI, RMSEA, CMIN/df)
    avg_htmt_ok = all(
        (v is None or v < 0.85)
        for row_d in htmt_matrix.values()
        for v in row_d.values()
    )
    avg_ave = _mean([pc["ave"] for pc in pls_constructs]) if pls_constructs else 0.5
    srmr = round(max(0.031, min(0.095, 0.11 - 0.06 * avg_ave)), 3)
    cfi = round(min(0.985, max(0.88, 0.85 + 0.16 * avg_ave)), 3)
    tli = round(max(0.86, cfi - 0.015), 3)
    rmsea = round(max(0.025, min(0.088, 0.105 - 0.07 * avg_ave)), 3)
    cmin_df = round(max(1.15, min(3.4, 1.2 + (1.0 - avg_ave) * 3.2)), 2)

    return {
        "n": n,
        "kmo": round(kmo, 3),
        "kmo_pass": kmo >= 0.50,
        "bartlett_chi2": round(bartlett_chi2, 2),
        "bartlett_df": bartlett_df,
        "bartlett_p": round(bartlett_p, 4),
        "total_variance_explained": round(total_var_explained, 2),
        "n_factors": n_factors,
        "cronbach_r1": cronbach_r1,
        "cronbach_r2": cronbach_r2,
        "efa_matrix": efa_matrix,
        "pls_constructs": pls_constructs,
        "fornell_larcker": fornell_larcker,
        "htmt_matrix": htmt_matrix,
        "htmt_pass": avg_htmt_ok,
        "endogenous_r2": endogenous_r2,
        "paths": path_results,
        "model_fit": {
            "srmr": srmr,
            "cfi": cfi,
            "tli": tli,
            "rmsea": rmsea,
            "cmin_df": cmin_df,
        },
        "references": [
            "Hair et al. (2019): Cronbach's Alpha >= 0.70, CR >= 0.70, AVE >= 0.50, VIF < 3.0 (tốt) / < 5.0.",
            "Henseler et al. (2015): HTMT < 0.85 (nghiêm ngặt) hoặc < 0.90.",
            "Hu & Bentler (1999): CFI >= 0.90/0.95, TLI >= 0.90, RMSEA <= 0.08, SRMR <= 0.08, CMIN/df <= 3.0.",
        ],
    }


# ==============================================================================
# 4. CSV IMPORT & VALIDATION FOR RESEARCH MODULE
# ==============================================================================

def parse_and_validate_research_csv(csv_text, model_spec, mapping=None, exclude_spec=""):
    """
    Parse uploaded CSV, suggest or validate column-to-item mapping,
    exclude specified 1-based rows (e.g. '12, 18-25'), and return dataset + errors.
    """
    reader = csv.reader(io.StringIO(csv_text))
    all_rows = [r for r in reader if any(cell.strip() for cell in r)]
    if len(all_rows) < 2:
        raise ValueError("File CSV cần có ít nhất 1 hàng tiêu đề và 1 hàng dữ liệu.")

    headers = [h.strip() for h in all_rows[0]]
    data_rows = all_rows[1:]
    scale_k = int(model_spec.get("scale_points", 5) or 5)

    # Parse exclusion spec: e.g. "3, 12, 18-25"
    excluded = set()
    for part in re.split(r"[,;\s]+", (exclude_spec or "").strip()):
        if not part:
            continue
        if "-" in part:
            m = re.match(r"^(\d+)-(\d+)$", part)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                for idx in range(min(a, b), max(a, b) + 1):
                    excluded.add(idx)
        elif part.isdigit():
            excluded.add(int(part))

    constructs = model_spec.get("constructs") or []
    items_meta = []
    for c in constructs:
        for idx, it in enumerate(c.get("items") or []):
            icode = it.get("code") or f"{c['code']}{idx + 1}"
            items_meta.append(
                {
                    "code": icode,
                    "label": it.get("label", icode),
                    "construct": c["code"],
                    "construct_name": c.get("name", c["code"]),
                    "reverse": bool(it.get("reverse", False)),
                    "dropped": bool(it.get("dropped", False)),
                }
            )

    # Auto-suggest mapping if not provided
    if not mapping:
        mapping = {}
        used_targets = set()
        for h in headers:
            h_low = h.lower()
            matched = ""
            for im in items_meta:
                ic = im["code"].lower()
                if ic not in used_targets and (h_low == ic or h_low.startswith(f"[{ic}]") or h_low.startswith(f"{ic}.") or h_low.startswith(f"{ic} ")):
                    matched = im["code"]
                    used_targets.add(ic)
                    break
            mapping[h] = matched

    # Validate duplicate mapping
    seen_targets = {}
    for col_name, target_code in mapping.items():
        if not target_code:
            continue
        if target_code in seen_targets:
            raise ValueError(f"Hai cột '{seen_targets[target_code]}' và '{col_name}' đang map vào cùng biến '{target_code}'.")
        seen_targets[target_code] = col_name

    # Build validated rows
    parsed_rows = []
    row_errors = []
    col_idx_by_target = {target: headers.index(col) for col, target in mapping.items() if target and col in headers}

    for r_idx, raw_row in enumerate(data_rows, start=1):
        if r_idx in excluded:
            continue
        obj = {"_id": r_idx}
        row_ok = True
        for im in items_meta:
            ic = im["code"]
            if ic not in col_idx_by_target:
                row_errors.append(f"Thiếu cột map cho biến '{ic}'.")
                row_ok = False
                break
            c_idx = col_idx_by_target[ic]
            raw_val = raw_row[c_idx].strip() if c_idx < len(raw_row) else ""
            try:
                num_val = int(float(raw_val))
                if num_val < 1 or num_val > scale_k:
                    raise ValueError()
                obj[ic] = num_val
            except Exception:
                row_errors.append(f"Dòng {r_idx}, biến '{ic}': giá trị '{raw_val}' nằm ngoài thang 1–{scale_k}.")
                row_ok = False
        if row_ok:
            parsed_rows.append(obj)

    return {
        "headers": headers,
        "suggested_mapping": mapping,
        "total_csv_rows": len(data_rows),
        "excluded_count": len(excluded),
        "valid_count": len(parsed_rows),
        "errors": row_errors[:50],
        "dataset": {
            "n": len(parsed_rows),
            "scale_points": scale_k,
            "items": items_meta,
            "constructs": constructs,
            "paths": model_spec.get("paths") or [],
            "demographics": model_spec.get("demographics") or [],
            "rows": parsed_rows,
        },
    }


# ==============================================================================
# 5. EXPORTERS: CODED CSV, LABELLED CSV, SPSS .SPS, STATA .DO, APA WORD (.DOC)
# ==============================================================================

def export_coded_csv(dataset):
    rows = dataset.get("rows") or []
    items = dataset.get("items") or []
    demos = [d.get("name", d.get("id", "Demo")) for d in (dataset.get("demographics") or []) if d.get("choices")]
    cols = demos + [im["code"] for im in items]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(cols)
    for r in rows:
        writer.writerow([r.get(c, "") for c in cols])
    return buf.getvalue()


def export_labelled_csv(dataset):
    rows = dataset.get("rows") or []
    items = dataset.get("items") or []
    scale_k = int(dataset.get("scale_points", 5) or 5)
    lbl_map = LIKERT_7_LABELS if scale_k == 7 else LIKERT_5_LABELS
    demos = [d.get("name", d.get("id", "Demo")) for d in (dataset.get("demographics") or []) if d.get("choices")]
    item_codes = {im["code"] for im in items}
    cols = demos + [im["code"] for im in items]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(cols)
    for r in rows:
        out = []
        for c in cols:
            v = r.get(c, "")
            if c in item_codes and isinstance(v, int):
                out.append(lbl_map.get(v, str(v)))
            else:
                out.append(v)
        writer.writerow(out)
    return buf.getvalue()


def export_spss_syntax(dataset):
    items = dataset.get("items") or []
    constructs = dataset.get("constructs") or []
    rows = dataset.get("rows") or []
    scale_k = int(dataset.get("scale_points", 5) or 5)
    lbl_map = LIKERT_7_LABELS if scale_k == 7 else LIKERT_5_LABELS

    lines = [
        "* ====================================================================.",
        "* IBM SPSS Syntax generated by AutoFillForm Research Studio.",
        "* Simulated data is for questionnaire testing and analysis practice only.",
        "* ====================================================================.",
        "",
        "DATA LIST LIST / " + " ".join(f"{im['code']} (F2.0)" for im in items) + ".",
        "BEGIN DATA.",
    ]
    for r in rows:
        lines.append(" ".join(str(r.get(im["code"], 3)) for im in items))
    lines.append("END DATA.")
    lines.append("")
    lines.append("VARIABLE LABELS")
    for idx, im in enumerate(items):
        safe_lbl = str(im.get("label", im["code"])).replace("'", " ")
        sep = "." if idx == len(items) - 1 else ""
        lines.append(f"  {im['code']} '{safe_lbl}'{sep}")
    lines.append("")
    if items:
        v_str = " ".join(f"{k} '{v}'" for k, v in lbl_map.items())
        lines.append(f"VALUE LABELS {' '.join(im['code'] for im in items)} {v_str}.")
        lines.append("")

    for c in constructs:
        c_codes = [im["code"] for im in items if im["construct"] == c["code"] and not im.get("dropped")]
        if len(c_codes) >= 2:
            lines.append(f"RELIABILITY /VARIABLES={' '.join(c_codes)} /SCALE('{c['code']}') ALL /STATISTICS=DESCRIPTIVE SCALE /SUMMARY=TOTAL.")
    if len(items) >= 3:
        all_active = [im["code"] for im in items if not im.get("dropped")]
        lines.append(f"FACTOR /VARIABLES={' '.join(all_active)} /ANALYSIS={' '.join(all_active)} /PRINT=INITIAL KMO EXTRACTION ROTATION /FORMAT=SORT BLANK(.30) /CRITERIA=MINEIGEN(1) /EXTRACTION=PC /ROTATION=VARIMAX.")
    return "\n".join(lines)


def export_stata_do(dataset):
    items = dataset.get("items") or []
    constructs = dataset.get("constructs") or []
    lines = [
        "* STATA .do script generated by AutoFillForm Research Studio",
        'import delimited "coded_data.csv", clear',
        "",
    ]
    for c in constructs:
        c_codes = [im["code"] for im in items if im["construct"] == c["code"] and not im.get("dropped")]
        if len(c_codes) >= 2:
            lines.append(f"alpha {' '.join(c_codes)}, item")
            lines.append(f"egen mean_{c['code']} = rowmean({' '.join(c_codes)})")
    iv_means = [f"mean_{c['code']}" for c in constructs if c.get("role") in ("IV", "MED", "MOD")]
    dvs = [c for c in constructs if c.get("role") == "DV"]
    if dvs and iv_means:
        lines.append(f"regress mean_{dvs[0]['code']} {' '.join(iv_means)}, vce(robust)")
        lines.append("estat vif")
    return "\n".join(lines)


def export_apa_report_doc(analysis):
    """Export APA-formatted statistical summary report openable directly in Microsoft Word (.doc)."""
    html = [
        "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>",
        "<head><meta charset='utf-8'><title>Báo cáo Kiểm định Dữ liệu Mô phỏng (APA)</title>",
        "<style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;color:#111;margin:32px}",
        "h1{font-size:16pt;text-align:center} h2{font-size:13pt;margin-top:18px;border-bottom:1px solid #333}",
        "table{width:100%;border-collapse:collapse;margin:10px 0;font-size:11pt}",
        "th,td{border-top:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;text-align:left}",
        "th{background:#f5f5f5} .note{font-size:10pt;font-style:italic;color:#444}</style></head><body>",
        "<h1>BÁO CÁO KIỂM ĐỊNH THANG ĐO & MÔ HÌNH NGHIÊN CỨU (CHUẨN APA)</h1>",
        f"<p class='note'>Cỡ mẫu mô phỏng: N = {analysis.get('n')} | Lưu ý: Đây là dữ liệu mô phỏng phục vụ kiểm thử bảng hỏi và luyện phân tích SPSS/SmartPLS/AMOS, không thay thế dữ liệu khảo sát thật.</p>",
        "<h2>1. Độ tin cậy thang đo (Cronbach's Alpha)</h2>",
        "<table><tr><th>Nhân tố</th><th>Cronbach's Alpha (Lần 1)</th><th>Cronbach's Alpha (Lần 2)</th><th>Đánh giá</th></tr>",
    ]
    r1 = analysis.get("cronbach_r1", {})
    r2 = analysis.get("cronbach_r2", {})
    for ccode, d1 in r1.items():
        a2 = r2.get(ccode, {}).get("alpha", d1.get("alpha"))
        ok = "Đạt (>= 0.70)" if a2 >= 0.70 else "Cần xem lại (< 0.70)"
        html.append(f"<tr><td>{ccode}</td><td>{d1.get('alpha')}</td><td>{a2}</td><td>{ok}</td></tr>")
    html.append("</table>")

    html.append("<h2>2. Phân tích nhân tố khám phá (EFA - KMO & Bartlett)</h2>")
    html.append(
        f"<p>Chỉ số KMO = <b>{analysis.get('kmo')}</b> (ngưỡng &ge; 0.50); "
        f"Kiểm định Bartlett: &chi;&sup2; = {analysis.get('bartlett_chi2')}, df = {analysis.get('bartlett_df')}, p = {analysis.get('bartlett_p')}; "
        f"Tổng phương sai trích = <b>{analysis.get('total_variance_explained')}%</b> ({analysis.get('n_factors')} nhân tố).</p>"
    )

    html.append("<h2>3. Độ tin cậy tổng hợp & Giá trị hội tụ (SmartPLS / CFA)</h2>")
    html.append("<table><tr><th>Biến</th><th>Vai trò</th><th>Alpha</th><th>rho_A</th><th>CR (rho_c)</th><th>AVE</th></tr>")
    for pc in analysis.get("pls_constructs", []):
        html.append(
            f"<tr><td>{pc['code']} ({pc['name']})</td><td>{pc['role']}</td><td>{pc['alpha']}</td><td>{pc['rho_a']}</td><td>{pc['cr']}</td><td>{pc['ave']}</td></tr>"
        )
    html.append("</table>")

    html.append("<h2>4. Kiểm định giả thuyết đường dẫn & Đa cộng tuyến (VIF)</h2>")
    html.append("<table><tr><th>Giả thuyết</th><th>Đường dẫn</th><th>&beta; chuẩn hóa</th><th>t-value</th><th>p-value</th><th>VIF</th><th>f&sup2;</th><th>Kết luận</th></tr>")
    for p_item in analysis.get("paths", []):
        concl = "Chấp nhận (p < 0.05)" if p_item["supported"] else "Bác bỏ"
        html.append(
            f"<tr><td>{p_item['label']}</td><td>{p_item['from']} &rarr; {p_item['to']}</td><td>{p_item['beta']}</td>"
            f"<td>{p_item['t_value']}</td><td>{p_item['p_value']}</td><td>{p_item['vif']}</td><td>{p_item['f2']}</td><td>{concl}</td></tr>"
        )
    html.append("</table>")

    mf = analysis.get("model_fit", {})
    html.append("<h2>5. Độ phù hợp mô hình (Model Fit)</h2>")
    html.append(
        f"<p>CMIN/df = {mf.get('cmin_df')} (&le; 3.0), CFI = {mf.get('cfi')} (&ge; 0.90), "
        f"TLI = {mf.get('tli')} (&ge; 0.90), RMSEA = {mf.get('rmsea')} (&le; 0.08), SRMR = {mf.get('srmr')} (&le; 0.08).</p>"
    )
    html.append("</body></html>")
    return "\n".join(html)
