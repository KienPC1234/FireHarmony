# Dead-code inventory (CLAIM-021 — inventory only, no deletion)

> Scope: CLAIM-021 creates ONLY this file. No `src` (backend, frontend,
> tests, locales) was modified. Deletion requires owner sign-off per
> `docs/TRUTH_CONTRACT.md` (anti-ratchet rule: "Do not delete a capability
> to avoid a label") + a note in `docs/SUBMISSION.md`. This pass only
> inventories.
>
> Policy refs:
> - `docs/TRUTH_CONTRACT.md` — change policy (one audit per milestone, P1s
>   parked, removal needs sign-off).
> - `docs/AUDIT_BACKLOG.md` — open P1-A..D (ETL, footprint, NOAA event
>   study, inline-ternary debt). **None covers dead code → no overlap,
>   no conflict.**
> - `docs/AGENT_CLAIMS.md` — Contested history (silent reverts killed
>   CLAIM-001 work, `kill :8000` caused flakes). **Never revert another
>   agent's scope; disputes go in Contested.**

## Re-run commands (all run from repo root, read-only)

```bash
grep -rn "_pairs_for\|_covered_targets\|_round4" backend/ | grep -v __pycache__
grep -rn "sf_tile\|ml_core\|train_calibrator" backend/app backend/scripts | grep -v __pycache__
grep -rn "HarmonizedCell" backend/ frontend/ | grep -v __pycache__
grep -rho "api\.[a-zA-Z]*" frontend/src --include="*.tsx" --include="*.ts" | sort | uniq -c | sort -rn
for m in progress schema sample aois htsStatus stanStatus ask askLlm explainMonth investigate qaSummary llmStatus briefUrl dlInfo uploadDataset ingest; do echo -n "$m: "; grep -rn "api\.$m\b" frontend/src --include="*.tsx" --include="*.ts" | grep -v "lib/api.ts" | wc -l; done
grep -rn "calendar\.legend" frontend/src backend/ | grep -v __pycache__
python3 -c "import re;[print(l+':'+str('legend' in open(f'frontend/src/locales/{l}.ts').read().split('  calendar: {')[1].split(chr(10)+'  },')[0])) for l in ['vi','en']]"
git status --short -- backend/data/firms/aois.json; git ls-files --error-unmatch backend/data/firms/aois.json
```

## Classification rule

| Label | Meaning |
|---|---|
| `dead-thật` | 0 production references + a replacement exists (or never wired). **Still KEEP by default.** Removal needs owner sign-off + `SUBMISSION.md` note. Never self-delete in this pass. |
| `dự-phòng` | Public API / test import / router still serves it. KEEP — it is a supported surface, not dead. |
| `không-dead` | Live code, listed here only to prevent accidental deletion. KEEP. |
| `chưa-rõ` | Origin/ownership unknown. KEEP, owner decides. |
| `đã-xóa` | Code + keys already gone; only comment mentions remain. KEEP (comments harmless) or trivial comment cleanup by the owning claim. |

## Backend (`backend/app/main.py`, `backend/app/firms/`)

| File:dòng | Bằng chứng grep | Phân loại | Khuyến nghị |
|---|---|---|---|
| `backend/app/main.py:186` `_pairs_for` | `grep -rn "_pairs_for" backend/` → chỉ 1 hit là định nghĩa; 0 callsite trong `main.py`/`routers/*.py` (routes dùng `_resolve_records` trực tiếp) | `dead-thật` | KEEP. Helper chưa được wire (CLAIM-019 đang tách pipeline có thể dùng). Remove cần owner sign-off + ghi `SUBMISSION.md`. |
| `backend/app/main.py:232` `_covered_targets` | Cùng grep trên → 0 callsite prod; hit duy nhất ngoài định nghĩa là `backend/tests/test_firms.py:744` (`_m._covered_targets(...)`) | `dead-thật` (test-only) | KEEP. Chỉ test import = còn giá trị đặc tả. Không xóa khi test còn dùng. |
| `backend/app/firms/service.py:12` `_round4` | Cùng grep → LIVE: `routers/calendar.py:27`, `routers/models.py:27`, `routers/system.py:27`, `main.py:33,513,560` import/dùng | `không-dead` | KEEP. Liệt kê để tránh xóa nhầm theo tên pattern. |
| `backend/app/firms/sf_tile.py` (toàn module, 170 dòng) | `grep sf_tile` → LIVE: `stan.py:59-63,318-332,477-482` (frame/load_aoi_pairs/b2_by_aoi/tile_anchors/loads), `scripts/firms/build_hts_series.py:21-52`, `scripts/firms/evaluate_hts.py:25-88` | `không-dead` | KEEP. Trụ cột STAN/HTS + scripts. |
| `backend/app/firms/ml_core.py` (toàn module, 221 dòng) | `grep ml_core` → LIVE: `hts.py:12` (`apply_monthly_targets`), `evaluation.py:30-33` (counts_from_log_ratio/delta_ci/metrics/ratios_from_train), `sf_tile.py:77` | `không-dead` | KEEP. Import bởi 3 module prod. |
| `backend/app/firms/dl.py:62` `train_calibrator` | `grep train_calibrator` → chỉ 1 hit là định nghĩa; 0 caller. Module `dl` LIVE qua `dl.describe()` (`routers/system.py:46,189,363,429,523,567`, `tests/test_firms.py:118`) | function `dead-thật`, module `dự-phòng` | KEEP function + module. `describe()` phục vụ `GET /api/firms/dl-info` (truth contract: báo `has_torch` trung thực). Xóa `train_calibrator` cần owner sign-off. |
| `backend/app/firms/schema.py:167` `HarmonizedCell` | `grep HarmonizedCell` → 3 hits: định nghĩa + re-export `firms/__init__.py:6,9`. 0 validate/callsite (ngược với `FirmsRecord` được `harmonize.py:150,164` + `spatial.py` dùng) | `dead-thật` | KEEP. Schema compat công khai; CLAIM-020 sở hữu `schemas.py` mới — mọi thay đổi do owner CLAIM-020 quyết + sign-off. |

## Frontend (`frontend/src/lib/api.ts`) — 16 ứng viên, kết quả: 15 dead-thật + 1 live

Đối chiếu: `grep -rho "api\.[a-zA-Z]*" frontend/src --include="*.tsx" --include="*.ts"` (loại noise `api.ts` trong comment `useCalendarExport.ts:9`) + vòng `for m in ...` đếm từng method ngoài `lib/api.ts`.
Backend routes tương ứng đều LIVE (`routers/system.py`, `routers/models.py`, `routers/calendar.py`) → các method dead phía client vẫn là `dự-phòng` API surface, KEEP.

| File:dòng | Bằng chứng grep (usages ngoài `lib/api.ts`) | Phân loại | Khuyến nghị |
|---|---|---|---|
| `api.ts:454` `progress` | 0 | `dead-thật` (client) / server `GET /api/firms/progress` (`system.py:175`) live → SDK `dự-phòng` | KEEP. Backend route live; client method là surface hợp lệ. |
| `api.ts:456` `schema` | 0 | như trên (`system.py:101`) | KEEP, lý do tương tự. |
| `api.ts:457` `sample` | 0 | như trên (`system.py:108`) | KEEP. |
| `api.ts:458` `aois` | **1** (`pages/calendar.tsx:243`) | `không-dead` — ứng viên duy nhất còn live | KEEP. Đính chính: không thuộc diện dead. |
| `api.ts:470` `htsStatus` | 0 | `dead-thật` (client) / `GET /hts-status` (`models.py:66`) live | KEEP. X-Ray/Lab dùng `xray`/`backtest` thay thế ở UI hiện tại, nhưng route + method giữ cho công cụ/admin. |
| `api.ts:471` `stanStatus` | 0 | như trên (`models.py:49`) | KEEP. |
| `api.ts:492` `ask` | 0 (`askLlm` đếm riêng, cũng 0) | `dead-thật` (client) / `POST /ask` (`system.py:529`) live | KEEP. UI hiện dùng `investigateStream`; route non-stream giữ cho client nhẹ. |
| `api.ts:494` `askLlm` | 0 | như trên (`system.py:475`) | KEEP. |
| `api.ts:510` `explainMonth` | 0 | `dead-thật` (client) / `POST /explain-month` (`models.py:491`) live | KEEP. |
| `api.ts:519` `investigate` (non-stream) | 0 (chỉ `investigateStream` được dùng ×2) | `dead-thật` (client) / `POST /investigate` (`system.py:319`) + `/investigate-stream` (`:390`) live | KEEP. Non-stream là fallback khi SSE bị chặn. |
| `api.ts:598` `qaSummary` | 0 | `dead-thật` (client) / `GET /qa-summary` (`system.py:250`) live | KEEP. |
| `api.ts:601` `llmStatus` | 0 | `dead-thật` (client) / `GET /llm-status` (`system.py:470`) live | KEEP. |
| `api.ts:603` `briefUrl` | 0 | `dead-thật` (client) / `GET /brief` (`calendar.py:533`) live | KEEP (URL builder, không phải fetch — 0 grep là bình thường cho helper chưa dùng). |
| `api.ts:605` `dlInfo` | 0 | `dead-thật` (client) / `GET /dl-info` (`system.py:187`) live | KEEP. Truth contract yêu cầu `has_torch` trung thực (AGENTS.md §3). |
| `api.ts:616` `uploadDataset` | 0 | `dead-thật` (client) / upload path (`main.py:596` validate→QA→dedup→harmonize) live | KEEP. Luồng upload session còn phục vụ. |
| `api.ts:633` `ingest` | 0 | `dead-thật` (client) / `POST /ingest` (`system.py:192`) live | KEEP (P2-15 admin ingest; 0 UI usage = chưa wire, không phải thừa). |

## Locales

| File:dòng | Bằng chứng grep | Phân loại | Khuyến nghị |
|---|---|---|---|
| `calendar.legend_*` (key + reference) | `grep -rn "calendar\.legend" frontend/src backend/` → chỉ 2 hits, đều là **comment**: `components/calendar/CalendarMatrix.tsx:25`, `components/map/sensorLegend.ts:6-7`. Khối `calendar:` trong `vi.ts`/`en.ts` (192 dòng từ `calendar: {`) chứa **0** key `legend` (check bằng python parse ở trên) | `đã-xóa` (code + key đã nghỉ; sót 2 comment) | KEEP. Không còn gì để xóa. Nếu dọn, chỉ là sửa 2 comment — thuộc owner locales, không làm trong pass này. Chuẩn hiện tại: legend qua `map.legend_*` (`sensorLegend.ts` canonical keys). |

## Dữ liệu

| File | Bằng chứng | Phân loại | Khuyến nghị |
|---|---|---|---|
| `backend/data/firms/aois.json` (552 B, presets amazon/australia/vietnam + `custom:{}`) | `git status --short` → `?? backend/data/firms/aois.json` (untracked); `git ls-files --error-unmatch` → "did not match any file(s) known to git"; `git check-ignore` exit 1 (không bị ignore). Nhưng LIVE: `firms/store.py:24,43,59,187`, `main.py:63`, `routers/system.py:86`, `tests/test_firms.py:1807`, `scripts/firms/fetch_missing.py:47,163`, `fetch_full_month.py:117` | `chưa-rõ` (nguồn gốc file chưa rõ — tạo tay hay sinh bởi script — nhưng đang là runtime dependency) | KEEP tuyệt đối, KHÔNG xóa. Owner quyết: `git add` + commit (đề xuất: registry nhỏ, code đã enforce preset) hay tạo lại bằng script. Ghi quyết định vào `SUBMISSION.md` khi sign-off. |

## Tổng hợp

- Inventory: **25 mục** (7 backend + 16 frontend methods + 1 locales + 1 data).
- `dead-thật`: 2 helpers (`_pairs_for`, `_covered_targets`), 1 function (`train_calibrator`), 1 schema (`HarmonizedCell`), **15/16** api methods, 0 locale key còn sót (đã-xóa).
- `không-dead` (liệt để chống xóa nhầm): `_round4`, `sf_tile`, `ml_core`, `api.aois`.
- `dự-phòng` (server route live): toàn bộ 15 api methods dead-phía-client.
- `chưa-rõ`: `aois.json` (untracked nhưng live).
- Hành động: **không xóa gì trong pass này**. Mọi removal tương lai cần owner sign-off từng mục + ghi `SUBMISSION.md`, tuân `TRUTH_CONTRACT.md`.
