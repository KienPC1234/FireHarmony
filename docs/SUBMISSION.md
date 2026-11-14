# Submission checklist — Harmonization of MODIS and VIIRS Hot Spots

- [ ] Repo sạch, build xanh: backend **84 tests**, frontend typecheck/lint/build.
- [ ] `make demo` chạy 1 process trên :8000 (API + SPA).
- [ ] Chạy `python -m scripts.firms.check_release` — phải OK (gồm
      pytest, raw subset checksum, benchmark, evaluate raw/sample, docs, env,
      artifact health TS/ML).
- [ ] Thử walkthrough `docs/DEMO.md` dưới 3:00.
- [ ] Điền portal Space Apps: tóm tắt, link demo/video, ảnh calendar + map.
- [ ] Ghi rõ giới hạn: coverage theo request ledger (day-31 gap là thật),
      australia chỉ có cửa sổ 5 ngày, pre-2012 upscale là ước lượng,
      bias giờ bay/mây chưa khử hết, outlook là khí hậu học.
- [ ] Nói rõ kết quả thua: Transformer thua B2; HGB abstain; B2/B1 thắng
      theo vùng. Không có model nào thắng mọi vùng.
- [ ] Key/data: sample offline trong repo; dữ liệu thật cần FIRMS_MAP_KEY
      (miễn phí) — không commit key; raw ~820 MB không nằm trong zip, dùng
      `download_and_verify.py` để tái tạo.
