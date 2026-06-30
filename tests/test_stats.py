"""Unit tests for app/stats.py against synthetic fixtures with known properties.

Run: ``.venv/bin/python tests/test_stats.py`` (no pytest needed) or ``pytest``.
The point is calibration, not just "it runs": a known effect is recovered with a
CI that excludes the null; pure noise does not produce false positives beyond
the target rate; FDR controls a noise scan; effective-n shrinks under
autocorrelation.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402

from app import stats  # noqa: E402


def _series(values, start="2026-01-01"):
    from datetime import date, timedelta
    d0 = date.fromisoformat(start)
    return [{"day": (d0 + timedelta(days=i)).isoformat(),
             "value": (None if v is None else float(v))}
            for i, v in enumerate(values)]


def test_align_inner_join():
    a = _series([1, 2, 3, 4])
    b = _series([10, 20, 30], start="2026-01-02")
    days, cols = stats.align(a, b)
    assert days == ["2026-01-02", "2026-01-03", "2026-01-04"]
    assert list(cols[0]) == [2, 3, 4] and list(cols[1]) == [10, 20, 30]


def test_correlate_recovers_known_effect():
    rng = np.random.default_rng(1)
    x = rng.normal(size=120)
    y = 2 * x + rng.normal(scale=0.5, size=120)
    res = stats.correlate(_series(x), _series(y), method="pearson")
    assert res["r"] > 0.9, res
    assert res["ci_low"] > 0 and res["ci_high"] > res["ci_low"], res  # CI excludes 0
    assert res["p"] < 1e-10 and res["direction"] == "positive"


def test_correlate_null_usually_nonsignificant():
    false_pos = 0
    trials = 200
    for s in range(trials):
        rng = np.random.default_rng(s)
        x, y = rng.normal(size=60), rng.normal(size=60)
        if stats.correlate(_series(x), _series(y), "pearson")["p"] < 0.05:
            false_pos += 1
    rate = false_pos / trials
    assert 0.01 < rate < 0.11, f"false-positive rate {rate} off calibration"


def test_bh_fdr_controls_noise_scan():
    rng = np.random.default_rng(3)
    named = {f"noise_{i}": _series(rng.normal(size=80)) for i in range(8)}
    res = stats.pairwise_scan(named, method="pearson")
    assert all(not r["significant"] for r in res), "FDR let noise through"


def test_pairwise_scan_finds_true_pair():
    rng = np.random.default_rng(4)
    base = rng.normal(size=100)
    named = {
        "driver": _series(base),
        "linked": _series(0.9 * base + rng.normal(scale=0.3, size=100)),
        "noise1": _series(rng.normal(size=100)),
        "noise2": _series(rng.normal(size=100)),
    }
    res = stats.pairwise_scan(named, method="pearson")
    top = res[0]
    assert {top["a"], top["b"]} == {"driver", "linked"} and top["significant"], top


def test_effective_n_shrinks_with_autocorrelation():
    rng = np.random.default_rng(5)
    # strongly autocorrelated random walks
    x = np.cumsum(rng.normal(size=200))
    y = np.cumsum(rng.normal(size=200))
    n_eff = stats.effective_n(x, y)
    assert n_eff < 0.5 * 200, f"effective n {n_eff} not shrunk"
    # independent white noise: effective n ~ n
    iid = stats.effective_n(rng.normal(size=200), rng.normal(size=200))
    assert iid > 0.7 * 200


def test_compare_groups_detects_shift():
    rng = np.random.default_rng(6)
    a = rng.normal(0, 1, size=40)
    b = rng.normal(1, 1, size=40)
    res = stats.compare_groups(a, b, n_perm=3000, seed=0)
    assert res["significant"] and res["permutation_p"] < 0.01
    assert 0.6 < abs(res["cohens_d"]) < 1.6
    assert res["d_ci_low"] < res["cohens_d"] < res["d_ci_high"]


def test_compare_groups_null_calibrated():
    sig = 0
    trials = 100
    for s in range(trials):
        rng = np.random.default_rng(100 + s)
        a, b = rng.normal(size=30), rng.normal(size=30)
        if stats.compare_groups(a, b, n_perm=600, seed=s)["permutation_p"] < 0.05:
            sig += 1
    rate = sig / trials
    assert rate < 0.12, f"permutation false-positive rate {rate}"


def test_paired_compare_shift():
    rng = np.random.default_rng(7)
    before = rng.normal(50, 5, size=30)
    after = before + 3.0 + rng.normal(scale=0.5, size=30)  # shift + realistic noise
    res = stats.paired_compare(before, after)
    assert abs(res["mean_diff"] - 3.0) < 0.5
    assert res["ci_low"] < res["mean_diff"] < res["ci_high"]
    assert res["ci_low"] > 0 and res["significant"]  # CI excludes 0


def test_lagged_correlation_peaks_at_true_lag():
    rng = np.random.default_rng(8)
    x = rng.normal(size=120)
    # y(t) = x(t-1): aligning x(day) with y(day+1) should peak
    y = np.concatenate([[0.0], x[:-1]])
    res = stats.lagged_correlation(_series(x), _series(y), max_lag=3, method="pearson")
    best = max(res, key=lambda r: abs(r["r"]))
    assert best["lag"] == 1 and abs(best["r"]) > 0.9, res


def test_decompose_recovers_weekly_seasonal():
    n = 70
    trend = np.linspace(0, 10, n)
    weekly = np.array([2, -1, 0, 1, -2, 3, -3])
    seasonal = np.tile(weekly, n // 7 + 1)[:n]
    rng = np.random.default_rng(9)
    obs = trend + seasonal + rng.normal(scale=0.2, size=n)
    res = stats.decompose(_series(obs), period=7)
    rec = np.array([v for v in res["seasonal"] if v is not None])
    # recovered weekly pattern correlates strongly with the injected one
    inj = np.tile(weekly - weekly.mean(), n // 7 + 1)[:len(rec)]
    assert np.corrcoef(rec, inj)[0, 1] > 0.95


def test_anomaly_detection_flags_spike():
    rng = np.random.default_rng(10)
    vals = list(rng.normal(50, 2, size=40))
    vals[35] = 90.0  # clear spike
    flagged = stats.anomalies(_series(vals), window=28, z_thresh=4.0)
    assert any(f["day"] == _series(vals)[35]["day"] for f in flagged)


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
