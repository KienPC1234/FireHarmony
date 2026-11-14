# Submission checklist: Harmonization of MODIS and VIIRS Hot Spots

- [ ] Repo sạch, build xanh: backend suite (fast profile + 6 raw/SPA), frontend typecheck/lint/build.
- [ ] `make demo` chạy 1 process trên :8000 (API + SPA).
- [ ] Chạy `python -m scripts.firms.check_release`: phải OK (gồm
      pytest, raw subset checksum, benchmark, evaluate raw/sample, docs, env,
      artifact health TS/ML).
- [ ] Thử walkthrough `docs/DEMO.md` dưới 3:00.
- [ ] Điền portal Space Apps: tóm tắt, link demo/video, ảnh calendar + map.
- [ ] Ghi rõ giới hạn: coverage theo request ledger (day-31 gap là thật),
      australia chỉ có cửa sổ 5 ngày, pre-2012 upscale là ước lượng,
      bias giờ bay/mây chưa khử hết, outlook là khí hậu học.
- [ ] Báo cáo kết quả trung thực: STAN giảm sai số -10.8% MAE trên holdout 72 tháng;
      B2/HTS đóng vai trò mỏ neo chuẩn vững chắc.
- [ ] Key/data: sample offline trong repo; dữ liệu thật cần FIRMS_MAP_KEY
      (miễn phí): không commit key; raw ~820 MB không nằm trong zip.
- [ ] Demo thật trong zip: `make demo-verify && make demo-install` nạp pack
      Việt Nam 24 tháng (2024-01..2025-12, 362 CSV, 459.832 dòng) đã pin
      SHA-256; sau đó `/calendar?data=raw&method=stan` chạy end-to-end.
