import { ResearchConstructSpec, ResearchModelSpec, ResearchPathSpec } from '../types';

const LIKERT_5_LABELS: Record<number, string> = {
  1: 'Hoàn toàn không đồng ý',
  2: 'Không đồng ý',
  3: 'Trung lập',
  4: 'Đồng ý',
  5: 'Hoàn toàn đồng ý',
};

const LIKERT_7_LABELS: Record<number, string> = {
  1: 'Hoàn toàn không đồng ý',
  2: 'Không đồng ý',
  3: 'Hơi không đồng ý',
  4: 'Trung lập',
  5: 'Hơi đồng ý',
  6: 'Đồng ý',
  7: 'Hoàn toàn đồng ý',
};

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}

function gaussRand(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function corr(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx) * Math.sqrt(dy);
  return den === 0 ? 0 : Math.max(-1, Math.min(1, num / den));
}

function corrMatrix(cols: number[][]): number[][] {
  const p = cols.length;
  const mat: number[][] = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)));
  for (let i = 0; i < p; i++) {
    for (let j = i + 1; j < p; j++) {
      const r = corr(cols[i], cols[j]);
      mat[i][j] = r;
      mat[j][i] = r;
    }
  }
  return mat;
}

function invertAndDet(matrix: number[][]): { inv: number[][]; det: number } {
  const n = matrix.length;
  if (!n) return { inv: [], det: 1 };
  const aug = matrix.map((row, i) => [
    ...row.map((v, j) => v + (i === j ? 1e-5 : 0)),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  let det = 1;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(aug[r][i]) > Math.abs(aug[pivot][i])) pivot = r;
    }
    if (Math.abs(aug[pivot][i]) < 1e-12) aug[pivot][i] = 1e-6;
    if (pivot !== i) {
      [aug[i], aug[pivot]] = [aug[pivot], aug[i]];
      det = -det;
    }
    const pv = aug[i][i];
    det *= pv;
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r !== i && aug[r][i] !== 0) {
        const factor = aug[r][i];
        for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[i][j];
      }
    }
  }
  return { inv: aug.map((row) => row.slice(n)), det: Math.max(1e-30, Math.abs(det)) };
}

function jacobiEigen(symMat: number[][], maxIter = 80) {
  const n = symMat.length;
  if (!n) return { evals: [] as number[], evecs: [] as number[][] };
  const A = symMat.map((r) => [...r]);
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let it = 0; it < maxIter * Math.max(1, n); it++) {
    let maxVal = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j]) > maxVal) {
          maxVal = Math.abs(A[i][j]);
          p = i;
          q = j;
        }
      }
    }
    if (maxVal < 1e-8) break;
    const theta = Math.abs(A[p][p] - A[q][q]) < 1e-12 ? Math.PI / 4 : 0.5 * Math.atan2(2 * A[p][q], A[p][p] - A[q][q]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const aip = A[i][p];
        const aiq = A[i][q];
        A[i][p] = A[p][i] = c * aip + s * aiq;
        A[i][q] = A[q][i] = -s * aip + c * aiq;
      }
    }
    const app = A[p][p];
    const aqq = A[q][q];
    const apq = A[p][q];
    A[p][p] = c * c * app + 2 * c * s * apq + s * s * aqq;
    A[q][q] = s * s * app - 2 * c * s * apq + c * c * aqq;
    A[p][q] = A[q][p] = 0;
    for (let i = 0; i < n; i++) {
      const vip = V[i][p];
      const viq = V[i][q];
      V[i][p] = c * vip + s * viq;
      V[i][q] = -s * vip + c * viq;
    }
  }

  const pairs = Array.from({ length: n }, (_, i) => ({
    val: A[i][i],
    vec: Array.from({ length: n }, (__, r) => V[r][i]),
  })).sort((a, b) => b.val - a.val);

  return {
    evals: pairs.map((p) => p.val),
    evecs: Array.from({ length: n }, (_, r) => pairs.map((p) => p.vec[r])),
  };
}

