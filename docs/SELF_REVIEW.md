# Self-review — tự đánh giá trước khi báo xong

Dùng cho mọi task Ngày 1/2. Không báo done khi còn ô chưa tick.
Fail 1 ô P0 = fail cả task (theo `docs/TRUTH_CONTRACT.md`).

## 0. Scope & claims (2 phút)

- [ ] Đã đọc `docs/AGENT_CLAIMS.md` + `AGENTS.md` trước khi sửa
- [ ] Đã append 1 row claim, chỉ touch file trong row, không revert agent khác
- [ ] Không chạm file CLAIM-013 (`calendar.tsx`, `cross-page-context.spec.ts`) / CLAIM-014 (`lab.tsx`, `LabSidebar.tsx`, `investigator.tsx`, `cross-page-truth.spec.ts`) nếu không phải owner
- [ ] Xóa row claim khi xong, proof test ghi vào báo cáo

## 1. Truth contract (P0 — fail là dừng)

- [ ] Mọi số hiển thị có đủ 4 thứ: source (`nasa-firms-raw`/`sample`/`artifact`/`user-upload`), unit (`hotspot detections / activity index`, không phải `fires`), valid range, label (`observed`/`estimated`/`not_calibrated`/`candidate`)
- [ ] Missing coverage = `null` + `reason` (`ineligible_coverage`, `insufficient_comparable_history`, `not_calibrated`, `no_artifact`), không phải 0
- [ ] Không gọi hotspot cluster là `fire perimeter / burned area / severity`
- [ ] Không claim win khi 95% CI chứa 0 (ghi `not established`); STAN hiện `Δ-646 CI [-1452.9,+81.8]` là ví dụ
- [ ] Không xóa tab/model để tránh caveat khi chưa có owner sign-off
- [ ] Verify: `grep -rn "fires detected\|fire count\|burned area" frontend/src backend/app --include="*.tsx" --include="*.py" | grep -v "not a\|never\|≠"`

## 2. Harmonization (`harmonize.py`, `calendar.py`, `coverage.py`)

- [ ] Không đổi logic fusion/k/grid nếu task chỉ là messaging (Day 1B)
- [ ] Fallback `k=0.35` luôn kèm `uncertainty_status=not_calibrated` + note `insufficient_overlap (<3 tháng)`
- [ ] `vi.count==0` vẫn là `no detection recorded`, `coverage_status=unknown`, không phải `confirmed absence`
- [ ] `harmonized_frp=null` cho cell upscale, không rescale FRP bằng `k` count
- [ ] Tháng `partial=true` / `paired_coverage_ratio<0.9` bị loại khỏi climatology, `anomaly=null`
- [ ] Verify: `cd backend && FIRMS_SKIP_RAW=1 FIRMS_SKIP_DIST=1 ../.venv/bin/python -m pytest tests/test_firms.py -q` → 98 passed

## 3. Frontend (`methods`, `about`, `home`, `MapToolbar`)

- [ ] Không còn inline `vi ? "..." : "..."` mới; key mới trong `locales/vi.ts` + `en.ts`, render qua `t()`
- [ ] `method.tsx` giữ alias, `about.tsx` là AboutPage riêng (3 đối tượng + link FIRMS + giới hạn)
- [ ] `MapToolbar`/`home` strings qua dict (`calendar.coord_*`, `home.*`, `map.invalid_coords`)
- [ ] `calendar.tsx` matrix cell là `<button aria-label + Escape>`, không hardcode model name (đọc `effective_method`)
- [ ] Không claim `WCAG AAA` suông nếu chưa đo contrast
- [ ] Verify: `cd frontend && npm run lint && npm run test && npm run build`

## 4. Data & coverage

- [ ] Phân biệt `request coverage` vs `observation coverage=unknown`; missing year ≠ quiet year
- [ ] `vietnam 169 (168 full)`, `amazon/australia 85 (84 full)` còn đúng? Nếu backfill thêm, cập nhật `DATA_GAPS.md` + `FIRMS_DATASET_CARD.md`
- [ ] Custom bbox/geometry chỉ `method=stat` + `not_calibrated`; `hts/stan` 409 message nêu rõ AOI-target không realocate polygon; vùng mới transfer `not established` (chỉ đánh giá 3 AOI)
- [ ] Raw ~1.4GB gitignored; submission chỉ demo pack 24 tháng 459k rows pin SHA-256
- [ ] Verify: `make demo-verify`, `GET /api/firms/coverage?aoi=vietnam`, `GET /api/firms/data-status`

## 5. Ops & perf

- [ ] Dùng `.venv/bin/python` hoặc `make`, không dùng bare `python3` (3.14 không có deps)
- [ ] Không commit `backend/.env` / `FIRMS_MAP_KEY`; không kill `:8000`; không Docker
- [ ] Cold `/calendar` ~153.7s stat / ~215.3s STAN (warm 91–118ms) thì phải báo `X-Elapsed-Ms` + loading elapsed, không giấu
- [ ] Caps còn đúng: `daily slice 5000`, `map-cells 200k`, `validate 50k`, ingest `50MB`/session `10MB`, geometry `200kB/5k vertices`
- [ ] Single PM2 `fork instances:1 workers 2`, `max_memory_restart 8G`

## 6. Báo cáo done

- [ ] Liệt kê `file:line` đã đổi, nằm trong scope claim
- [ ] Dán proof: backend `98 passed` + frontend `lint/test/build` pass (hoặc log fail + cách fix)
- [ ] Ghi rõ việc chưa làm + file còn nợ (ví dụ `/about` route trong `App.tsx:26` vẫn trỏ MethodsPage)
- [ ] Cập nhật `SUBMISSION.md`/`DATA_GAPS.md` nếu số liệu đổi

## Lệnh nhanh

```bash
make agent-check   # ~90s: backend clean + frontend lint/test/build
make check-fast    # ~70s: backend clean only
make demo-verify   # SHA-256 demo pack
# release only:
make check-release # gate đầy đủ
make test-full     # ~40 phút, real raw + SPA
```
