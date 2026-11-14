export interface ScenarioPreset {
  id: string;
  aoi: string;
  year: number;
  month: number;
  title: { vi: string; en: string };
  desc: { vi: string; en: string };
  badge: { vi: string; en: string };
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "amazon-2019",
    aoi: "amazon",
    year: 2019,
    month: 8,
    title: { vi: "Nam Amazon 2019: Cao điểm mùa khô (vùng mẫu)", en: "Southern Amazon 2019: Dry-Season Peak (sample region)" },
    desc: {
      vi: "Đỉnh mùa khô tháng 8-9/2019 tại Nam bồn địa; preset minh họa, không phải kết luận thống kê.",
      en: "Dry-season burning peak in the Southern Basin; preset for navigation, not a statistical claim.",
    },
    badge: { vi: "Đỉnh 2019", en: "Peak 2019" },
  },
  {
    id: "australia-black-summer",
    aoi: "australia",
    year: 2019,
    month: 12,
    title: { vi: "Đông Nam Úc 2019-20: Black Summer (vùng mẫu)", en: "SE Australia 2019-20: Black Summer (sample region)" },
    desc: {
      vi: "Cháy rừng lịch sử Đông Nam Úc mùa hè 2019-20; preset minh họa, không kèm z-score.",
      en: "Historic summer 2019-20 fires in southeast eucalyptus forests; illustrative preset, no z claim.",
    },
    badge: { vi: "Black Summer", en: "Black Summer" },
  },
  {
    id: "vietnam-2021",
    aoi: "vietnam",
    year: 2021,
    month: 3,
    title: { vi: "Trung/Nam Việt Nam 2021: Cao điểm mùa khô (vùng mẫu)", en: "Central/Southern Vietnam 2021: Dry-Season Peak (sample region)" },
    desc: {
      vi: "Đỉnh khô hạn rõ rệt tháng 3 tại Gia Lai, Đắk Lắk và Lâm Đồng.",
      en: "Seasonal burning peak across Gia Lai and Dak Lak agro-forest zones.",
    },
    badge: { vi: "Mùa khô T03", en: "Dry Season M03" },
  },
];
