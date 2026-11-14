import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  Database,
  FileCheck2,
  FlaskConical,
  Globe,
  ShieldAlert,
} from "lucide-react";
import { api, type BlindSpotResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { ErrorState, Loading } from "@/components/states";
import { GlobalContextBar } from "@/components/GlobalContextBar";

const AOIS = [
  {
    id: "vietnam",
    name: { vi: "Việt Nam", en: "Vietnam" },
    desc: { vi: "Tây Nguyên & Duyên hải Nam Trung Bộ", en: "Central Highlands & South Central Coast" },
  },
  {
    id: "amazon",
    name: { vi: "Amazon", en: "Amazon" },
    desc: { vi: "Nam bồn địa Amazon / Cerrado", en: "Southern Amazon Basin / Cerrado" },
  },
  {
    id: "australia",
    name: { vi: "Úc (Australia)", en: "Australia" },
    desc: { vi: "Đông Nam Úc (Black Summer)", en: "Southeast Australia (Black Summer)" },
  },
];

export function EvidencePage() {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [sp, setSp] = useSearchParams();
  const aoi = sp.get("aoi") || "vietnam";
  const data = sp.get("data") || "sample";
  const ymParam = sp.get("ym") || "2025-03";

  const [yearStr, monthStr] = ymParam.split("-");
  const year = parseInt(yearStr, 10) || 2025;
  const month = parseInt(monthStr, 10) || 3;

  const [spots, setSpots] = useState<BlindSpotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selectedDay, setSelectedDay] = useState<{
    day: number;
    modisReq: boolean;
    viirsReq: boolean;
    modisDetect: number;
    viirsDetect: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      api.blindSpots(aoi, data, year, month).catch((err) => {
        if (active) setError(err);
        return null;
      }),
      api.coverage(aoi, data).catch(() => null),
    ]).then(([spotRes]) => {
      if (!active) return;
      if (spotRes) setSpots(spotRes);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [aoi, data, year, month]);

  const handleAoiChange = (newAoi: string) => {
    setSp({ aoi: newAoi, data, ym: `${year}-${String(month).padStart(2, "0")}` });
  };

  const handleYmChange = (newYm: string) => {
    setSp({ aoi, data, ym: newYm });
  };

  const days = spots?.days ?? [];
  const daysInMonth = days.length > 0 ? days.length : 31;

  // Determine eligibility criteria
  const pairedDays = days.filter((d) => d.modis_requested && d.viirs_requested).length;
  const daysWithDetections = days.filter(
    (d) => (d.modis_detections ?? 0) > 0 || (d.viirs_detections ?? 0) > 0
  ).length;
  const requestDays = days.filter((d) => d.modis_requested || d.viirs_requested).length;

  const coverageRatio = spots?.paired_coverage_ratio ?? (daysInMonth > 0 ? pairedDays / daysInMonth : 0);
  const threshold = spots?.eligibility_threshold ?? 0.9;
  const eligibility =
    coverageRatio >= threshold
      ? "ELIGIBLE"
      : coverageRatio >= 0.3
      ? "PARTIAL"
      : "INSUFFICIENT";

  return (
    <div className="space-y-6 pb-16">
      {/* 1. Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-sm">
            <FileCheck2 className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {vi ? "Sổ chứng cứ & Toàn vẹn dữ liệu" : "Evidence & Data Integrity Ledger"}
              </h1>
              <span className="font-mono text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                {data.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {vi
                ? "Dữ liệu tháng này đủ để so sánh hai cảm biến không?"
                : "Is this month's data sufficient to compare both sensors?"}
            </p>
          </div>
        </div>

        {/* Action Links */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/calendar?aoi=${aoi}&data=${data}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
          >
            <CalendarDays className="h-4 w-4 text-cyan-400" />
            <span>{vi ? "Xem trên Fire Calendar" : "View in Fire Calendar"}</span>
          </Link>
          <Link
            to="/methods"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
          >
            <FlaskConical className="h-4 w-4 text-purple-400" />
            <span>{vi ? "Kiểm tra phương pháp" : "Inspect Method"}</span>
          </Link>
        </div>
      </div>

      {/* 2. Global Context Bar */}
      <GlobalContextBar />

      {/* 3. Primary Verdict Banner */}
      <div
        className={cn(
          "rounded-2xl border p-5 shadow-sm space-y-2",
          eligibility === "ELIGIBLE"
            ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-200"
            : eligibility === "PARTIAL"
            ? "border-amber-500/40 bg-amber-950/20 text-amber-200"
            : "border-rose-500/40 bg-rose-950/20 text-rose-200"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2
              className={cn(
                "h-5 w-5",
                eligibility === "ELIGIBLE"
                  ? "text-emerald-400"
                  : eligibility === "PARTIAL"
                  ? "text-amber-400"
                  : "text-rose-400"
              )}
            />
            <span className="font-extrabold text-base tracking-wide">
              {vi ? "KẾT LUẬN ĐỐI SOÁT:" : "INTEGRITY VERDICT:"}{" "}
              {eligibility === "ELIGIBLE"
                ? (vi ? "ĐỦ ĐIỀU KIỆN HIỆU CHỈNH" : "ELIGIBLE FOR CALIBRATION")
                : eligibility === "PARTIAL"
                ? (vi ? "MỘT PHẦN (CẦN LƯU Ý KHI SO SÁNH)" : "PARTIAL RECORD (CAVEAT APPLIES)")
                : (vi ? "CHƯA ĐỦ ĐIỀU KIỆN ĐỐI SOÁT" : "INSUFFICIENT DATA")}
            </span>
          </div>

          <span className="font-mono text-xs font-bold px-3 py-1 rounded-full border border-current bg-black/20">
            {pairedDays} / {daysInMonth} {vi ? "ngày đối chiếu khả dụng" : "paired days"} ({Math.round(coverageRatio * 100)}%)
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed font-sans pt-1">
          {eligibility === "ELIGIBLE"
            ? (vi
              ? `Tỷ lệ ngày yêu cầu và xử lý thành công đạt ${(coverageRatio * 100).toFixed(0)}% (vượt ngưỡng yêu cầu ${(threshold * 100).toFixed(0)}%). Dữ liệu hai cảm biến đủ điều kiện để so sánh đối chiếu đa thập kỷ.`
              : `Request coverage reached ${(coverageRatio * 100).toFixed(0)}% (exceeding the ${(threshold * 100).toFixed(0)}% requirement). Both sensors provide sufficient co-observations for multi-decadal harmonization.`)
            : (vi
              ? `Tỷ lệ đối chiếu chỉ đạt ${(coverageRatio * 100).toFixed(0)}%, dưới ngưỡng tiêu chuẩn ${(threshold * 100).toFixed(0)}%. Chuỗi hiệu chuẩn chỉ mang tính tham khảo và có nhãn cảnh báo.`
              : `Paired coverage reached ${(coverageRatio * 100).toFixed(0)}%, falling short of the ${(threshold * 100).toFixed(0)}% threshold. Harmonized values are tagged as uncalibrated approximations.`)}
        </p>
      </div>

      {/* 4. Controls: Select Area & Month */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#111C2E] p-3.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* AOI Selector */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5">
            <Globe className="h-4 w-4 text-cyan-400" />
            <span className="text-slate-400 font-semibold">{vi ? "Vùng:" : "AOI:"}</span>
            <select
              value={aoi}
              onChange={(e) => handleAoiChange(e.target.value)}
              className="bg-transparent font-bold text-white focus:outline-none"
            >
              {AOIS.map((a) => (
                <option key={a.id} value={a.id} className="bg-slate-900">
                  {vi ? a.name.vi : a.name.en} ({vi ? a.desc.vi : a.desc.en})
                </option>
              ))}
            </select>
          </div>

          {/* Target Month */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5">
            <CalendarDays className="h-4 w-4 text-orange-400" />
            <span className="text-slate-400 font-semibold">{vi ? "Tháng:" : "Month:"}</span>
            <input
              type="month"
              value={`${year}-${String(month).padStart(2, "0")}`}
              onChange={(e) => handleYmChange(e.target.value)}
              className="bg-transparent font-bold text-white focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Database className="h-4 w-4 text-amber-400" />
          <span>{vi ? "Nguồn dữ liệu:" : "Data source:"}</span>
          <span className="font-mono text-white font-semibold">{data.toUpperCase()}</span>
        </div>
      </div>

      {loading ? (
        <Loading label={vi ? "Đang kiểm toán sổ bằng chứng quan trắc..." : "Auditing sensor coverage ledger..."} />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <>
          {/* 5. 3 Core Metric Cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 block">
                {vi ? "Số ngày yêu cầu dữ liệu" : "Data Request Days"}
              </span>
              <div className="text-2xl font-bold font-mono text-blue-400">
                {requestDays} / {daysInMonth}
              </div>
              <p className="text-xs text-slate-400">
                {vi ? "Các ngày có bản ghi tệp trong danh mục FIRMS" : "Days with confirmed files in FIRMS catalog"}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 block">
                {vi ? "Số ngày ghi nhận điểm nóng" : "Days with Detections"}
              </span>
              <div className="text-2xl font-bold font-mono text-teal-400">
                {daysWithDetections} / {daysInMonth}
              </div>
              <p className="text-xs text-slate-400">
                {vi ? "Các ngày có ít nhất một cảm biến phát hiện nhiệt" : "Days with at least one active thermal detection"}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 block">
                {vi ? "Số ngày đối chiếu khả dụng" : "Comparable Paired Days"}
              </span>
              <div
                className={cn(
                  "text-2xl font-bold font-mono",
                  eligibility === "ELIGIBLE"
                    ? "text-emerald-400"
                    : eligibility === "PARTIAL"
                    ? "text-amber-400"
                    : "text-rose-400"
                )}
              >
                {pairedDays} / {daysInMonth}
              </div>
              <p className="text-xs text-slate-400">
                {vi ? "Cả MODIS và VIIRS cùng được yêu cầu xử lý" : "Both MODIS and VIIRS successfully requested"}
              </p>
            </div>
          </div>

          {/* 6. Daily Observation Matrix (Source x Date: Days 01-31) */}
          <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {vi ? "Ma trận quan trắc theo ngày (Cảm biến x Ngày)" : "Daily Observation Matrix (Sensor x Date)"}
                </h3>
                <p className="text-xs text-slate-400">
                  {vi
                    ? `Theo dõi trạng thái yêu cầu tệp và phát hiện điểm nóng tháng ${month}/${year}`
                    : `Tracking daily requested granules and detection records for ${year}-${String(month).padStart(2, "0")}`}
                </p>
              </div>

              {/* Status Legend */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-emerald-500" />
                  <span className="text-slate-300">{vi ? "Có cả hai" : "Co-Observed"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-blue-500" />
                  <span className="text-slate-300">MODIS</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-teal-500" />
                  <span className="text-slate-300">VIIRS</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-slate-700" />
                  <span className="text-slate-400">{vi ? "Không yêu cầu" : "Not Requested"}</span>
                </div>
              </div>
            </div>

            {/* Matrix Table */}
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 pr-3 text-left font-semibold">{vi ? "Kênh cảm biến" : "Sensor Channel"}</th>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                      <th key={d} className="p-1 text-center min-w-[28px] font-medium">
                        {String(d).padStart(2, "0")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {/* MODIS Row */}
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-blue-400 whitespace-nowrap">
                      MODIS (Terra/Aqua)
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const dayData = days[i];
                      const active = dayData?.modis_requested;
                      const hasDetect = (dayData?.modis_detections ?? 0) > 0;
                      return (
                        <td key={i} className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedDay({
                                day: i + 1,
                                modisReq: Boolean(active),
                                viirsReq: Boolean(days[i]?.viirs_requested),
                                modisDetect: dayData?.modis_detections ?? 0,
                                viirsDetect: days[i]?.viirs_detections ?? 0,
                              })
                            }
                            className={cn(
                              "h-7 w-full rounded flex items-center justify-center font-bold transition text-xs",
                              hasDetect
                                ? "bg-blue-500 text-white"
                                : active
                                ? "bg-blue-950/70 text-blue-300 border border-blue-500/30"
                                : "bg-slate-900 text-slate-600",
                            )}
                            title={`Ngày ${i + 1}: ${dayData ? dayData.modis_detections : 0} điểm nhiệt`}
                          >
                            {hasDetect ? dayData?.modis_detections : active ? "R" : "-"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>

                  {/* VIIRS S-NPP Row */}
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-teal-400 whitespace-nowrap">
                      VIIRS (Suomi NPP)
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const dayData = days[i];
                      const active = dayData?.viirs_requested;
                      const hasDetect = (dayData?.viirs_detections ?? 0) > 0;
                      return (
                        <td key={i} className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedDay({
                                day: i + 1,
                                modisReq: Boolean(days[i]?.modis_requested),
                                viirsReq: Boolean(active),
                                modisDetect: days[i]?.modis_detections ?? 0,
                                viirsDetect: dayData?.viirs_detections ?? 0,
                              })
                            }
                            className={cn(
                              "h-7 w-full rounded flex items-center justify-center font-bold transition text-xs",
                              hasDetect
                                ? "bg-teal-500 text-slate-950"
                                : active
                                ? "bg-teal-950/70 text-teal-300 border border-teal-500/30"
                                : "bg-slate-900 text-slate-600",
                            )}
                            title={`Ngày ${i + 1}: ${dayData ? dayData.viirs_detections : 0} điểm nhiệt`}
                          >
                            {hasDetect ? dayData?.viirs_detections : active ? "R" : "-"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>

                  {/* Paired Eligibility Row */}
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-cyan-300 whitespace-nowrap">
                      {vi ? "Trạng thái đối chiếu" : "Paired Status"}
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const dayData = days[i];
                      const paired = dayData?.modis_requested && dayData?.viirs_requested;
                      return (
                        <td key={i} className="p-1 text-center">
                          <div
                            className={cn(
                              "h-5 w-full rounded flex items-center justify-center text-xs font-bold",
                              paired
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                : "bg-slate-900/60 text-slate-600",
                            )}
                          >
                            {paired ? "OK" : "-"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="pt-2 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 font-mono">
              <span><strong>R</strong> = {vi ? "Tệp đã được yêu cầu và tải về trong sổ lưu trữ" : "Requested & downloaded granule in catalog"}</span>
              <span><strong>-</strong> = {vi ? "Không có yêu cầu tệp cho ngày này" : "No request or sensor unavailable"}</span>
            </div>
          </div>

          {/* Day Detail Inspector Modal/Drawer if clicked */}
          {selectedDay && (
            <div className="rounded-xl border border-cyan-500/40 bg-[#111C2E] p-4 text-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-white text-sm">
                  {vi ? `Chi tiết ngày ${selectedDay.day}/${month}/${year}` : `Day ${selectedDay.day}/${month}/${year} Audit`}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400 text-xs block font-sans">MODIS Requested:</span>
                  <span className="text-blue-300 font-bold">{selectedDay.modisReq ? "YES (Tệp có sẵn)" : "NO"}</span>
                </div>
                <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400 text-xs block font-sans">MODIS Detections:</span>
                  <span className="text-white font-bold">{selectedDay.modisDetect}</span>
                </div>
                <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400 text-xs block font-sans">VIIRS Requested:</span>
                  <span className="text-teal-300 font-bold">{selectedDay.viirsReq ? "YES (Tệp có sẵn)" : "NO"}</span>
                </div>
                <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400 text-xs block font-sans">VIIRS Detections:</span>
                  <span className="text-white font-bold">{selectedDay.viirsDetect}</span>
                </div>
              </div>
            </div>
          )}

          {/* 7. Crucial Scientific Disclaimers */}
          <div className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
              <ShieldAlert className="h-4 w-4" />
              <span>{vi ? "Ranh giới khoa học: Sổ tệp đã tải vs Độ phủ quan trắc thực địa" : "Download Ledger vs Physical Observation Footprint"}</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {vi
                ? "Tệp NASA FIRMS ghi nhận các điểm nóng trong các hạt dữ liệu đã nạp. Một tệp được lưu chứng minh vệ tinh đã bay qua và dữ liệu đã được xử lý, nhưng không bảo đảm bầu trời quang đãng không mây. Mây mù dày, khói bụi mùa gió mùa hoặc thảm thực vật rậm có thể che khuất các đám cháy đang hoạt động."
                : "NASA FIRMS files record detections within ingested granules. A recorded granule proves the satellite overpassed and data was processed, but does not guarantee cloud-free ground visibility. Heavy smoke, cloud cover, or canopy occlusion can prevent detection of active flames."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
