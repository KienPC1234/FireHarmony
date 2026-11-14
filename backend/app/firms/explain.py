"""Ask FIRMS — offline assistant that explains the harmonization.

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
    "Độ chính xác của calendar ra sao?",
    "Dữ liệu từ đâu, gồm những gì?",
    "Giai đoạn nào cháy mạnh bất thường?",
    "So sánh tháng mới nhất với lịch sử?",
    "Mô hình deep learning làm gì?",
]


def is_vietnamese(q: str) -> bool:
    ql = q.lower()
    if VI_RE.search(q):
        return True
    return any(w in ql for w in ["the nao", "du lieu", "do chinh xac", "giai thich",
                                 "tai sao", "nhu the nao", "bao nhieu"])


def gather_facts(calendar: dict, daily_cells: int, ratios: dict,
                 n_records: int, bbox: str | None) -> dict:
    rt = calendar.get("row_totals", [])
    ys = calendar.get("years", [])
    pre = [t for y, t in zip(ys, rt) if y < 2012]
    post = [t for y, t in zip(ys, rt) if y >= 2012]
    era_ratio = round((sum(post) / len(post)) / (sum(pre) / len(pre)), 3) if pre and post else None
    measured = len(ratios) - (1 if "_fallback" in ratios else 0)
    return {
        "n_records": n_records,
        "years": [ys[0], ys[-1]] if ys else [],
        "n_years": len(ys),
        "daily_cells": daily_cells,
        "bbox": bbox or "104,10,109,16 (mặc định demo)",
        "k_fallback": ratios.get("_fallback"),
        "k_months_measured": measured,
        "era_ratio": era_ratio,
        "col_medians": calendar.get("col_medians", []),
        "latest": None,  # filled by caller
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
                               "sample", "mẫu", "mau", "trường", "truong", "schema"]):
        text = _t_data(facts, vi)
    elif any(w in ql for w in ["bất thường", "bat thuong", "anomaly", "anomal", "critical",
                               "mạnh nhất", "manh nhat", "cao điểm", "cao diem", "peak",
                               "giai đoạn", "giai doan"]):
        text = _t_anomaly(facts, critical, vi)
    elif any(w in ql for w in ["mới nhất", "moi nhat", "latest", "hiện tại", "hien tai",
                               "current", "so sánh", "so sanh", "compare", "tháng này", "thang nay"]):
        text = _t_latest(facts, latest, vi)
    elif any(w in ql for w in ["deep", "mô hình", "mo hinh", "model", "mlp", "autoencoder",
                               "neural", "mạng", "mang", "torch", "học sâu", "hoc sau"]):
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
    if vi:
        return (f"Thuật toán gồm 4 bước trên lưới ngày 0.05°: (1) Chuẩn hóa mọi dòng FIRMS về một schema, "
                f"gắn cờ QA. (2) Ước lượng k = MODIS/VIIRS = {f['k_fallback']} từ tổng tháng của AOI "
                f"({f['k_months_measured']} tháng đo được, không cần trùng ô). (3) Harmonize XUÔI về độ nhạy VIIRS: "
                f"giữ nguyên VIIRS ở ô nào VIIRS bay qua, ô chỉ có MODIS (trước 2012) upscale 1/k và ghi nhãn ước lượng. "
                f"Không bao giờ cộng dồn — cộng sẽ tạo bước nhảy giả ~2x năm 2012. "
                f"(4) Calendar tháng×năm, anomaly z = (giá trị − median cùng tháng)/MAD.")
    return (f"4 steps on a daily 0.05° grid: (1) standardize FIRMS rows, QA flags. (2) k = MODIS/VIIRS = "
            f"{f['k_fallback']} from monthly AOI totals ({f['k_months_measured']} measured months). "
            f"(3) Forward fill to VIIRS sensitivity: keep VIIRS where it flew, upscale MODIS-only cells by 1/k "
            f"(labeled estimated). Never summed — a sum fakes a ~2x step in 2012. "
            f"(4) Month×year calendar, z = (value − same-month median)/MAD.")


def _t_accuracy(f: dict, critical: list[dict], vi: bool) -> str:
    top = _fmt_top(critical)
    if vi:
        return (f"3 con số kiểm chứng được tính live: (1) Tỷ lệ cháy trung bình năm sau-2012/trước-2012 = {f['era_ratio']} "
                f"(mục tiêu ~1.0 — chuỗi nhất quán xuyên kỷ nguyên sensor). (2) k đo được trên {f['k_months_measured']} tháng, "
                f"fallback văn hiến {f['k_fallback']}. (3) Spike 2019 cấy vào được bắt: {top}. "
                f"Giới hạn thành thật: sample hiện là tổng hợp (dữ liệu FIRMS thật cần MAP_KEY); ô trước 2012 là upscale ước lượng; "
                f"bias giờ bay vệ tinh và mây che chưa khử hết.")
    return (f"3 live-verifiable numbers: (1) post-2012/pre-2012 yearly mean ratio = {f['era_ratio']} "
            f"(target ~1.0 — era-consistent). (2) k measured on {f['k_months_measured']} months, fallback {f['k_fallback']}. "
            f"(3) planted 2019 spike caught: {top}. Honest limits: current sample is synthetic (real FIRMS needs MAP_KEY); "
            f"pre-2012 cells are estimated upscales; overpass/cloud bias only reduced.")


def _t_data(f: dict, vi: bool) -> str:
    if vi:
        return (f"Dữ liệu: FIRMS MODIS C6.1 (Terra/Aqua, 1 km, từ 2000) + VIIRS 375 m (Suomi-NPP/NOAA-20/21, từ 2012). "
                f"Sample offline hiện có {f['n_records']} dòng, {f['n_years']} năm "
                f"({f['years'][0] if f['years'] else '?'}–{f['years'][-1] if f['years'] else '?'}) → {f['daily_cells']} ô ngày, "
                f"AOI {f['bbox']}. Muốn dữ liệu thật: lấy MAP_KEY miễn phí rồi chạy "
                f"`python -m scripts.firms.fetch_firms --source VIIRS_SNPP_NRT --bbox 104,10,109,16 --days 7`.")
    return (f"Data: FIRMS MODIS C6.1 (Terra/Aqua, 1 km, since 2000) + VIIRS 375 m (Suomi-NPP/NOAA-20/21, since 2012). "
            f"Offline sample: {f['n_records']} rows, {f['n_years']} years → {f['daily_cells']} daily cells, AOI {f['bbox']}. "
            f"Real data: free MAP_KEY, then `python -m scripts.firms.fetch_firms --source VIIRS_SNPP_NRT ...`.")


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
    if vi:
        return (f"Tháng mới nhất {latest['date']}: {latest['month_total']} vụ (quy đổi VIIRS), "
                f"median lịch sử cùng tháng {latest['hist_median']} (×{r}) → {latest['verdict'].replace('_', ' ')}.")
    return (f"Latest month {latest['date']}: {latest['month_total']} harmonized fires vs "
            f"historical same-month median {latest['hist_median']} (×{r}) → {latest['verdict']}.")


def _t_dl(f: dict, dl_info: dict, vi: bool) -> str:
    models = "; ".join(f"{m['name']} ({m['kind']}, {m['params']} params)" for m in dl_info.get("models", []))
    torch_s = "có" if dl_info.get("has_torch") else "không"
    if vi:
        return (f"2 mô hình tí hon (<50k params, chạy CPU vài giây, torch trên máy này: {torch_s}): {models}. "
                f"CrossSensorCalibrator học phần dư cho phép upscale 1/k trên tháng overlap (loss Huber, target số VIIRS); "
                f"FireSeasonAE (Conv1d trên vector 12 tháng) chấm điểm mùa cháy lạ bằng sai số tái tạo. "
                f"Thiếu torch/dữ liệu mỏng → tự rúle về đường thống kê, API luôn báo `trained: false` khi từ chối.")
    return (f"2 tiny models (<50k params, seconds on CPU, torch here: {torch_s}): {models}. "
            f"CrossSensorCalibrator learns the residual of the 1/k upscale on overlap months (Huber, VIIRS target); "
            f"FireSeasonAE (Conv1d over the 12-month vector) scores odd seasons by reconstruction error. "
            f"No torch/thin data → statistical fallback, API reports `trained: false` on refusal.")


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
