"""Ask FIRMS - offline assistant that explains the harmonization.

No external LLM: every number in an answer is computed live from the
harmonized dataset + method constants, so the chat can never invent
accuracy claims on stage. Language: Vietnamese if the question looks
Vietnamese, else English.
"""
from __future__ import annotations

import re

VI_RE = re.compile(r"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]", re.I)

SUGGESTIONS = [
    "Thuật toán harmonization hoạt động thế nào?",
    "Độ chính xác unified eval ra sao?",
    "Dữ liệu từ đâu, coverage tháng này có đủ không?",
    "Giai đoạn nào cháy mạnh bất thường?",
    "So sánh tháng mới nhất với lịch sử?",
    "Vì sao HGB abstain / Transformer thua B2?",
    "Bộ lọc QA và platform ảnh hưởng thế nào?",
]


def is_vietnamese(q: str) -> bool:
    ql = q.lower()
    if VI_RE.search(q):
        return True
    return any(w in ql for w in ["the nao", "du lieu", "do chinh xac", "giai thich",
                                 "tai sao", "nhu the nao", "bao nhieu"])


def gather_facts(calendar: dict, daily_cells: int, ratios: dict,
                 n_records: int, bbox: str | None,
                 method: str | None = None,
                 evaluation: dict | None = None,
                 coverage: dict | None = None,
                 filters: dict | None = None) -> dict:
    rt = calendar.get("row_totals", [])
    ys = calendar.get("years", [])
    pre = [t for y, t in zip(ys, rt) if y < 2012]
    post = [t for y, t in zip(ys, rt) if y >= 2012]
    era_ratio = round((sum(post) / len(post)) / (sum(pre) / len(pre)), 3) if pre and post else None
    measured = ratios.get("_n_months", 0)
    return {
        "n_records": n_records,
        "years": [ys[0], ys[-1]] if ys else [],
        "n_years": len(ys),
        "daily_cells": daily_cells,
        "bbox": bbox or "104,10,109,16 (mặc định demo)",
        "k_fallback": ratios.get("_fallback"),
        "k_months_measured": measured,
        "k_mode": ratios.get("_mode", "fusion"),
        "calibration_window": ratios.get("_calibration_window"),
        "era_ratio": era_ratio,
        "col_medians": calendar.get("col_medians", []),
        "latest": None,  # filled by caller
        "data_source": "synthetic demo (NOT observed)",
        "z_unit": calendar.get("z_unit", "robust MAD units"),
        "method_id": method,
        "evaluation": evaluation or {},
        "coverage": coverage or {},
        "filters": filters or {"qa_min": "all", "platform_set": "all"},
    }


def answer(question: str, facts: dict, critical: list[dict],
           latest: dict | None, dl_info: dict) -> dict:
    q = (question or "").strip()
    vi = is_vietnamese(q)
    ql = q.lower()
    facts["latest"] = latest
    if any(w in ql for w in ["thuật toán", "thuat toan", "harmon", "calibrat", "hiệu chuẩn",
                             "hieu chuan", "k =", "phương pháp", "phuong phap", "algorithm", "method"]):
        text = _t_algorithm(facts, vi)
    elif any(w in ql for w in ["chính xác", "chinh xac", "accuracy", "đánh giá", "danh gia",
                               "tin cậy", "tin cay", "metric", "r²", "r2", "sai số", "sai so"]):
        text = _t_accuracy(facts, critical, vi)
    elif any(w in ql for w in ["dữ liệu", "du lieu", "data", "nguồn", "nguon", "firms",
                               "sample", "mẫu", "mau", "trường", "truong", "schema",
                               "coverage", "bao phủ", "bao phu", "thiếu ngày", "thieu ngay",
                               "filter", "lọc", "loc", "qa"]):
        text = _t_data(facts, vi)
    elif any(w in ql for w in ["bất thường", "bat thuong", "anomaly", "anomal", "critical",
                               "mạnh nhất", "manh nhat", "cao điểm", "cao diem", "peak",
                               "giai đoạn", "giai doan"]):
        text = _t_anomaly(facts, critical, vi)
    elif any(w in ql for w in ["mới nhất", "moi nhat", "latest", "hiện tại", "hien tai",
                               "current", "so sánh", "so sanh", "compare", "tháng này", "thang nay"]):
        text = _t_latest(facts, latest, vi)
    elif any(w in ql for w in ["deep", "mô hình", "mo hinh", "model", "mlp", "autoencoder",
                               "neural", "mạng", "mang", "torch", "học sâu", "hoc sau",
                               "gate", "abstain", "transformer", "hgb", "b2", "baseline"]):
        text = _t_dl(facts, dl_info, vi)
    elif any(w in ql for w in ["dùng", "dung", "use", "upload", "tải", "tai", "aoi", "vùng",
                               "vung", "bbox", "csv", "hướng dẫn", "huong dan", "help"]):
        text = _t_usage(facts, vi)
    else:
        text = _t_fallback(facts, critical, latest, vi)
    return {"answer": text, "facts": facts, "suggestions": SUGGESTIONS}


