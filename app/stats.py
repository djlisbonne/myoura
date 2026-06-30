"""Rigorous statistics engine — pure, deterministic, no LLM in the loop.

Every result reports n, an effect size, and a confidence interval. Exploratory
multi-test scans are FDR-corrected (Benjamini–Hochberg). Day-series tests are
autocorrelation-aware (effective sample size), because consecutive days are not
independent. Permutation tests and bootstraps use fixed seeds so a report
regenerates identically. The numbers are meant to be interpreted by the user.

Inputs are daily series as ``[{"day": "YYYY-MM-DD", "value": float}, ...]``
(the shape returned by ``db.series``). Survey-derived variables share that shape.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np
from scipy import stats as sp

# Confounders worth checking before trusting any personal correlation. Surfaced
# in the UI as a standing checklist — not auto-controlled unless passed in.
CONFOUNDER_CHECKLIST = [
    "Day of week (weekday vs weekend behaviour)",
    "Alcohol intake", "Illness / infection", "Travel / timezone change",
    "Late or large meals", "Menstrual cycle phase", "Hard training the prior day",
    "Seasonal / ambient temperature", "Medication or supplement changes",
]

MIN_N = 10  # below this, results are flagged low-power


# --- alignment & cleaning ---------------------------------------------------

def _as_map(series: Sequence[dict[str, Any]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for p in series:
        v = p.get("value")
        if v is not None:
            out[p["day"]] = float(v)
    return out


def align(*series: Sequence[dict[str, Any]]) -> tuple[list[str], list[np.ndarray]]:
    """Inner-join any number of daily series on common days (sorted)."""
    maps = [_as_map(s) for s in series]
    if not maps:
        return [], []
    common = set(maps[0])
    for m in maps[1:]:
        common &= set(m)
    days = sorted(common)
    cols = [np.array([m[d] for d in days], dtype=float) for m in maps]
    return days, cols


def _finite_pair(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mask = np.isfinite(x) & np.isfinite(y)
    return x[mask], y[mask]


# --- descriptives & reference ranges ----------------------------------------

def describe(series: Sequence[dict[str, Any]]) -> dict[str, Any]:
    vals = np.array([p["value"] for p in series if p.get("value") is not None],
                    dtype=float)
    vals = vals[np.isfinite(vals)]
    n = int(vals.size)
    if n == 0:
        return {"n": 0}
    q25, q50, q75 = np.percentile(vals, [25, 50, 75])
    mad = float(np.median(np.abs(vals - q50)))
    return {
        "n": n,
        "mean": float(np.mean(vals)), "std": float(np.std(vals, ddof=1)) if n > 1 else 0.0,
        "median": float(q50), "iqr": float(q75 - q25), "mad": mad,
        "q25": float(q25), "q75": float(q75),
        "min": float(np.min(vals)), "max": float(np.max(vals)),
    }


def reference_range(series: Sequence[dict[str, Any]], window: int = 28,
                    k: float = 2.0) -> list[dict[str, Any]]:
    """Rolling robust baseline: median ± k·(1.4826·MAD) over a trailing window."""
    s = sorted(series, key=lambda p: p["day"])
    vals = [p.get("value") for p in s]
    out: list[dict[str, Any]] = []
    for i, p in enumerate(s):
        lo_i = max(0, i - window + 1)
        w = np.array([v for v in vals[lo_i:i + 1] if v is not None], dtype=float)
        rec: dict[str, Any] = {"day": p["day"], "value": p.get("value")}
        if w.size >= 5:
            med = float(np.median(w))
            mad = float(np.median(np.abs(w - med))) * 1.4826
            rec["baseline"] = med
            rec["low"] = med - k * mad
            rec["high"] = med + k * mad
            if p.get("value") is not None and mad > 0:
                rec["robust_z"] = (float(p["value"]) - med) / mad
        out.append(rec)
    return out


# --- autocorrelation --------------------------------------------------------

def autocorr(x: np.ndarray, lag: int = 1) -> float:
    x = x[np.isfinite(x)]
    if x.size <= lag + 1:
        return 0.0
    a, b = x[:-lag], x[lag:]
    a = a - a.mean()
    b = b - b.mean()
    denom = np.sqrt((a ** 2).sum() * (b ** 2).sum())
    return float((a * b).sum() / denom) if denom > 0 else 0.0


def effective_n(x: np.ndarray, y: np.ndarray) -> float:
    """AR(1)-adjusted effective sample size for two autocorrelated series."""
    n = x.size
    if n < 4:
        return float(n)
    rx, ry = autocorr(x, 1), autocorr(y, 1)
    factor = (1 - rx * ry) / (1 + rx * ry) if (1 + rx * ry) != 0 else 1.0
    return float(np.clip(n * factor, 2, n))


# --- correlation ------------------------------------------------------------

def _fisher_ci(r: float, n: float, alpha: float = 0.05, se_factor: float = 1.0):
    if n <= 3 or abs(r) >= 1.0:
        return (float("nan"), float("nan"))
    z = np.arctanh(r)
    se = se_factor / np.sqrt(n - 3)
    crit = sp.norm.ppf(1 - alpha / 2)
    return float(np.tanh(z - crit * se)), float(np.tanh(z + crit * se))


def correlate(x_series, y_series, method: str = "spearman", alpha: float = 0.05
              ) -> dict[str, Any]:
    days, cols = align(x_series, y_series)
    if len(cols) < 2:
        return {"n": 0, "method": method}
    x, y = _finite_pair(cols[0], cols[1])
    n = x.size
    if n < 4:
        return {"n": int(n), "method": method, "low_power": True}
    if method == "pearson":
        r, p = sp.pearsonr(x, y)
        lo, hi = _fisher_ci(r, n, alpha)
    else:
        r, p = sp.spearmanr(x, y)
        lo, hi = _fisher_ci(r, n, alpha, se_factor=1.06)  # Bonett–Wright
    n_eff = effective_n(x, y)
    return {
        "method": method, "n": int(n), "n_effective": round(n_eff, 1),
        "r": float(r), "ci_low": lo, "ci_high": hi, "p": float(p),
        "direction": "positive" if r > 0 else "negative",
        "low_power": n < MIN_N,
        "autocorr_warning": n_eff < 0.7 * n,
    }


def partial_correlate(x_series, y_series, covar_series: list, alpha: float = 0.05
                      ) -> dict[str, Any]:
    """Pearson correlation of x,y after linearly removing covariates from both."""
    days, cols = align(x_series, y_series, *covar_series)
    if len(cols) < 3:
        return {"n": 0}
    x, y, Z = cols[0], cols[1], np.column_stack(cols[2:])
    mask = np.isfinite(x) & np.isfinite(y) & np.isfinite(Z).all(axis=1)
    x, y, Z = x[mask], y[mask], Z[mask]
    n = x.size
    if n < len(covar_series) + 4:
        return {"n": int(n), "low_power": True}
    A = np.column_stack([np.ones(n), Z])
    rx = x - A @ np.linalg.lstsq(A, x, rcond=None)[0]
    ry = y - A @ np.linalg.lstsq(A, y, rcond=None)[0]
    r, p = sp.pearsonr(rx, ry)
    lo, hi = _fisher_ci(r, n - Z.shape[1], alpha)
    return {"method": "partial_pearson", "n": int(n), "controlled_for": len(covar_series),
            "r": float(r), "ci_low": lo, "ci_high": hi, "p": float(p),
            "direction": "positive" if r > 0 else "negative", "low_power": n < MIN_N}


def lagged_correlation(x_series, y_series, max_lag: int = 3,
                       method: str = "spearman") -> list[dict[str, Any]]:
    """Correlate x(day) with y(day+lag) for lag in [-max_lag, max_lag]."""
    xmap, ymap = _as_map(x_series), _as_map(y_series)
    from datetime import date, timedelta
    out: list[dict[str, Any]] = []
    for lag in range(-max_lag, max_lag + 1):
        xv, yv = [], []
        for d, xval in xmap.items():
            try:
                d2 = (date.fromisoformat(d) + timedelta(days=lag)).isoformat()
            except ValueError:
                continue
            if d2 in ymap:
                xv.append(xval)
                yv.append(ymap[d2])
        if len(xv) >= 4:
            xa, ya = np.array(xv), np.array(yv)
            r, p = (sp.spearmanr(xa, ya) if method == "spearman"
                    else sp.pearsonr(xa, ya))
            out.append({"lag": lag, "n": len(xv), "r": float(r), "p": float(p)})
    return out


def bh_fdr(pvals: Sequence[float]) -> list[float]:
    """Benjamini–Hochberg q-values."""
    p = np.asarray(pvals, dtype=float)
    n = p.size
    if n == 0:
        return []
    order = np.argsort(p)
    ranked = p[order] * n / (np.arange(n) + 1)
    q = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n)
    out[order] = np.clip(q, 0, 1)
    return [float(v) for v in out]


def pairwise_scan(named: dict[str, list], method: str = "spearman",
                  alpha: float = 0.05) -> list[dict[str, Any]]:
    """All unique pairs of the named series, FDR-corrected across the scan."""
    keys = list(named)
    results: list[dict[str, Any]] = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            res = correlate(named[keys[i]], named[keys[j]], method, alpha)
            if res.get("n", 0) >= 4:
                res["a"], res["b"] = keys[i], keys[j]
                results.append(res)
    qs = bh_fdr([r["p"] for r in results])
    for r, q in zip(results, qs):
        r["q"] = q
        r["significant"] = q < alpha and not r.get("low_power")
    results.sort(key=lambda r: (r["q"], -abs(r["r"])))
    return results


# --- decomposition & anomalies ----------------------------------------------

def decompose(series: Sequence[dict[str, Any]], period: int = 7) -> dict[str, Any]:
    """Classical additive decomposition: centred-MA trend + weekly seasonal."""
    s = sorted(series, key=lambda p: p["day"])
    days = [p["day"] for p in s]
    x = np.array([p["value"] if p.get("value") is not None else np.nan for p in s])
    n = x.size
    if n < 2 * period:
        return {"days": days, "trend": None, "seasonal": None, "resid": None,
                "insufficient": True}
    # centred moving average
    trend = np.full(n, np.nan)
    half = period // 2
    for i in range(half, n - half):
        w = x[i - half:i + half + 1]
        if np.isfinite(w).sum() >= period - 1:
            trend[i] = np.nanmean(w)
    detr = x - trend
    seasonal = np.full(n, np.nan)
    for k in range(period):
        idx = np.arange(k, n, period)
        m = np.nanmean(detr[idx]) if np.isfinite(detr[idx]).any() else 0.0
        seasonal[idx] = m
    seasonal = seasonal - np.nanmean(seasonal)
    resid = x - trend - seasonal
    j = lambda a: [None if not np.isfinite(v) else float(v) for v in a]
    return {"days": days, "observed": j(x), "trend": j(trend),
            "seasonal": j(seasonal), "resid": j(resid)}


def anomalies(series: Sequence[dict[str, Any]], window: int = 28,
              z_thresh: float = 3.0) -> list[dict[str, Any]]:
    return [r for r in reference_range(series, window)
            if r.get("robust_z") is not None and abs(r["robust_z"]) >= z_thresh]


# --- group comparison & n-of-1 inference ------------------------------------

def _cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = a.size, b.size
    if na < 2 or nb < 2:
        return float("nan")
    sp_ = np.sqrt(((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2))
    return float((a.mean() - b.mean()) / sp_) if sp_ > 0 else 0.0


def compare_groups(a: Sequence[float], b: Sequence[float], n_perm: int = 10000,
                   seed: int = 0, alpha: float = 0.05) -> dict[str, Any]:
    """Two independent groups (e.g. intervention vs control days)."""
    a = np.array([v for v in a if v is not None], dtype=float)
    b = np.array([v for v in b if v is not None], dtype=float)
    a, b = a[np.isfinite(a)], b[np.isfinite(b)]
    na, nb = a.size, b.size
    if na < 3 or nb < 3:
        return {"n_a": int(na), "n_b": int(nb), "low_power": True}
    t, tp = sp.ttest_ind(a, b, equal_var=False)
    u, up = sp.mannwhitneyu(a, b, alternative="two-sided")
    d = _cohens_d(a, b)
    rank_biserial = 1 - 2 * u / (na * nb)

    rng = np.random.default_rng(seed)
    pooled = np.concatenate([a, b])
    obs = abs(a.mean() - b.mean())
    count = 0
    for _ in range(n_perm):
        rng.shuffle(pooled)
        if abs(pooled[:na].mean() - pooled[na:].mean()) >= obs:
            count += 1
    perm_p = (count + 1) / (n_perm + 1)

    # bootstrap CI for Cohen's d
    ds = np.empty(2000)
    for i in range(2000):
        ds[i] = _cohens_d(rng.choice(a, na), rng.choice(b, nb))
    d_lo, d_hi = np.nanpercentile(ds, [100 * alpha / 2, 100 * (1 - alpha / 2)])

    return {
        "n_a": int(na), "n_b": int(nb),
        "mean_a": float(a.mean()), "mean_b": float(b.mean()),
        "mean_diff": float(a.mean() - b.mean()),
        "welch_t": float(t), "welch_p": float(tp),
        "mannwhitney_u": float(u), "mannwhitney_p": float(up),
        "permutation_p": float(perm_p),
        "cohens_d": d, "d_ci_low": float(d_lo), "d_ci_high": float(d_hi),
        "rank_biserial": float(rank_biserial),
        "low_power": min(na, nb) < MIN_N,
        "significant": perm_p < alpha and min(na, nb) >= MIN_N,
    }


def paired_compare(before: Sequence[float], after: Sequence[float],
                   alpha: float = 0.05) -> dict[str, Any]:
    a = np.array(before, dtype=float)
    b = np.array(after, dtype=float)
    mask = np.isfinite(a) & np.isfinite(b)
    a, b = a[mask], b[mask]
    n = a.size
    if n < 3:
        return {"n": int(n), "low_power": True}
    diff = b - a
    t, tp = sp.ttest_rel(a, b)
    try:
        w, wp = sp.wilcoxon(a, b)
    except ValueError:
        w, wp = float("nan"), float("nan")
    se = diff.std(ddof=1) / np.sqrt(n)
    crit = sp.t.ppf(1 - alpha / 2, n - 1)
    dz = diff.mean() / diff.std(ddof=1) if diff.std(ddof=1) > 0 else 0.0
    return {"n": int(n), "mean_diff": float(diff.mean()),
            "ci_low": float(diff.mean() - crit * se), "ci_high": float(diff.mean() + crit * se),
            "paired_t": float(t), "paired_p": float(tp),
            "wilcoxon_p": float(wp), "cohens_dz": float(dz),
            "low_power": n < MIN_N, "significant": tp < alpha and n >= MIN_N}


def nof1_compare(outcome_series, group_days_a: set[str], group_days_b: set[str],
                 n_perm: int = 10000, seed: int = 0) -> dict[str, Any]:
    """Compare an outcome between two sets of days (e.g. intervention vs control)."""
    m = _as_map(outcome_series)
    a = [m[d] for d in group_days_a if d in m]
    b = [m[d] for d in group_days_b if d in m]
    res = compare_groups(a, b, n_perm, seed)
    res["confounder_checklist"] = CONFOUNDER_CHECKLIST
    return res