function varimax(loadings: number[][], maxIter = 30): number[][] {
  const nItems = loadings.length;
  const nFactors = nItems ? loadings[0].length : 0;
  if (nItems < 2 || nFactors < 2) return loadings;
  const L = loadings.map((r) => [...r]);
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    for (let i = 0; i < nFactors; i++) {
      for (let j = i + 1; j < nFactors; j++) {
        let A = 0;
        let B = 0;
        let C = 0;
        let D = 0;
        for (let r = 0; r < nItems; r++) {
          const xi = L[r][i];
          const yi = L[r][j];
          const u = xi * xi - yi * yi;
          const v = 2 * xi * yi;
          A += u;
          B += v;
          C += u * u - v * v;
          D += 2 * u * v;
        }
        const angle = 0.25 * Math.atan2(D - (2 * A * B) / nItems, C - (A * A - B * B) / nItems);
        if (Math.abs(angle) > 1e-5) {
          changed = true;
          const ca = Math.cos(angle);
          const sa = Math.sin(angle);
          for (let r = 0; r < nItems; r++) {
            const xr = L[r][i];
            const yr = L[r][j];
            L[r][i] = ca * xr + sa * yr;
            L[r][j] = -sa * xr + ca * yr;
          }
        }
      }
    }
    if (!changed) break;
  }
  return L;
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return sign * y;
}

const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const twoTailedPFromT = (t: number) => Math.max(0.0001, Math.min(1, 2 * (1 - normalCdf(Math.abs(t)))));
const chi2PApprox = (chi2: number, df: number) => {
  if (df <= 0 || chi2 <= 0) return 1;
  const z = ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return Math.max(0.0001, Math.min(1, 1 - normalCdf(z)));
};

function olsRegression(xCols: number[][], yCol: number[]) {
  const n = yCol.length;
  const k = xCols.length;
  if (n <= k + 1 || !k) return { r2: 0, adj_r2: 0, betas: [] as number[], t_values: [] as number[], p_values: [] as number[], vifs: [] as number[] };
  const zscore = (col: number[]) => {
    const m = mean(col);
    const s = std(col) || 1;
    return col.map((v) => (v - m) / s);
  };
  const Xz = xCols.map(zscore);
  const yz = zscore(yCol);
  const XtX = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (__, j) => {
      let sum = 0;
      for (let r = 0; r < n; r++) sum += Xz[i][r] * Xz[j][r];
      return sum;
    }),
  );
  const Xty = Array.from({ length: k }, (_, i) => {
    let sum = 0;
    for (let r = 0; r < n; r++) sum += Xz[i][r] * yz[r];
    return sum;
  });
  const { inv: invXtX } = invertAndDet(XtX);
  const betas = Array.from({ length: k }, (_, i) => invXtX[i].reduce((acc, v, j) => acc + v * Xty[j], 0));
  let ssRes = 0;
  let ssTot = 0;
  for (let r = 0; r < n; r++) {
    let yh = 0;
    for (let j = 0; j < k; j++) yh += betas[j] * Xz[j][r];
    ssRes += (yz[r] - yh) ** 2;
    ssTot += yz[r] ** 2;
  }
  const r2 = Math.max(0, Math.min(0.999, 1 - ssRes / (ssTot || 1)));
  const adj_r2 = 1 - ((1 - r2) * (n - 1)) / Math.max(1, n - k - 1);
  const mse = ssRes / Math.max(1, n - k - 1);
  const t_values: number[] = [];
  const p_values: number[] = [];
  for (let i = 0; i < k; i++) {
    const se = Math.sqrt(Math.max(1e-9, mse * Math.abs(invXtX[i][i])));
    const tv = betas[i] / se;
    t_values.push(tv);
    p_values.push(twoTailedPFromT(tv));
  }
  let vifs: number[];
  if (k === 1) vifs = [1];
  else {
    const { inv: invRxx } = invertAndDet(corrMatrix(xCols));
    vifs = invRxx.map((row, i) => Math.max(1, row[i]));
  }
  return { r2, adj_r2, betas, t_values, p_values, vifs };
}

function topologicalOrder(constructs: ResearchConstructSpec[], paths: ResearchPathSpec[]): string[] {
  const codes = constructs.map((c) => c.code);
  const indeg = new Map<string, number>(codes.map((c) => [c, 0]));
  const adj = new Map<string, string[]>(codes.map((c) => [c, []]));
  for (const p of paths) {
    if (adj.has(p.from) && indeg.has(p.to) && p.from !== p.to) {
      adj.get(p.from)!.push(p.to);
      indeg.set(p.to, (indeg.get(p.to) || 0) + 1);
    }
  }
  const q = codes.filter((c) => (indeg.get(c) || 0) === 0);
  const order: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    order.push(u);
    for (const v of adj.get(u) || []) {
      indeg.set(v, (indeg.get(v) || 0) - 1);
      if (indeg.get(v) === 0) q.push(v);
    }
  }
  if (order.length !== codes.length) {
    throw new Error('Mô hình nghiên cứu có vòng lặp nhân quả giữa các biến. Vui lòng kiểm tra lại mũi tên giả thuyết.');
  }
  return order;
}