def _fmt_top(critical: list[dict], n: int = 3) -> str:
    return "; ".join(f'{p["year"]}-{p["month"]:02d} (z={p["z"]})'
                     for p in critical[:n]) or "không có"


def _t_algorithm(f: dict, vi: bool) -> str:
    src = f.get("data_source", "synthetic demo (NOT observed)")
    if vi:
        return (f"Thuật toán gồm 4 bước trên lưới ngày 0.05°: (1) Chuẩn hóa mọi dòng FIRMS về một schema, "
                f"gắn cờ QA (hàng lỗi hình học bị loại, thống kê trong `qa`). (2) Ước lượng k = MODIS/VIIRS = {f['k_fallback']} từ tổng tháng của AOI "
                f"({f['k_months_measured']} tháng đo được, không cần trùng ô). Đây là activity-ratio thực nghiệm, chưa phải hiệu chuẩn cảm biến "
                f"đã kiểm chứng (chưa tách ngày/đêm, giờ bay, số vệ tinh). (3) Chỉ số hoạt động đã chỉnh sensor: "
                f"giữ nguyên VIIRS ở ô nào VIIRS ghi nhận ≥1 detection, ô chỉ-MODIS upscale 1/k và ghi nhãn MODIS-upscaled ESTIMATE "
                f"(coverage=unknown: hotspot-only feed không chứng minh được 'đã quan sát mà không cháy'). "
                f"Không bao giờ cộng dồn. (4) Calendar tháng×năm, anomaly z tính bằng đơn vị MAD robust ({f.get('z_unit')}). "
                f"Nguồn dữ liệu hiện tại: {src}.")
    return (f"4 steps on a daily 0.05° grid: (1) standardize FIRMS rows, QA flags (bad geometry dropped, counted in `qa`). "
            f"(2) k = MODIS/VIIRS = {f['k_fallback']} from monthly AOI totals ({f['k_months_measured']} measured months). "
            f"This is an empirical activity ratio, not yet a validated sensor calibration (no day/night or overpass split). "
            f"(3) Sensor-adjusted activity index (hotspot detections, NOT fires): keep VIIRS where >=1 VIIRS detection, "
            f"upscale MODIS-only cells by 1/k as ESTIMATES (coverage=unknown). Never summed. "
            f"(4) Month×year calendar, z in robust MAD units. Current source: {src}.")


