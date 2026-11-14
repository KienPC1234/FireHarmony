# Model diagnostics — data shape, Transformer sweep, custom SRF

Mục tiêu: kiểm tra giả thuyết “TS thua vì tham số/window sai, data imbalance,
hay cấu trúc chưa phù hợp”. Mọi tuning dùng rolling validation 2021/2022/2023;
holdout 2024–2025 chỉ chạy một lần cho cấu hình được chọn.

## 1. Data audit

`training_pairs_raw.csv`: 337 AOI-months.

| AOI | Months | Years | MODIS median | VIIRS median | VIIRS/MODIS median |
|---|---:|---|---:|---:|---:|
| vietnam | 168 | 2012–2025 | 778.5 | 2,863 | 4.02× |
| amazon | 84 | 2019–2025 | 3,820.5 | 12,800 | 3.47× |
| australia | 85 | 2019–2026 | 2,593 | 12,954 | 4.99× |

- Không phải class imbalance kiểu classification; đây là **scale imbalance**
  (Amazon lớn hơn Vietnam ~5×) và **coverage imbalance** (Amazon/Australia thiếu
  2012–2018).
- Target là log-ratio nên scale không trực tiếp làm hỏng loss; thử
  `balanced` sampling lại làm validation tệ hơn (2,109 vs 1,890 MAE), nên không
  phải nguyên nhân chính.
- Điểm yếu thật: chỉ 195 training windows, 36 validation windows/năm, và ba vùng
  có quan hệ mùa/khí hậu khác nhau.

## 2. Transformer sweep (validation 2021/2022/2023)

| Config | Validation MAE (mean 3 folds) | B2 same folds |
|---|---:|---:|
| window 12, d32, 2 layers (đang ship) | 1,890.5 | 2,168.2 |
| window 9, d32 | **1,877.7** | 2,168.2 |
| window 6, d32 | 1,877.7 | 2,168.2 |
| window 12, d64 | 1,925.4 | 2,168.2 |
| window 12, balanced | 2,108.8 | 2,168.2 |

Kết luận: **window 9/6 tốt hơn window 12**, và balanced loss không giúp. Đây là
lỗi cấu hình thật của bản TS đang ship, không phải “model dở”.

### Holdout một lần cho window 9

| | Pooled MAE (n=72) | Headline (VN+AM) | Vietnam | Amazon | Australia |
|---|---:|---:|---:|---:|---:|
| B2 | 2,386.9 | 2,746.0 | **844.2** | 4,647.7 | 1,668.8 |
| TS window 9 | **2,229.9** | ~2,578 | 1,074.7 | **3,779.6** | 1,835.4 |

- ΔMAE = **−157.0**, bootstrap CI **[−614.0, +241.0]**, P(better) = 0.75.
- Thắng Amazon mạnh, thua Vietnam rõ; CI chứa 0 nên **không đủ để tuyên bố**.
- Per-fold per-AOI không ổn định: 2021 thắng cả 3 vùng; 2022 thắng VN nhưng thua
  Amazon/Australia; 2023 thua VN/Australia, thắng Amazon. Vì vậy không có gate
  theo vùng nào đủ chắc.

## 3. Custom network: Seasonal-Residual Former (SRF)

Thiết kế theo đặc điểm data, không phải Transformer tổng quát:

- **Seasonal query cross-attention**: một query theo tháng target attend lên
  12 lag token, thay vì self-attention 12×12.
- **Dilated TCN** (dilation 1/2/4) cho persistence 1/2/4 tháng.
- **Residual trên B2** theo log-ratio; gate khởi tạo gần 0 để mặc định bám B2.
- **Per-AOI shrinkage λ** chọn trên validation: vùng nào không lợi thì λ=0.
- **Conformal 80% band** từ validation residuals.

Kết quả validation (7 biến thể, 5 seeds):

| Variant | Validation MAE sau λ |
|---|---:|
| w12, gate −4 | 1,180.8 |
| w12, gate 0 | 1,120.4 |
| w9, gate 0 | **1,117.6** |
| w9, per-AOI head | 1,180.6 |
| w9, balanced | 1,182.7 |

Holdout của artifact cuối (w12, gate −4, λ chọn trên validation):

| | Pooled MAE | Vietnam | Amazon | Australia |
|---|---:|---:|---:|---:|
| B2 | 2,386.9 | **844.2** | **4,647.7** | 1,668.8 |
| SRF | **2,384.6** | **837.2** (λ=1) | 4,647.7 (λ=0) | 1,668.8 (λ=0) |

- ΔMAE = **−2.31**, CI **[−6.15, +1.20]**, P(better) = 0.88 → hoà B2.
- Biến thể validation tốt nhất (w9, gate 0) đạt 2,385.6; λ chỉ bật ở Australia
  (1,664.8 vs 1,668.8). Khác biệt không đáng kể và không ổn định qua các fold.
- **Conformal 80% band thất bại**: coverage thực nghiệm chỉ **22.2%** (artifact
  cuối) / 61.1% (biến thể w9) → không được dùng làm interval. Đây là lý do
  `uncertainty_status=not_calibrated` phải giữ cho SRF.
- SRF artifact: `deployed=false`, 19,556 params.

## 4. Kết luận

1. **Không phải data bẩn**: schema/QA/dedup/coverage đã kiểm; vấn đề là ít mẫu,
   thiếu NOAA, và ba vùng khác nhau.
2. **Có lỗi tham số thật**: window 12 là lựa chọn dở; window 9 tốt hơn ~7% so với
   B2 trên holdout, nhưng CI rộng và per-fold không ổn định.
3. **Custom SRF không thắng**: nó chứng minh kiến trúc đúng hướng dữ liệu nhưng
   chưa có tín hiệu đủ mạnh; gate tự tắt về B2 ở Amazon/Australia, chỉ bật nhẹ ở
   Vietnam (837 vs 844), và conformal band không đạt coverage.
4. Vì vậy SRF **không được serve**. Nếu chỉ chọn một kiến trúc để tối ưu tiếp,
   chọn **HGB residual-on-B2** (rẻ, sklearn, gate có sẵn) và dùng window/feature
   ý tưởng từ sweep; archive TS/SRF làm negative result.

## Reproduce

```bash
cd backend
python -m scripts.firms.ts_diagnose          # window/dmodel/lr sweep
python -m scripts.firms.ts_diagnose_focus    # 5-seed + bootstrap CI
python -m scripts.firms.srf_diagnose         # SRF variants + holdout
```

Artifacts: `ts_diagnose.json`, `ts_diagnose_focus.json`, `srf_diagnose.json`,
`srf_raw.pt/json`. Raw subset vẫn tái lập được pixel→calendar mà không cần
820 MB.

## 5. Follow-up: tile hierarchy (after audit-2)

The AOI-only design above was the real limit: 231 windows cannot support a
larger network. Aggregating the same 823 MB raw pull at 1-degree tiles yields
42,327 tile-months (3,924 twelve-month windows) and a hierarchical tile-seasonal
anchor that reaches **2,230.7 MAE vs B2 2,386.9** on the 72 holdout rows
(−6.5%, all three AOIs improve, CI [−362, +44]). The region-agnostic TileFormer
does not beat that anchor even at 258k parameters. Details, LOO and the capacity
sweep: `docs/TILE_HIERARCHY.md`. This supersedes the "one architecture" note
above: the candidate worth optimizing is the tile hierarchy, not more attention.