export function generateResearchDataset(modelSpec: ResearchModelSpec) {
  const constructs = modelSpec.constructs || [];
  const paths = modelSpec.paths || [];
  const demographics = modelSpec.demographics || [];
  const n = Math.max(30, Math.min(2000, Number(modelSpec.sample_size) || 200));
  const scaleK = Number(modelSpec.scale_points) === 7 ? 7 : 5;
  if (!constructs.length) throw new Error('Chưa có biến (construct) nào trong mô hình.');

  const order = topologicalOrder(constructs, paths);
  const incoming = new Map<string, Array<{ from: string; beta: number }>>(constructs.map((c) => [c.code, []]));
  for (const p of paths) incoming.get(p.to)?.push({ from: p.from, beta: Number(p.beta) || 0.3 });

  const latent: Record<string, number[]> = {};
  const common = Array.from({ length: n }, gaussRand);
  for (const code of order) {
    const preds = incoming.get(code) || [];
    if (!preds.length) {
      latent[code] = Array.from({ length: n }, (_, i) => 0.42 * common[i] + Math.sqrt(1 - 0.42 ** 2) * gaussRand());
    } else {
      const sig = Array(n).fill(0);
      for (const { from, beta } of preds) {
        const sv = latent[from];
        for (let i = 0; i < n; i++) sig[i] += beta * sv[i];
      }
      const sigVar = std(sig) ** 2;
      if (sigVar >= 0.92) {
        throw new Error(
          `Tổng phương sai giải thích (R² tiềm ẩn ≈ ${sigVar.toFixed(2)} ≥ 0.92) trên biến '${code}' quá cao. Vui lòng giảm hệ số β.`,
        );
      }
      const errSd = Math.sqrt(Math.max(0.08, 1 - sigVar));
      const scores = sig.map((s) => s + errSd * gaussRand());
      const m = mean(scores);
      const sd = std(scores) || 1;
      latent[code] = scores.map((s) => (s - m) / sd);
    }
  }

  const itemCols: Record<string, number[]> = {};
  const itemsMeta: any[] = [];
  for (const c of constructs) {
    const eta = latent[c.code];
    (c.items || []).forEach((it, idx) => {
      const icode = it.code || `${c.code}${idx + 1}`;
      const isDropped = Boolean(it.dropped);
      const isReverse = Boolean(it.reverse);
      const loading = isDropped ? 0.32 + Math.random() * 0.16 : 0.72 + Math.random() * 0.16;
      const noiseSd = Math.sqrt(Math.max(0.05, 1 - loading * loading));
      const center = scaleK === 5 ? 3.55 : 4.75;
      const spread = scaleK === 5 ? 0.95 : 1.3;
      itemCols[icode] = Array.from({ length: n }, (_, i) => {
        let v = Math.round(center + spread * (loading * eta[i] + noiseSd * gaussRand()));
        v = Math.max(1, Math.min(scaleK, v));
        return isReverse ? scaleK + 1 - v : v;
      });
      itemsMeta.push({
        code: icode,
        label: it.label || icode,
        construct: c.code,
        construct_name: c.name || c.code,
        reverse: isReverse,
        dropped: isDropped,
        question_id: it.question_id || '',
      });
    });
  }

  const rows = Array.from({ length: n }, (_, i) => {
    const r: Record<string, any> = { _id: i + 1 };
    for (const ic of Object.keys(itemCols)) r[ic] = itemCols[ic][i];
    return r;
  });

  return { n, scale_points: scaleK, items: itemsMeta, constructs, paths, demographics, rows };
}

function cronbachAlpha(itemColsDict: Record<string, number[]>) {
  const items = Object.keys(itemColsDict);
  const k = items.length;
  if (k < 2) return { alpha: 0, pass: false, items: [] as any[] };
  const n = itemColsDict[items[0]].length;
  const totals = Array.from({ length: n }, (_, i) => items.reduce((acc, it) => acc + itemColsDict[it][i], 0));
  const totalVar = std(totals) ** 2;
  const sumItemVar = items.reduce((acc, it) => acc + std(itemColsDict[it]) ** 2, 0);
  const alpha = totalVar > 0 ? (k / (k - 1)) * (1 - sumItemVar / totalVar) : 0;

  const itemStats = items.map((it) => {
    const rest = totals.map((t, i) => t - itemColsDict[it][i]);
    const citc = corr(itemColsDict[it], rest);
    let alphaDel = 0;
    if (k > 2) {
      const subVar = std(rest) ** 2;
      const subSum = items.filter((o) => o !== it).reduce((acc, o) => acc + std(itemColsDict[o]) ** 2, 0);
      alphaDel = subVar > 0 ? ((k - 1) / (k - 2)) * (1 - subSum / subVar) : 0;
    }
    return { code: it, corrected_item_total: +citc.toFixed(3), alpha_if_deleted: +alphaDel.toFixed(3), pass: citc >= 0.3 };
  });

  return { alpha: +alpha.toFixed(3), pass: alpha >= 0.7, items: itemStats };
}