def _t_accuracy(f: dict, critical: list[dict], vi: bool) -> str:
    top = _fmt_top(critical)
    src = f.get("data_source", "synthetic demo (NOT observed)")
    ev = f.get("evaluation") or {}
    if ev:
        pooled = ev.get("pooled_metrics") or {}
        methods = sorted(pooled.items(), key=lambda kv: kv[1].get("mae", 1e18))
        best = methods[0] if methods else None
        per = ev.get("per_aoi") or {}
        bests = {a: (v.get("unified_eval") or {}).get("best_method") for a, v in per.items()}
        gate = (per.get("vietnam") or {}).get("hgb_residual_enabled")
        lines = "; ".join(f"{k} {v['mae']:.1f}" for k, v in methods)
        if vi:
            return (f"Trên unified eval ({ev.get('evaluation_version')}, test {ev.get('test_years')}, "
                    f"n={ev.get('n_eval')}): {lines}. Tốt nhất pooled: "
                    f"{best[0] if best else '?'}. Best theo vùng: {bests}. "
                    f"HGB residual enabled: {gate} (gate abstain nếu không thắng ≥2% qua đa số fold). "
                    f"Đây là MAE trên tháng AOI so với tham chiếu VIIRS, không phải độ cháy thật. "
                    f"Tỷ lệ era sau-2012/trước-2012 = {f.get('era_ratio')} (nhất quán nội bộ, không phải accuracy). "
                    f"Nguồn: {src}.")
        return (f"Unified eval ({ev.get('evaluation_version')}, test {ev.get('test_years')}, "
                f"n={ev.get('n_eval')}): {lines}. Best pooled: {best[0] if best else '?'}. "
                f"Best per AOI: {bests}. HGB residual enabled: {gate}. "
                f"This is AOI-month MAE against the VIIRS reference, not fire ground truth. "
                f"Era ratio {f.get('era_ratio')} is internal consistency, not accuracy. "
                f"Source: {src}.")
    if vi:
        return (f"3 con số tính live trên nguồn HIỆN TẠI ({src}): (1) Tỷ lệ hoạt động sau-2012/trước-2012 = {f['era_ratio']} "
                f"(mục tiêu ~1.0: nhất quán nội bộ, KHÔNG phải độ chính xác cháy thật). (2) k trên {f['k_months_measured']} tháng, "
                f"fallback {f['k_fallback']}. (3) Spike 2019 cấy trong dữ liệu được bắt: {top} (kiểm tra pipeline chạy, "
                f"không chứng minh bắt cháy thật). Ô MODIS-only là ước lượng; FRP upscale = null; bias giờ bay/mây còn.")
    return (f"3 live numbers on CURRENT source ({src}): (1) post/pre-2012 activity ratio = {f['era_ratio']} "
            f"(internal consistency, NOT fire accuracy). (2) k on {f['k_months_measured']} months, fallback {f['k_fallback']}. "
            f"(3) planted 2019 synthetic spike caught: {top} (pipeline check, not real-fire skill).")


def _t_data(f: dict, vi: bool) -> str:
    cov = f.get("coverage") or {}
    fil = f.get("filters") or {}
    covtxt = (f"{cov.get('full_months', '?')}/{cov.get('months', '?')} tháng đủ ≥90% ngày; "
              f"missing-day histogram {cov.get('missing_day_histogram', {})}"
              if vi else
              f"{cov.get('full_months', '?')}/{cov.get('months', '?')} months ≥90% days; "
              f"missing-day histogram {cov.get('missing_day_histogram', {})}")
    if vi:
        return (f"Dữ liệu: FIRMS MODIS C6.1 (Terra/Aqua, 1 km, từ 2000) + VIIRS 375 m (Suomi-NPP/NOAA-20/21, từ 2012). "
                f"Hiện có {f['n_records']} dòng, {f['n_years']} năm → {f['daily_cells']} ô ngày, AOI {f['bbox']}. "
                f"Coverage: {covtxt}. Bộ lọc: QA≥{fil.get('qa_min')}, platform_set={fil.get('platform_set')}. "
                f"Muốn thêm dữ liệu: `python -m scripts.firms.fetch_missing --aoi ...` (chỉ tải ngày thiếu).")
    return (f"Data: FIRMS MODIS C6.1 (Terra/Aqua, 1 km, since 2000) + VIIRS 375 m (Suomi-NPP/NOAA-20/21, since 2012). "
            f"{f['n_records']} rows, {f['n_years']} years → {f['daily_cells']} daily cells, AOI {f['bbox']}. "
            f"Coverage: {covtxt}. Filters: QA≥{fil.get('qa_min')}, platform_set={fil.get('platform_set')}. "
            f"Fetch only missing days: `python -m scripts.firms.fetch_missing --aoi ...`.")


def _t_anomaly(f: dict, critical: list[dict], vi: bool) -> str:
    top = _fmt_top(critical, 5)
    if vi:
        return (f"Top giai đoạn lệch chuẩn (|z|≥2, so với median cùng tháng lịch sử): {top}. "
                f"z = (giá trị − median)/MAD nên một năm cháy lớn không kéo lệch baseline.")
    return (f"Most anomalous periods (|z|≥2 vs same-month history): {top}. "
            f"z = (value − median)/MAD, so one mega-fire year cannot drag the baseline.")


