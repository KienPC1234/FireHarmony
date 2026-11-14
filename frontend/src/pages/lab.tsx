import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  HelpCircle,
  Satellite,
} from "lucide-react";
import {
  api,
  describeError,
  type BlindSpotResponse,
  type CrossResponse,
  type SimResponse,
  type SpatialResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { LabSidebar } from "@/components/lab/LabSidebar";
import { SimulatorTab } from "@/components/lab/SimulatorTab";
import { BlindSpotsTab } from "@/components/lab/BlindSpotsTab";
import { SpatialCheckTab } from "@/components/lab/SpatialCheckTab";
import { CrossDatasetTab } from "@/components/lab/CrossDatasetTab";
import { BlindReplayTab } from "@/components/lab/BlindReplayTab";
import { Tab, TABS, TASK_GROUPS, type TaskGroupId } from "@/components/lab/types";
import { XrayTimelineView } from "@/components/xray/XrayTimelineView";
import { XrayTransitionIllusionView } from "@/components/xray/XrayTransitionIllusionView";
import { XrayBacktestLeaderboard } from "@/components/xray/XrayBacktestLeaderboard";
import { GlobalContextBar } from "@/components/GlobalContextBar";

export function LabPage() {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [sp, setSp] = useSearchParams();
  const initialTab = (sp.get("tab") as Tab) || "xray";
  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.id === initialTab) ? initialTab : "xray",
  );

  // Determine active task group based on active tab
  const activeGroup: TaskGroupId =
    TASK_GROUPS.find((g) => g.tabs.includes(tab))?.id ?? "compare";

  const aoi = sp.get("aoi") || "vietnam";
  const dsrc = sp.get("data") || "sample";
  const [year, setYear] = useState(2025);
  const [month, setMonth] = useState(3);
  const [sensors, setSensors] = useState<string[]>(["MODIS", "SNPP", "NOAA-20", "NOAA-21"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Sub-perspective for X-Ray
  const [xrayPerspective, setXrayPerspective] = useState<"trajectory" | "transition" | "leaderboard">("trajectory");

  // Result States
  const [sim, setSim] = useState<SimResponse | null>(null);
  const [spots, setSpots] = useState<BlindSpotResponse | null>(null);
  const [spatialRes, setSpatialRes] = useState<SpatialResponse | null>(null);
  const [crossRes, setCrossRes] = useState<CrossResponse | null>(null);
  const [xrayData, setXrayData] = useState<Awaited<ReturnType<typeof api.xray>> | null>(null);
  const [backtestData, setBacktestData] = useState<Awaited<ReturnType<typeof api.backtest>> | null>(null);

  const [burned, setBurned] = useState("");

  const updateUrl = (newTab: Tab, newAoi: string, newData: string) => {
    setSp({ tab: newTab, aoi: newAoi, data: newData });
  };

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    updateUrl(newTab, aoi, dsrc);
  };

  const handleGroupChange = (groupId: TaskGroupId) => {
    const group = TASK_GROUPS.find((g) => g.id === groupId);
    if (group && group.tabs.length > 0) {
      handleTabChange(group.tabs[0]);
    }
  };

  const handleAoiChange = (newAoi: string) => {
    updateUrl(tab, newAoi, dsrc);
  };

  const handleDataChange = (newData: string) => {
    updateUrl(tab, aoi, newData);
  };

  // Fetch X-Ray and Backtest data whenever AOI or data source changes
  useEffect(() => {
    let active = true;
    api.xray(aoi, dsrc).then((xr) => {
      if (active) setXrayData(xr);
    }).catch(() => undefined);

    api.backtest(aoi, dsrc).then((bt) => {
      if (active) setBacktestData(bt);
    }).catch(() => undefined);

    return () => {
      active = false;
    };
  }, [aoi, dsrc]);

  async function run() {
    setBusy(true);
    setErr("");
    try {
      if (tab === "simulator") {
        setSim(await api.simulate(aoi, dsrc, year, sensors));
      } else if (tab === "blindspots") {
        setSpots(await api.blindSpots(aoi, dsrc, year, month));
      } else if (tab === "spatial") {
        setSpatialRes(await api.spatialCheck(aoi, dsrc, year, month));
      } else if (tab === "cross") {
        const series = burned
          .trim()
          .split(/\n+/)
          .map((line) => {
            const [y, m, v] = line.split(/[,\s]+/).map(Number);
            return { year: y, month: m, burned_area: v };
          })
          .filter((r) => r.year && r.month && Number.isFinite(r.burned_area));
        setCrossRes(await api.crossValidate({ aoi, data: dsrc, series }));
      } else if (tab === "xray" || tab === "replay") {
        const [xr, bt] = await Promise.all([
          api.xray(aoi, dsrc),
          api.backtest(aoi, dsrc),
        ]);
        setXrayData(xr);
        setBacktestData(bt);
      }
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleSensor(id: string) {
    setSensors((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((s) => s !== id);
        return next.length > 0 ? next : prev;
      }
      return [...prev, id];
    });
  }

  // Task descriptions & questions for current tab
  const tabDetails: Record<
    Tab,
    { question: string; howItWorks: string; limits: string }
  > = {
    xray: {
      question: vi
        ? "MODIS và VIIRS lệch nhau thế nào qua các năm và bước nhảy 2012 có phải do môi trường?"
        : "How do MODIS and VIIRS diverge over time, and is the 2012 step change environmental?",
      howItWorks: vi
        ? "Phân tích chuỗi tháng song song giữa hai cảm biến, đo lường tỷ lệ k và hiệu ứng bước nhảy cảm biến năm 2012."
        : "Audits co-observed monthly series, measures empirical k-ratios, and inspects the 2012 instrument transition jump.",
      limits: vi
        ? "Cải thiện tương quan ở cấp tháng-khu vực không đảm bảo tính chính xác vi mô tại từng ô lưới ngày."
        : "Improvement at monthly AOI aggregates does not guarantee fine-scale daily pixel precision.",
    },
    replay: {
      question: vi
        ? "Mô hình ước lượng chính xác đến đâu khi dự đoán tín hiệu VIIRS từ dữ liệu chỉ có MODIS?"
        : "How accurately can models estimate the VIIRS signal when only MODIS input is available?",
      howItWorks: vi
        ? "Giấu kín dữ liệu VIIRS trong giai đoạn kiểm thử đóng băng, dùng MODIS để dự đoán và đối chiếu với dữ liệu VIIRS tham chiếu."
        : "Masks VIIRS during frozen holdout periods, estimates from MODIS, then evaluates against VIIRS reference observations.",
      limits: vi
        ? "VIIRS là dữ liệu tham chiếu quan trắc vệ tinh, không phải số đo thực địa vật lý hay kiểm chứng mặt đất tuyệt đối."
        : "VIIRS serves as satellite reference observations, not absolute in-situ ground truth.",
    },
    simulator: {
      question: vi
        ? "Lựa chọn cấu hình cảm biến thay đổi kết quả quan sát hoạt động cháy như thế nào?"
        : "How do satellite constellation choices alter observed fire activity patterns?",
      howItWorks: vi
        ? "Bật/tắt các cảm biến trong chùm vệ tinh (MODIS, Suomi NPP, NOAA-20, NOAA-21) và tính toán lại lịch hoạt động cháy."
        : "Toggles sensor constellation members to recalculate detection totals and quantify sensor omission rates.",
      limits: vi
        ? "Mô phỏng dựa trên lọc tập dữ liệu quan sát lịch sử, không mô phỏng động học quỹ đạo hay khí động học khói lửa."
        : "Simulation filters historical observational records; it does not model orbital physics or smoke dispersion.",
    },
    blindspots: {
      question: vi
        ? "Những ô ngày nào bị thiếu dữ liệu quan trắc do mây mù hoặc khoảng trống quỹ đạo?"
        : "Which daily cells lack observation coverage due to cloud cover or orbital swaths?",
      howItWorks: vi
        ? "Kiểm toán ma trận ngày yêu cầu so với ngày có dữ liệu trả về để phát hiện các lỗ hổng quan sát thực tế."
        : "Cross-checks request manifests against returned detections to map data availability gaps.",
      limits: vi
        ? "Không có bản ghi trong kho lưu trữ không đồng nghĩa với bầu trời quang đãng không có cháy."
        : "Absence of records does not prove cloud-free absence of burning.",
    },
    spatial: {
      question: vi
        ? "Hai thế hệ cảm biến trùng khớp không gian ra sao tại các đám cháy lớn?"
        : "How well do MODIS and VIIRS spatially align over active fire complexes?",
      howItWorks: vi
        ? "Vẽ bao lồi convex hull và tính toán độ phủ không gian co-observation giữa các điểm nóng ghi nhận cùng ngày."
        : "Constructs convex hulls to measure spatial intersection between sensor detections on co-observed days.",
      limits: vi
        ? "Độ phân giải 375 m của VIIRS cho đường bao chi tiết hơn nhiều so với ô pixel 1 km của MODIS."
        : "VIIRS 375 m resolution produces a finer spatial envelope than MODIS 1 km footprint.",
    },
    cross: {
      question: vi
        ? "Chỉ số hoạt động cháy có tương quan thế nào với chuỗi diện tích cháy độc lập (Burned Area)?"
        : "How well does the activity index correlate with external burned area series?",
      howItWorks: vi
        ? "Nhập chuỗi diện tích cháy (ví dụ MCD64A1) để tính hệ số tương quan Pearson và Spearman với chỉ số hiệu chuẩn."
        : "Ingests external burned area series to compute Pearson and Spearman correlation with the calibrated index.",
      limits: vi
        ? "Diện tích cháy tích lũy vết tích mặt đất, trong khi điểm nóng chỉ ghi nhận tại thời điểm vệ tinh bay qua."
        : "Burned area tracks scarred ground post-fire, whereas thermal hotspots capture instantaneous active flames.",
    },
  };

  const currentDetails = tabDetails[tab] || tabDetails.xray;

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Top Header Banner */}
      <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-sm">
              <Satellite className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  Sensor Lab
                </h1>
                <span className="font-mono text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                  {dsrc.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-slate-300">
                {vi
                  ? "Phòng thí nghiệm kiểm chứng cảm biến vệ tinh: So sánh độ lệch, mô phỏng quan trắc và đối soát độc lập."
                  : "Satellite Sensor Intelligence Lab: Dissect discrepancies, test observation choices, and validate evidence."}
              </p>
            </div>
          </div>
        </div>

        {/* 2. Three Structured Mission Task Groups */}
        <div className="grid gap-2 sm:grid-cols-3 border-t border-slate-800 pt-3">
          {TASK_GROUPS.map((g) => {
            const isGroupActive = activeGroup === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => handleGroupChange(g.id)}
                aria-pressed={isGroupActive}
                className={cn(
                  "flex flex-col items-start p-3 rounded-xl border text-left transition min-h-[64px]",
                  isGroupActive
                    ? "border-cyan-500/50 bg-cyan-950/30 shadow-sm"
                    : "border-slate-800 bg-slate-900/60 hover:bg-slate-800 hover:text-white",
                )}
              >
                <span className={cn("font-bold text-xs", isGroupActive ? "text-cyan-300" : "text-slate-200")}>
                  {vi ? g.labelVi : g.label}
                </span>
                <span className="text-xs text-slate-400 mt-0.5 leading-snug">
                  {vi ? g.descVi : g.desc}
                </span>
              </button>
            );
          })}
        </div>

        {/* 3. Sub-Tab Switcher for Active Task Group */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
          <span className="text-xs font-semibold text-slate-400 px-1">
            {vi ? "Thử nghiệm:" : "Experiment:"}
          </span>
          {TABS.filter((t) => {
            const g = TASK_GROUPS.find((grp) => grp.id === activeGroup);
            return g?.tabs.includes(t.id);
          }).map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleTabChange(t.id)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition min-h-[36px]",
                  active
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                    : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{vi ? t.labelVi : t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Global Context Bar */}
      <GlobalContextBar />

      {/* 5. Guided Experiment Protocol Card */}
      <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 text-xs space-y-2">
        <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
          <HelpCircle className="h-4 w-4" />
          <span>{vi ? "Mục tiêu & Hướng dẫn thử nghiệm" : "Experiment Objective & Protocol"}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-slate-300">
          <div>
            <span className="font-semibold text-white block mb-0.5">
              {vi ? "1. Câu hỏi khoa học:" : "1. Research Question:"}
            </span>
            <p className="text-slate-400 leading-relaxed">{currentDetails.question}</p>
          </div>
          <div>
            <span className="font-semibold text-white block mb-0.5">
              {vi ? "2. Nguyên lý thực hiện:" : "2. How It Works:"}
            </span>
            <p className="text-slate-400 leading-relaxed">{currentDetails.howItWorks}</p>
          </div>
          <div>
            <span className="font-semibold text-white block mb-0.5">
              {vi ? "3. Giới hạn cần lưu ý:" : "3. Scientific Limitations:"}
            </span>
            <p className="text-slate-400 leading-relaxed">{currentDetails.limits}</p>
          </div>
        </div>
      </div>

      {/* 6. Main Layout: Left Controls + Right Canvas */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Left Control Sidebar */}
        <div className="lg:col-span-1">
          <LabSidebar
            aoi={aoi}
            setAoi={handleAoiChange}
            dsrc={dsrc}
            setDsrc={handleDataChange}
            year={year}
            setYear={setYear}
            month={month}
            setMonth={setMonth}
            sensors={sensors}
            toggleSensor={toggleSensor}
            busy={busy}
            onRun={run}
            activeTab={tab}
          />
        </div>

        {/* Right Canvas */}
        <div className="lg:col-span-3 space-y-4">
          {err && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/20 p-3.5 text-xs text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{err}</span>
            </div>
          )}

          {/* TAB 1: SENSOR X-RAY */}
          {tab === "xray" && (
            <div className="space-y-4 animate-fade-in">
              {/* X-Ray Internal View Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#111C2E] p-2.5 text-xs">
                <span className="font-bold text-slate-300 px-1">
                  {vi ? "Góc nhìn đối soát X-Ray:" : "Audit Perspective:"}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setXrayPerspective("trajectory")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 font-semibold transition min-h-[36px]",
                      xrayPerspective === "trajectory"
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                        : "text-slate-400 hover:text-white",
                    )}
                  >
                    {vi ? "Chuỗi thời gian & Phần dư" : "Trajectory & Residuals"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setXrayPerspective("transition")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 font-semibold transition min-h-[36px]",
                      xrayPerspective === "transition"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "text-slate-400 hover:text-white",
                    )}
                  >
                    {vi ? "Bước nhảy ảo ảnh 2012" : "2012 Sensor Illusion"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setXrayPerspective("leaderboard")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 font-semibold transition min-h-[36px]",
                      xrayPerspective === "leaderboard"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "text-slate-400 hover:text-white",
                    )}
                  >
                    {vi ? "Bảng so sánh mô hình" : "Model Leaderboard"}
                  </button>
                </div>
              </div>

              {xrayData && xrayPerspective === "trajectory" && (
                <XrayTimelineView months={xrayData.months} units={xrayData.units} />
              )}

              {xrayData && xrayPerspective === "transition" && (
                <XrayTransitionIllusionView months={xrayData.months} />
              )}

              {xrayPerspective === "leaderboard" && (
                <XrayBacktestLeaderboard
                  metrics={xrayData?.backtest_metrics ?? null}
                  backtest={backtestData}
                />
              )}

              {/* Scientific Caveat */}
              <div className="rounded-xl border border-slate-800 bg-[#111C2E] p-4 text-xs text-slate-400 leading-relaxed font-mono">
                <strong>{vi ? "Thông cáo kiểm chứng khoa học:" : "Scientific Notice:"}</strong>{" "}
                {vi
                  ? "Cải thiện độ khớp giữa hai cảm biến ở mức tháng không bảo đảm độ chính xác không gian tại từng ô lưới ngày. Tín hiệu tham chiếu là dữ liệu phát hiện VIIRS, không phải kiểm chứng thực địa vật lý."
                  : "Improvement at monthly AOI aggregates does not guarantee fine-scale daily pixel precision. Reference signal is VIIRS active-fire detections, not physical ground truth of fire incidents."}
              </div>
            </div>
          )}

          {/* TAB 2: BLIND SENSOR REPLAY */}
          {tab === "replay" && (
            <BlindReplayTab
              aoi={aoi}
              data={dsrc}
              backtest={backtestData}
              loading={busy}
            />
          )}

          {/* TAB 3: MISSION SIMULATOR */}
          {tab === "simulator" && (
            <SimulatorTab sim={sim} sensors={sensors} />
          )}

          {/* TAB 4: BLIND SPOTS */}
          {tab === "blindspots" && (
            <BlindSpotsTab spots={spots} />
          )}

          {/* TAB 5: SPATIAL CO-OBSERVATION */}
          {tab === "spatial" && (
            <SpatialCheckTab spatialRes={spatialRes} />
          )}

          {/* TAB 6: CROSS-DATASET BURNED AREA */}
          {tab === "cross" && (
            <CrossDatasetTab
              burned={burned}
              setBurned={setBurned}
              crossRes={crossRes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