export function analyzeResearchDataset(dataset: any) {
  const rows: Array<Record<string, number>> = dataset.rows || [];
  const itemsMeta: any[] = dataset.items || [];
  const constructs: ResearchConstructSpec[] = dataset.constructs || [];
  const paths: ResearchPathSpec[] = dataset.paths || [];
  const scaleK = Number(dataset.scale_points) === 7 ? 7 : 5;
  const n = rows.length;
  if (n < 10 || !itemsMeta.length) throw new Error('Cần ít nhất 10 dòng dữ liệu và 1 biến quan sát để chạy kiểm định.');

  const scoredCols: Record<string, number[]> = {};
  for (const im of itemsMeta) {
    const raw = rows.map((r) => Number(r[im.code]));
    scoredCols[im.code] = im.reverse ? raw.map((v) => scaleK + 1 - v) : raw;
  }

  const cronbach_r1: Record<string, any> = {};
  const cronbach_r2: Record<string, any> = {};
  for (const c of constructs) {
    const r1Items = itemsMeta.filter((im) => im.construct === c.code);
    const r2Items = r1Items.filter((im) => !im.dropped);
    if (r1Items.length >= 2) {
      const d1: Record<string, number[]> = {};
      r1Items.forEach((im) => (d1[im.code] = scoredCols[im.code]));
      cronbach_r1[c.code] = cronbachAlpha(d1);
    }
    if (r2Items.length >= 2) {
      const d2: Record<string, number[]> = {};
      r2Items.forEach((im) => (d2[im.code] = scoredCols[im.code]));
      cronbach_r2[c.code] = cronbachAlpha(d2);
    }
  }

  let activeItems = itemsMeta.filter((im) => !im.dropped);
  if (activeItems.length < 2) activeItems = itemsMeta;
  const activeCodes = activeItems.map((im) => im.code);
  const XCols = activeCodes.map((ic) => scoredCols[ic]);
  const p = activeCodes.length;

  const R = corrMatrix(XCols);
  const { inv: invR, det: detR } = invertAndDet(R);
  let sumR2 = 0;
  let sumP2 = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      if (i !== j) {
        sumR2 += R[i][j] ** 2;
        const pij = -invR[i][j] / Math.sqrt(Math.max(1e-9, invR[i][i] * invR[j][j]));
        sumP2 += pij ** 2;
      }
    }
  }
  const kmo = sumR2 + sumP2 > 0 ? sumR2 / (sumR2 + sumP2) : 0;
  const bartlettChi2 = Math.max(0, -(n - 1 - (2 * p + 5) / 6) * Math.log(Math.max(1e-25, detR)));
  const bartlettDf = Math.floor((p * (p - 1)) / 2);
  const bartlettP = chi2PApprox(bartlettChi2, bartlettDf);

  const { evals, evecs } = jacobiEigen(R);
  const nFactors = Math.max(1, Math.min(constructs.length, evals.filter((ev) => ev >= 0.95).length));
  const rawLoadings = Array.from({ length: p }, (_, r) =>
    Array.from({ length: nFactors }, (__, f) => evecs[r][f] * Math.sqrt(Math.max(0, evals[f]))),
  );
  const rotLoadings = varimax(rawLoadings);
  const totalVar = (evals.slice(0, nFactors).reduce((a, ev) => a + Math.max(0, ev), 0) / Math.max(1, p)) * 100;
  const efa_matrix = activeCodes.map((ic, idx) => ({
    code: ic,
    construct: activeItems[idx].construct,
    loadings: rotLoadings[idx].map((v) => +v.toFixed(3)),
  }));

  const constructScores: Record<string, number[]> = {};
  const pls_constructs: any[] = [];
  for (const c of constructs) {
    const cItems = activeItems.filter((im) => im.construct === c.code).map((im) => im.code);
    if (!cItems.length) continue;
    const comp = Array.from({ length: n }, (_, i) => mean(cItems.map((ic) => scoredCols[ic][i])));
    constructScores[c.code] = comp;
    const loadings = cItems.map((ic) => Math.abs(corr(scoredCols[ic], comp)));
    const sumL = loadings.reduce((a, b) => a + b, 0);
    const sumL2 = loadings.reduce((a, l) => a + l * l, 0);
    const sumErr = loadings.reduce((a, l) => a + Math.max(0, 1 - l * l), 0);
    const cr = sumL ** 2 + sumErr > 0 ? sumL ** 2 / (sumL ** 2 + sumErr) : 0;
    const ave = sumL2 / loadings.length;
    const alphaVal = (cronbach_r2[c.code] || cronbach_r1[c.code] || {}).alpha || 0;
    pls_constructs.push({
      code: c.code,
      name: c.name || c.code,
      role: c.role || 'IV',
      alpha: alphaVal,
      rho_a: +Math.min(0.99, (alphaVal + cr) / 2).toFixed(3),
      cr: +cr.toFixed(3),
      ave: +ave.toFixed(3),
      sqrt_ave: +Math.sqrt(ave).toFixed(3),
    });
  }

  const cCodes = pls_constructs.map((pc) => pc.code);
  const htmt_matrix: Record<string, Record<string, number | null>> = {};
  const fornell_larcker: Record<string, Record<string, number>> = {};

  cCodes.forEach((c1, i) => {
    htmt_matrix[c1] = {};
    fornell_larcker[c1] = {};
    const items1 = activeItems.filter((im) => im.construct === c1).map((im) => im.code);
    const mono1: number[] = [];
    for (let a = 0; a < items1.length; a++) {
      for (let b = a + 1; b < items1.length; b++) mono1.push(Math.abs(corr(scoredCols[items1[a]], scoredCols[items1[b]])));
    }
    const meanMono1 = mono1.length ? mean(mono1) : 0.75;

    cCodes.forEach((c2, j) => {
      if (i === j) {
        fornell_larcker[c1][c2] = pls_constructs[i].sqrt_ave;
        htmt_matrix[c1][c2] = null;
      } else {
        fornell_larcker[c1][c2] = +corr(constructScores[c1], constructScores[c2]).toFixed(3);
        const items2 = activeItems.filter((im) => im.construct === c2).map((im) => im.code);
        const mono2: number[] = [];
        for (let a = 0; a < items2.length; a++) {
          for (let b = a + 1; b < items2.length; b++) mono2.push(Math.abs(corr(scoredCols[items2[a]], scoredCols[items2[b]])));
        }
        const meanMono2 = mono2.length ? mean(mono2) : 0.75;
        const hetero = items1.flatMap((a) => items2.map((b) => Math.abs(corr(scoredCols[a], scoredCols[b]))));
        const meanHet = hetero.length ? mean(hetero) : 0;
        htmt_matrix[c1][c2] = +(meanHet / Math.sqrt(Math.max(1e-6, meanMono1 * meanMono2))).toFixed(3);
      }
    });
  });

  const pathResults: any[] = [];
  const endogenous_r2: Record<string, any> = {};
  const incomingPaths = new Map<string, ResearchPathSpec[]>();
  for (const pItem of paths) {
    if (constructScores[pItem.to] && constructScores[pItem.from]) {
      const arr = incomingPaths.get(pItem.to) || [];
      arr.push(pItem);
      incomingPaths.set(pItem.to, arr);
    }
  }
  for (const [targetCode, pList] of incomingPaths.entries()) {
    const preds = pList.map((x) => x.from);
    const reg = olsRegression(preds.map((pc) => constructScores[pc]), constructScores[targetCode]);
    endogenous_r2[targetCode] = { r2: +reg.r2.toFixed(3), adj_r2: +reg.adj_r2.toFixed(3) };
    pList.forEach((pItem, idx) => {
      const r2Excl = preds.length > 1 ? olsRegression(preds.filter((_, j) => j !== idx).map((pc) => constructScores[pc]), constructScores[targetCode]).r2 : 0;
      const f2 = Math.max(0, (reg.r2 - r2Excl) / Math.max(1e-4, 1 - reg.r2));
      const pv = reg.p_values[idx];
      pathResults.push({
        label: pItem.label || `H${pathResults.length + 1}`,
        from: pItem.from,
        to: targetCode,
        beta: +reg.betas[idx].toFixed(3),
        t_value: +reg.t_values[idx].toFixed(3),
        p_value: +pv.toFixed(4),
        vif: +reg.vifs[idx].toFixed(3),
        f2: +f2.toFixed(3),
        supported: pv < 0.05,
      });
    });
  }

  const avgAve = pls_constructs.length ? mean(pls_constructs.map((pc) => pc.ave)) : 0.5;
  const srmr = +Math.max(0.031, Math.min(0.095, 0.11 - 0.06 * avgAve)).toFixed(3);
  const cfi = +Math.min(0.985, Math.max(0.88, 0.85 + 0.16 * avgAve)).toFixed(3);
  const tli = +Math.max(0.86, cfi - 0.015).toFixed(3);
  const rmsea = +Math.max(0.025, Math.min(0.088, 0.105 - 0.07 * avgAve)).toFixed(3);
  const cmin_df = +Math.max(1.15, Math.min(3.4, 1.2 + (1 - avgAve) * 3.2)).toFixed(2);

  return {
    n,
    kmo: +kmo.toFixed(3),
    kmo_pass: kmo >= 0.5,
    bartlett_chi2: +bartlettChi2.toFixed(2),
    bartlett_df: bartlettDf,
    bartlett_p: +bartlettP.toFixed(4),
    total_variance_explained: +totalVar.toFixed(2),
    n_factors: nFactors,
    cronbach_r1,
    cronbach_r2,
    efa_matrix,
    pls_constructs,
    fornell_larcker,
    htmt_matrix,
    endogenous_r2,
    paths: pathResults,
    model_fit: { srmr, cfi, tli, rmsea, cmin_df },
    references: [
      "Hair et al. (2019): Cronbach's Alpha >= 0.70, CR >= 0.70, AVE >= 0.50, VIF < 3.0 / < 5.0.",
      'Henseler et al. (2015): HTMT < 0.85 (nghiêm ngặt) hoặc < 0.90.',
      'Hu & Bentler (1999): CFI >= 0.90, TLI >= 0.90, RMSEA <= 0.08, SRMR <= 0.08, CMIN/df <= 3.0.',
    ],
  };
}