def _t_latest(f: dict, latest: dict | None, vi: bool) -> str:
    if not latest:
        return "Chưa có dữ liệu mới nhất." if vi else "No latest data."
    r = latest.get("ratio")
    cov = latest.get("coverage_status", "unknown")
    ratio_cov = latest.get("coverage_ratio")
    covtxt = f"coverage {cov}" + (f" {round(float(ratio_cov)*100)}%" if ratio_cov is not None else "")
    if vi:
        return (f"Tháng mới nhất hoàn chỉnh {latest['date']}: {latest['month_total']} detections (chỉ số hoạt động, KHÔNG phải số vụ cháy), "
                f"median lịch sử cùng tháng {latest['hist_median']} (×{r}, baseline {latest.get('hist_years')} năm, đã loại năm hiện tại) → {latest['verdict'].replace('_', ' ')}. "
                f"({covtxt}.)")
    return (f"Latest complete month {latest['date']}: {latest['month_total']} hotspot detections (activity index, NOT fires) vs "
            f"historical same-month median {latest['hist_median']} (×{r}, {latest.get('hist_years')}-yr baseline excl. current year) → {latest['verdict']} "
            f"({covtxt}).")


def _t_dl(f: dict, dl_info: dict, vi: bool) -> str:
    ev = f.get("evaluation") or {}
    pooled = ev.get("pooled_metrics") or {}
    mae = pooled.get("hgb_b2res_v4", {}).get("mae")
    tmae = pooled.get("ts_logratio_pool_v2", {}).get("mae")
    b2 = pooled.get("b2_seasonal_ratio", {}).get("mae")
    if vi:
        return (f"Model đang phục vụ: `ml_b2res_v4` (HGB residual trên B2 + gate blocked-CV) và "
                f"`ts_logratio_pool_v2` (pooled 3 AOI, log-ratio, 5 seed). Unified eval: HGB {mae}, "
                f"Transformer {tmae}, B2 baseline {b2}. HGB gate hiện abstain nếu không thắng ≥2% "
                f"qua đa số fold, nên có thể phục vụ baseline. Không có model nào thắng mọi vùng; "
                f"xem /xray và model card. DL cũ (MLP) chỉ là thí nghiệm, không dùng trong /calendar.")
    return (f"Served models: `ml_b2res_v4` (HGB residual on B2 + blocked-CV gate) and "
            f"`ts_logratio_pool_v2` (pooled 3-AOI, log-ratio, 5 seeds). Unified eval: HGB {mae}, "
            f"Transformer {tmae}, B2 baseline {b2}. The HGB gate abstains unless it wins ≥2% on a "
            f"majority of folds, so the served output can be a baseline. No model wins every region; "
            f"see /xray and the model card. The old MLP is an offline experiment, not used by /calendar.")


def _t_usage(f: dict, vi: bool) -> str:
    if vi:
        return ("Cách dùng: (1) Mở trang Calendar, nhập bbox `minLon,minLat,maxLon,maxLat` rồi Apply. "
                "(2) Tải CSV FIRMS của bạn ở trang Home (tối đa 5000 dòng) → Harmonize. "
                "(3) Ô màu = anomaly z so cùng tháng lịch sử; bấm Download để lấy `harmonized_hotspots.csv`. "
                "Màu xanh = dưới median, cam/đỏ = trên median.")
    return ("Usage: (1) Calendar page, enter bbox `minLon,minLat,maxLon,maxLat`, Apply. "
            "(2) Upload your FIRMS CSV on Home (max 5000 rows) → Harmonize. "
            "(3) Cell color = z anomaly vs same-month history; Download gives `harmonized_hotspots.csv`. "
            "Blue = below median, orange/red = above.")


def _t_fallback(f: dict, critical: list[dict], latest: dict | None, vi: bool) -> str:
    top = _fmt_top(critical)
    if vi:
        return (f"Tôi giải thích được: thuật toán, độ chính xác (era ratio hiện {f['era_ratio']}), dữ liệu "
                f"({f['n_records']} dòng), giai đoạn bất thường ({top}), so sánh tháng mới nhất, mô hình DL, cách dùng. "
                f"Hỏi thử một trong các gợi ý bên dưới nhé.")
    return (f"I can explain: the algorithm, accuracy (current era ratio {f['era_ratio']}), data "
            f"({f['n_records']} rows), anomalies ({top}), latest-vs-history, DL models, usage. "
            f"Try a suggestion below.")
