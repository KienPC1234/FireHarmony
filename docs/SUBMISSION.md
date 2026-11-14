# Submission checklist: Harmonization of MODIS and VIIRS Hot Spots

- [ ] Repo sạch, build xanh: backend suite (fast profile + 6 raw/SPA), frontend typecheck/lint/build.
- [ ] `make demo` chạy 1 process trên :8000 (API + SPA).
- [ ] Chạy `python -m scripts.firms.check_release`: phải OK (gồm
      pytest, raw subset checksum, benchmark, evaluate raw/sample, docs, env,
      artifact health STAN/HTS (HGB/TS are archived warnings)).
- [ ] Thử walkthrough `docs/DEMO.md` dưới 3:00.
- [ ] Điền portal Space Apps: tóm tắt, link demo/video, ảnh calendar + map.
- [ ] Ghi rõ giới hạn: coverage theo request ledger (day-31 gap là thật),
      Australia đã backfill đủ 84/85 tháng (trước đây từng chỉ có cửa sổ 5 ngày),
      pre-2012 upscale là ước lượng, bias giờ bay/mây chưa khử hết, outlook là khí hậu học,
      chỉ mới đánh giá trên 3 AOI (chưa chứng minh transfer sang vùng mới).
- [ ] Báo cáo kết quả trung thực: STAN đạt MAE 3,899.5 vs B2 4,462.6 (-12.6% MAE,
      P(STAN better) 0.965, cải thiện cả 3 AOI; 95% CI [-1,184.4, +50.8] chứa 0,
      `statistically_established: false`) trên holdout 72 tháng (`eval-v4`);
      B2/HTS (HTS MAE 4,172.7) đóng vai trò mỏ neo chuẩn vững chắc.
- Truth-messaging Ngày 1B: `k=0.35` chỉ là fallback khi `insufficient_overlap`
  (<3 tháng cùng quan trắc) — response giữ số nhưng ghi `uncertainty_status=not_calibrated`
  + `calibration_note`, không vẽ interval; 409 `model_requires_full_aoi` /
  `geometry_requires_stat_method` nêu rõ AOI-level target không reallocate polygon
  (dùng `method=stat`); summary note cảnh báo platform_mix SNPP vs NOAA-20/21.
- [ ] Key/data: sample offline trong repo; dữ liệu thật cần FIRMS_MAP_KEY
      (miễn phí): không commit key; raw ~1.4 GB không nằm trong zip.
- [ ] Demo thật trong zip: `make demo-verify && make demo-install` nạp pack
      Việt Nam 24 tháng (2024-01..2025-12, 362 CSV, 459.832 dòng) đã pin
      SHA-256; sau đó `/calendar?data=raw&method=stan` chạy end-to-end.
- [ ] Vùng mới/custom (bbox/geometry ngoài 3 AOI): chỉ `method=stat` +
      `uncertainty_status=not_calibrated`; HTS/STAN 409 (`model_requires_full_aoi` /
      `geometry_requires_stat_method`) vì AOI-level target không reallocate polygon.
      Transfer sang vùng mới là `not established` — chỉ mới đánh giá trên 3 AOI.
- [ ] Caps còn đúng: daily slice 5000, map-cells 200k, validate 50k,
      ingest 50MB / session 10MB, geometry 200kB / 5k vertices.
- [ ] Cold `/calendar` ~153.7s (stat) / ~215.3s (STAN), warm 91–118ms;
      mọi response mang `X-Elapsed-Ms`; panel loading báo elapsed, không giấu cold.
- [ ] Raw ~1.4GB gitignored (không nằm trong zip); submission chỉ demo pack
      24 tháng 459.832 dòng pin SHA-256.