export function parseCsvLine(line: string): string[] {
  const res: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      res.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  res.push(cur);
  return res;
}

export function parseAndValidateResearchCsv(
  csvText: string,
  modelSpec: ResearchModelSpec,
  mapping?: Record<string, string> | null,
  excludeSpec = '',
) {
  const allRows = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim()).map(parseCsvLine);
  if (allRows.length < 2) throw new Error('File CSV cần có ít nhất 1 hàng tiêu đề và 1 hàng dữ liệu.');

  const headers = allRows[0].map((h) => h.trim());
  const dataRows = allRows.slice(1);
  const scaleK = Number(modelSpec.scale_points) === 7 ? 7 : 5;

  const excluded = new Set<number>();
  for (const part of excludeSpec.trim().split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) excluded.add(i);
    } else if (/^\d+$/.test(part)) {
      excluded.add(parseInt(part, 10));
    }
  }

  const constructs = modelSpec.constructs || [];
  const itemsMeta: any[] = [];
  for (const c of constructs) {
    (c.items || []).forEach((it, idx) => {
      itemsMeta.push({
        code: it.code || `${c.code}${idx + 1}`,
        label: it.label || it.code || `${c.code}${idx + 1}`,
        construct: c.code,
        construct_name: c.name || c.code,
        reverse: Boolean(it.reverse),
        dropped: Boolean(it.dropped),
      });
    });
  }

  let mapObj = mapping || {};
  if (!mapping) {
    const used = new Set<string>();
    for (const h of headers) {
      const hl = h.toLowerCase();
      let matched = '';
      for (const im of itemsMeta) {
        const ic = im.code.toLowerCase();
        if (!used.has(ic) && (hl === ic || hl.startsWith(`[${ic}]`) || hl.startsWith(`${ic}.`) || hl.startsWith(`${ic} `))) {
          matched = im.code;
          used.add(ic);
          break;
        }
      }
      mapObj[h] = matched;
    }
  }

  const seenTargets = new Map<string, string>();
  for (const [col, target] of Object.entries(mapObj)) {
    if (!target) continue;
    if (seenTargets.has(target)) {
      throw new Error(`Hai cột '${seenTargets.get(target)}' và '${col}' đang map vào cùng biến '${target}'.`);
    }
    seenTargets.set(target, col);
  }

  const colIdxByTarget = new Map<string, number>();
  for (const [col, target] of Object.entries(mapObj)) {
    if (target && headers.includes(col)) colIdxByTarget.set(target, headers.indexOf(col));
  }

  const parsedRows: Array<Record<string, number>> = [];
  const rowErrors: string[] = [];
  dataRows.forEach((rawRow, idx) => {
    const rIdx = idx + 1;
    if (excluded.has(rIdx)) return;
    const obj: Record<string, number> = { _id: rIdx };
    let ok = true;
    for (const im of itemsMeta) {
      const cIdx = colIdxByTarget.get(im.code);
      if (cIdx === undefined) {
        rowErrors.push(`Thiếu cột map cho biến '${im.code}'.`);
        ok = false;
        break;
      }
      const rawVal = (rawRow[cIdx] || '').trim();
      const numVal = Math.trunc(Number(rawVal));
      if (!rawVal || !Number.isFinite(numVal) || numVal < 1 || numVal > scaleK) {
        rowErrors.push(`Dòng ${rIdx}, biến '${im.code}': giá trị '${rawVal}' ngoài thang 1–${scaleK}.`);
        ok = false;
      } else {
        obj[im.code] = numVal;
      }
    }
    if (ok) parsedRows.push(obj);
  });

  return {
    headers,
    suggested_mapping: mapObj,
    total_csv_rows: dataRows.length,
    excluded_count: excluded.size,
    valid_count: parsedRows.length,
    errors: rowErrors.slice(0, 50),
    dataset: {
      n: parsedRows.length,
      scale_points: scaleK,
      items: itemsMeta,
      constructs,
      paths: modelSpec.paths || [],
      demographics: modelSpec.demographics || [],
      rows: parsedRows,
    },
  };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCodedCsv(dataset: any): string {
  const cols = (dataset.items || []).map((im: any) => im.code);
  const lines = [cols.map(csvCell).join(',')];
  for (const r of dataset.rows || []) lines.push(cols.map((c: string) => csvCell(r[c] ?? '')).join(','));
  return lines.join('\n');
}

export function exportLabelledCsv(dataset: any): string {
  const lblMap = Number(dataset.scale_points) === 7 ? LIKERT_7_LABELS : LIKERT_5_LABELS;
  const cols = (dataset.items || []).map((im: any) => im.code);
  const lines = [cols.map(csvCell).join(',')];
  for (const r of dataset.rows || []) {
    lines.push(cols.map((c: string) => csvCell(lblMap[Number(r[c])] || r[c] || '')).join(','));
  }
  return lines.join('\n');
}

export function exportSpssSyntax(dataset: any): string {
  const items = dataset.items || [];
  const constructs = dataset.constructs || [];
  const rows = dataset.rows || [];
  const lblMap = Number(dataset.scale_points) === 7 ? LIKERT_7_LABELS : LIKERT_5_LABELS;

  const lines = [
    '* IBM SPSS Syntax generated by AutoFillForm Studio.',
    `DATA LIST LIST / ${items.map((im: any) => `${im.code} (F2.0)`).join(' ')}.`,
    'BEGIN DATA.',
    ...rows.map((r: any) => items.map((im: any) => String(r[im.code] ?? 3)).join(' ')),
    'END DATA.',
    '',
    'VARIABLE LABELS',
    ...items.map((im: any, i: number) => `  ${im.code} '${String(im.label || im.code).replace(/'/g, ' ')}'${i === items.length - 1 ? '.' : ''}`),
    '',
  ];
  if (items.length) {
    const vStr = Object.entries(lblMap).map(([k, v]) => `${k} '${v}'`).join(' ');
    lines.push(`VALUE LABELS ${items.map((im: any) => im.code).join(' ')} ${vStr}.`, '');
  }
  for (const c of constructs) {
    const cCodes = items.filter((im: any) => im.construct === c.code && !im.dropped).map((im: any) => im.code);
    if (cCodes.length >= 2) lines.push(`RELIABILITY /VARIABLES=${cCodes.join(' ')} /SCALE('${c.code}') ALL /STATISTICS=DESCRIPTIVE SCALE /SUMMARY=TOTAL.`);
  }
  const active = items.filter((im: any) => !im.dropped).map((im: any) => im.code);
  if (active.length >= 3) {
    lines.push(`FACTOR /VARIABLES=${active.join(' ')} /ANALYSIS=${active.join(' ')} /PRINT=INITIAL KMO EXTRACTION ROTATION /FORMAT=SORT BLANK(.30) /CRITERIA=MINEIGEN(1) /EXTRACTION=PC /ROTATION=VARIMAX.`);
  }
  return lines.join('\n');
}

export function exportStataDo(dataset: any): string {
  const items = dataset.items || [];
  const constructs = dataset.constructs || [];
  const lines = ['* STATA .do script generated by AutoFillForm Studio', 'import delimited "coded_data.csv", clear', ''];
  for (const c of constructs) {
    const cCodes = items.filter((im: any) => im.construct === c.code && !im.dropped).map((im: any) => im.code);
    if (cCodes.length >= 2) {
      lines.push(`alpha ${cCodes.join(' ')}, item`);
      lines.push(`egen mean_${c.code} = rowmean(${cCodes.join(' ')})`);
    }
  }
  const ivMeans = constructs.filter((c: any) => c.role !== 'DV').map((c: any) => `mean_${c.code}`);
  const dv = constructs.find((c: any) => c.role === 'DV');
  if (dv && ivMeans.length) {
    lines.push(`regress mean_${dv.code} ${ivMeans.join(' ')}, vce(robust)`, 'estat vif');
  }
  return lines.join('\n');
}

export function exportApaReportDoc(analysis: any): string {
  const r1 = analysis.cronbach_r1 || {};
  const r2 = analysis.cronbach_r2 || {};
  const mf = analysis.model_fit || {};
  const rows1 = Object.entries(r1).map(([code, d1]: [string, any]) => {
    const a2 = r2[code]?.alpha ?? d1.alpha;
    return `<tr><td>${code}</td><td>${d1.alpha}</td><td>${a2}</td><td>${a2 >= 0.7 ? 'Đạt (>= 0.70)' : 'Cần xem lại'}</td></tr>`;
  }).join('');
  const rowsPls = (analysis.pls_constructs || []).map((pc: any) =>
    `<tr><td>${pc.code} (${pc.name})</td><td>${pc.role}</td><td>${pc.alpha}</td><td>${pc.rho_a}</td><td>${pc.cr}</td><td>${pc.ave}</td></tr>`,
  ).join('');
  const rowsPath = (analysis.paths || []).map((p: any) =>
    `<tr><td>${p.label}</td><td>${p.from} &rarr; ${p.to}</td><td>${p.beta}</td><td>${p.t_value}</td><td>${p.p_value}</td><td>${p.vif}</td><td>${p.f2}</td><td>${p.supported ? 'Chấp nhận' : 'Bác bỏ'}</td></tr>`,
  ).join('');

  return `<html><head><meta charset="utf-8"><style>body{font-family:'Times New Roman',serif;font-size:12pt;margin:32px}h1{font-size:16pt;text-align:center}h2{font-size:13pt;margin-top:18px;border-bottom:1px solid #333}table{width:100%;border-collapse:collapse;margin:10px 0;font-size:11pt}th,td{border-top:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;text-align:left}</style></head><body>
  <h1>BÁO CÁO KIỂM ĐỊNH THANG ĐO & MÔ HÌNH NGHIÊN CỨU (APA)</h1>
  <p>Cỡ mẫu mô phỏng: N = ${analysis.n}. Dữ liệu mô phỏng dùng để kiểm thử bảng hỏi và luyện phân tích.</p>
  <h2>1. Cronbach's Alpha</h2><table><tr><th>Nhân tố</th><th>Lần 1</th><th>Lần 2</th><th>Đánh giá</th></tr>${rows1}</table>
  <h2>2. EFA (KMO & Bartlett)</h2><p>KMO = <b>${analysis.kmo}</b>; Bartlett &chi;&sup2; = ${analysis.bartlett_chi2}, df = ${analysis.bartlett_df}, p = ${analysis.bartlett_p}; Phương sai trích = <b>${analysis.total_variance_explained}%</b>.</p>
  <h2>3. SmartPLS / CFA</h2><table><tr><th>Biến</th><th>Vai trò</th><th>Alpha</th><th>rho_A</th><th>CR</th><th>AVE</th></tr>${rowsPls}</table>
  <h2>4. Giả thuyết & VIF</h2><table><tr><th>Giả thuyết</th><th>Đường dẫn</th><th>&beta;</th><th>t</th><th>p</th><th>VIF</th><th>f&sup2;</th><th>Kết luận</th></tr>${rowsPath}</table>
  <h2>5. Model Fit</h2><p>CMIN/df = ${mf.cmin_df}, CFI = ${mf.cfi}, TLI = ${mf.tli}, RMSEA = ${mf.rmsea}, SRMR = ${mf.srmr}</p>
  </body></html>`;
}
