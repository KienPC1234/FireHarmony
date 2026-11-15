import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Compass,
  Cpu,
  Database,
  FileCode2,
  Filter,
  FlaskConical,
  MapPin,
  MessagesSquare,
  Satellite,
  ShieldAlert,
  Sparkles,
  Upload,
  Wrench,
} from "lucide-react";
import { useLang } from "@/lib/i18n";
import { SectionQuickNav } from "@/components/common/SectionQuickNav";

interface GuideCardItem {
  step: string;
  title: string;
  desc: string;
  bullets: string[];
  to: string;
  cta: string;
}

export function GuidePage() {
  const { lang } = useLang();
  const isVi = lang === "vi";

  const navItems = isVi
    ? [
        { id: "modes", label: "2 Chế độ" },
        { id: "models-feeds", label: "Nguồn & Mô hình" },
        { id: "workflow", label: "Luồng thao tác" },
        { id: "misconceptions", label: "Dễ hiểu nhầm" },
        { id: "best-practices", label: "Thao tác chuẩn" },
        { id: "researchers", label: "Mở rộng (Nghiên cứu)" },
        { id: "ai-tools", label: "Ask AI & Tool Agent" },
        { id: "principles", label: "Nguyên tắc & FAQ" },
      ]
    : [
        { id: "modes", label: "2 Modes" },
        { id: "models-feeds", label: "Feeds & Models" },
        { id: "workflow", label: "Workflow" },
        { id: "misconceptions", label: "Misconceptions" },
        { id: "best-practices", label: "Best Practices" },
        { id: "researchers", label: "For Researchers" },
        { id: "ai-tools", label: "Ask AI & Tool Agent" },
        { id: "principles", label: "Principles & FAQ" },
      ];

  const workflowCards: GuideCardItem[] = isVi
    ? [
        {
          step: "Bước 1",
          title: "Chọn vùng & tải dữ liệu NASA FIRMS",
          desc: "Dùng dữ liệu NASA FIRMS đã nạp sẵn trên 3 vùng nghiên cứu hoặc tải dữ liệu trực tiếp cho vùng bạn quan tâm.",
          bullets: [
            "Chọn vùng nghiên cứu (Vietnam, Amazon, Australia), vùng custom trong aois.json, hoặc bấm Draw / Box / Lat-Lon Input trên bản đồ.",
            "Giữ vùng chọn gọn (tối đa 35° × 35°, ưu tiên vùng rừng dễ cháy) để tránh bị API từ chối.",
            "Chọn Start date và End date (tối đa 14 ngày/lần) rồi bấm Fetch NASA FIRMS data; kết quả được cache (live:*) cho lần xem sau.",
          ],
          to: "/calendar?aoi=vietnam",
          cta: "Mở Calendar & Bản đồ",
        },
        {
          step: "Bước 2",
          title: "Dùng Timeline & Bộ lọc dữ liệu",
          desc: "Bổ sung ngày còn thiếu trên Timeline và lọc điểm nóng theo chất lượng hoặc vệ tinh.",
          bullets: [
            "Trên Timeline: ngày có chấm cam là ngày có phát hiện điểm nóng; bấm vào ngày chưa có dữ liệu để tải bổ sung ngày đó.",
            "Dùng menu mở rộng (Expand left / right) để lấy thêm ngày trong giới hạn cho phép (tự ẩn hướng bất khả thi như tương lai).",
            "Sidebar hỗ trợ lọc QA (all / nominal / high), Platform (All / SNPP), Source (MODIS / VIIRS), Day/Night và Min FRP.",
          ],
          to: "/calendar?aoi=vietnam",
          cta: "Thao tác trên Timeline",
        },
        {
          step: "Bước 3",
          title: "Đọc bản đồ, lưới lịch & Xuất CSV",
          desc: "Hiểu đúng ý nghĩa các điểm trên bản đồ và màu bất thường trước khi tải báo cáo.",
          bullets: [
            "Bản đồ: chấm xanh lục là VIIRS (375 m), chấm xám là MODIS (1 km); vòng cam là cụm điểm nóng quan sát được, KHÔNG phải ranh giới đám cháy.",
            "Lưới lịch tháng×năm: màu xanh lam là thấp hơn trung vị lịch sử (z < 0), cam/đỏ là cao hơn trung vị (z > 0).",
            "Bấm Download trên Calendar để xuất tệp harmonized_hotspots.csv theo đúng bộ lọc đang bật.",
          ],
          to: "/evidence?aoi=vietnam",
          cta: "Xem Evidence",
        },
      ]
    : [
        {
          step: "Step 1",
          title: "Select Region & Fetch NASA FIRMS Data",
          desc: "Explore archived presets or fetch live NASA FIRMS hotspot detections for a custom forest region.",
          bullets: [
            "Pick a preset AOI (Vietnam, Amazon, Australia) or use Draw / Box / Lat-Lon Input on the map.",
            "Keep custom boxes compact (max 35° × 35°, focused on fire-prone forest regions) so NASA FIRMS accepts the query.",
            "Set Start date and End date (max 14 days per fetch) and click Fetch NASA FIRMS data; results are cached (live:*) for reuse.",
          ],
          to: "/calendar?aoi=vietnam",
          cta: "Open Calendar & Map",
        },
        {
          step: "Step 2",
          title: "Timeline Expansion & Sidebar Filters",
          desc: "Fill missing dates directly from the Timeline and filter detections by quality or satellite.",
          bullets: [
            "On the Timeline, orange dots indicate days with hotspot detections; click a missing day to confirm and fetch that date.",
            "Use Expand left / right to fetch extra days within valid past/present bounds (impossible directions like future dates stay hidden).",
            "Filter by QA (all / nominal / high), Platform (All / SNPP), Source (MODIS / VIIRS), Day/Night, and Min FRP.",
          ],
          to: "/calendar?aoi=vietnam",
          cta: "Try Timeline",
        },
        {
          step: "Step 3",
          title: "Read Map, Calendar & Export CSV",
          desc: "Interpret satellite detections and anomaly z-scores accurately before exporting.",
          bullets: [
            "Map markers: cyan dots are VIIRS (375 m), grey dots are MODIS (1 km); orange rings are hotspot clusters, NOT burned-area perimeters.",
            "Month×year grid: blue indicates below historical median (z < 0), while orange/red indicates above median (z > 0).",
            "Click Download on Calendar to export harmonized_hotspots.csv matching your active filters.",
          ],
          to: "/evidence?aoi=vietnam",
          cta: "Inspect Evidence",
        },
      ];

  const faqs = isVi
    ? [
        {
          q: "Vì sao số điểm từ năm 2012 tăng mạnh?",
          a: "Từ năm 2012 có thêm vệ tinh VIIRS (375 m) nhạy hơn MODIS (1 km), nên số điểm nóng thô tăng lên. Hệ thống tính hệ số k = MODIS/VIIRS theo tháng để quy đổi về cùng thang đo.",
        },
        {
          q: "Vì sao dữ liệu live, upload CSV hoặc vùng vẽ tay không dùng STAN/HTS?",
          a: "HTS và STAN yêu cầu lịch sử tile 12 tháng toàn AOI chuẩn (Vietnam, Amazon, Australia không cắt bbox/polygon). Với dữ liệu live:*, upload:* hoặc vùng vẽ tùy chỉnh, hệ thống dùng mô hình thống kê (stat / B2) để đảm bảo kết quả nhất quán.",
        },
        {
          q: "3 vùng Vietnam, Amazon, Australia có phải dữ liệu giả (Sample) không?",
          a: "Không. Đây là 3 vùng nghiên cứu chuẩn có sẵn dữ liệu vệ tinh NASA FIRMS thật khi chọn DATA FEED = NASA Raw. Chỉ khi chuyển sang Sample thì hệ thống mới dùng bộ dữ liệu tổng hợp minh họa.",
        },
        {
          q: "Ngày hoặc tháng trống có nghĩa là không có cháy?",
          a: "Không. Ô trống nghĩa là thiếu dữ liệu quét, mây che hoặc ngoài vệt vệ tinh, không bao giờ đồng nghĩa với 0 đám cháy.",
        },
      ]
    : [
        {
          q: "Why do raw detections jump starting in 2012?",
          a: "VIIRS (375 m) launched in 2012 and detects smaller/cooler hotspots than MODIS (1 km). The pipeline computes monthly k = MODIS/VIIRS ratios to harmonize both eras.",
        },
        {
          q: "Why do live, uploaded CSV, or custom-drawn regions fall back from STAN/HTS?",
          a: "HTS and STAN require full-AOI 12-month tile histories (Vietnam, Amazon, Australia without bbox/polygon slicing). Live (live:*), uploaded (upload:*), and custom-drawn requests use statistical calibration (stat / B2) for reliable parity.",
        },
        {
          q: "Are Vietnam, Amazon, and Australia synthetic sample data?",
          a: "No. They are preset study regions backed by real NASA FIRMS satellite archives when DATA FEED is set to NASA Raw. Synthetic data is only used when you explicitly switch DATA FEED to Sample.",
        },
        {
          q: "Does an empty day or month mean zero fires?",
          a: "No. Empty slots indicate missing passes, cloud/smoke cover, or unrequested dates, never proof of zero fire.",
        },
      ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 space-y-8 max-w-6xl mx-auto w-full pb-24">
      <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#111C2E] via-[#0E1626] to-[#131021] p-6 sm:p-9 space-y-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
          <BookOpen className="h-4 w-4" />
          <span>{isVi ? "Hướng dẫn sử dụng" : "User Guide"}</span>
        </div>
        <div className="space-y-2 max-w-3xl">
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
            {isVi
              ? "Hướng dẫn thao tác Fire Activity Calendar"
              : "How to Use Fire Activity Calendar"}
          </h1>
          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            {isVi
              ? "Tóm tắt nhanh các thao tác chính trên web: tải dữ liệu NASA FIRMS, đọc bản đồ và timeline, dùng bộ lọc và hỏi AI Tool Agent."
              : "Quick walkthrough of core workflows: fetching NASA FIRMS data, reading the map and timeline, filtering detections, and querying the AI Tool Agent."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/calendar?aoi=vietnam"
            className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-orange-500 transition min-h-[42px]"
          >
            <CalendarDays className="h-4 w-4" />
            <span>{isVi ? "Mở Fire Calendar" : "Open Fire Calendar"}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/investigator"
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-5 py-2.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-900/50 transition min-h-[42px]"
          >
            <Sparkles className="h-4 w-4 text-amber-300" />
            <span>{isVi ? "Hỏi AI (Tool Agent)" : "Ask AI (Tool Agent)"}</span>
          </Link>
          <Link
            to="/lab?tab=xray"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-5 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-700 transition min-h-[42px]"
          >
            <FlaskConical className="h-4 w-4 text-cyan-300" />
            <span>{isVi ? "Mở Lab & X-Ray" : "Open Lab & X-Ray"}</span>
          </Link>
        </div>
      </section>

      <SectionQuickNav title={isVi ? "Mục lục" : "Sections"} items={navItems} />

      <section id="modes" className="grid gap-4 md:grid-cols-2 scroll-mt-24">
        <div className="rounded-2xl border border-emerald-500/25 bg-[#111C2E] p-6 space-y-2.5">
          <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
            <Compass className="h-4 w-4" />
            <span>{isVi ? "Chế độ Khám phá (Explore)" : "Explore Mode"}</span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            {isVi
              ? "Giao diện gọn nhẹ cho người dùng phổ thông: xem bản đồ điểm nóng, Timeline theo ngày, tải dữ liệu NASA FIRMS và hỏi AI bằng ngôn ngữ dễ hiểu."
              : "Streamlined view for general exploration: hotspot map, daily Timeline, live NASA FIRMS fetching, and plain-language AI explanations."}
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-500/25 bg-[#111C2E] p-6 space-y-2.5">
          <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm">
            <Filter className="h-4 w-4" />
            <span>{isVi ? "Chế độ Nghiên cứu (Research)" : "Research Mode"}</span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            {isVi
              ? "Mở khóa đầy đủ bộ lọc QA/SNPP/FRP, so sánh mô hình STAN/HTS/B2, trang Evidence và bảng kiểm định sai số X-Ray."
              : "Unlocks QA/SNPP/FRP filters, STAN/HTS/B2 calibration comparison, Evidence cards, and X-Ray backtest parity."}
          </p>
        </div>
      </section>

      <section id="models-feeds" className="grid gap-4 md:grid-cols-2 scroll-mt-24">
        <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 space-y-3">
          <div className="flex items-center gap-2 text-emerald-300 font-bold text-base">
            <Database className="h-4 w-4" />
            <span>{isVi ? "Nguồn dữ liệu (DATA FEED)" : "Data Feeds (NASA Raw vs Sample)"}</span>
          </div>
          <ul className="space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed list-disc pl-4">
            <li>
              <strong className="text-white">NASA Raw:</strong>{" "}
              {isVi
                ? "Đọc trực tiếp dữ liệu quan trắc vệ tinh NASA FIRMS thật (MODIS + VIIRS) đã nạp sẵn cho vùng nghiên cứu hoặc fetch mới qua API."
                : "Reads real NASA FIRMS satellite observations (MODIS + VIIRS) from ingested archives or live API fetches."}
            </li>
            <li>
              <strong className="text-white">Sample:</strong>{" "}
              {isVi
                ? "Bộ dữ liệu tổng hợp nhẹ dùng để chạy thử khi máy chưa nạp NASA Raw. Hệ thống tự khóa nút Sample nếu vùng/bộ lọc hiện tại không có bản sample tương ứng."
                : "Lightweight synthetic dataset for quick demos without NASA Raw archives. Locked automatically when the selected AOI or filter has no sample bundle."}
            </li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 space-y-3">
          <div className="flex items-center gap-2 text-cyan-300 font-bold text-base">
            <Cpu className="h-4 w-4" />
            <span>{isVi ? "Mô hình hiệu chỉnh (CALIBRATION MODEL)" : "Calibration Models (STAN / HTS / B2)"}</span>
          </div>
          <ul className="space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed list-disc pl-4">
            <li>
              <strong className="text-white">STAN (main) & HTS (fallback):</strong>{" "}
              {isVi
                ? "Dùng trên toàn AOI chuẩn (Vietnam, Amazon, Australia) khi có đủ lịch sử tile 12 tháng và không cắt bbox/polygon."
                : "Available on full preset AOIs (Vietnam, Amazon, Australia) with 12-month tile histories and no custom bbox/polygon slicing."}
            </li>
            <li>
              <strong className="text-white">B2 (baseline) / statistical:</strong>{" "}
              {isVi
                ? "Áp dụng tự động cho vùng custom, vẽ tay, dữ liệu live:* hoặc file CSV upload để bảo đảm độ ổn định thống kê."
                : "Automatically used for custom AOIs, drawn polygons, live:* fetches, and uploaded CSVs to keep statistical parity."}
            </li>
          </ul>
        </div>
      </section>

      <section id="workflow" className="space-y-4 scroll-mt-24">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <MapPin className="h-5 w-5 text-cyan-400" />
          <span>{isVi ? "Luồng thao tác 3 bước" : "3-Step Core Workflow"}</span>
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {workflowCards.map((card) => (
            <article key={card.title} className="flex flex-col rounded-2xl border border-slate-800 bg-[#111C2E] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-0.5 text-xs font-bold text-cyan-300">
                  {card.step}
                </span>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-white">{card.title}</h3>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">{card.desc}</p>
              </div>
              <ul className="space-y-2 text-xs sm:text-sm text-slate-200 leading-relaxed list-disc pl-4">
                {card.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <Link
                to={card.to}
                className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-xs sm:text-sm font-semibold text-cyan-300 hover:bg-slate-700 hover:text-white transition"
              >
                <span>{card.cta}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section id="misconceptions" className="rounded-2xl border border-amber-500/25 bg-[#111C2E] p-6 sm:p-8 space-y-4 scroll-mt-24">
        <div className="flex items-center gap-2 text-amber-300 font-bold text-lg">
          <AlertTriangle className="h-5 w-5" />
          <span>{isVi ? "Những điểm dễ hiểu nhầm khi đọc dữ liệu" : "Common Misconceptions"}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 text-xs sm:text-sm">
          {(isVi
            ? [
                [
                  "Hotspot ≠ Số đám cháy thực",
                  "Mỗi điểm là 1 pixel phát hiện nhiệt (VIIRS 375 m / MODIS 1 km). Một đám cháy lớn tạo nhiều điểm; vòng cam là cụm điểm (convex hull), không phải ranh giới cháy rừng.",
                ],
                [
                  "Ô trống ≠ Không có cháy",
                  "Ngày hoặc tháng trống có thể do mây/khói che, ngoài vệt quét vệ tinh hoặc chưa fetch dữ liệu, không đồng nghĩa với 0 đám cháy.",
                ],
                [
                  "Vietnam / Amazon / Australia ≠ Sample",
                  "Đây là 3 vùng nghiên cứu chuẩn có dữ liệu vệ tinh NASA FIRMS thật khi bật NASA Raw. Chỉ DATA FEED = Sample mới là dữ liệu tổng hợp minh họa.",
                ],
                [
                  "Tăng vọt từ 2012 ≠ Cháy tăng đột biến",
                  "Năm 2012 có thêm cảm biến VIIRS (375 m) nhạy hơn MODIS (1 km). Hãy đọc Calibrated Activity và z-score thay vì số đếm thô.",
                ],
                [
                  "B2 / statistical trên vùng custom ≠ Lỗi",
                  "STAN/HTS cần lịch sử tile 12 tháng toàn AOI chuẩn. Khi cắt bbox/polygon hoặc dùng live:*/upload:*, hệ thống dùng B2/thống kê để tránh ngoại suy sai.",
                ],
                [
                  "Preview 5,000 cells ≠ Dữ liệu bị cắt",
                  "Bản đồ giới hạn số điểm vẽ trực tiếp để mượt UI, nhưng lưới lịch tháng×năm, z-score và file CSV xuất ra vẫn tính trên toàn bộ dữ liệu lọc.",
                ],
              ]
            : [
                [
                  "Hotspots ≠ Ground Fire Counts",
                  "Each point is a thermal pixel (VIIRS 375 m / MODIS 1 km). One large fire produces multiple hotspots; orange rings are cluster hulls, not burned-area perimeters.",
                ],
                [
                  "Empty Cell ≠ Zero Fires",
                  "Blank days or months indicate cloud/smoke cover, satellite swath gaps, or unrequested dates, never proof of zero fire.",
                ],
                [
                  "Preset Regions ≠ Sample Data",
                  "Vietnam, Amazon, and Australia use real NASA FIRMS observations when DATA FEED = NASA Raw. Only DATA FEED = Sample serves synthetic demo data.",
                ],
                [
                  "2012 Raw Jump ≠ Real Fire Surge",
                  "VIIRS (375 m) launched in 2012 and detects finer hotspots than MODIS (1 km). Compare Calibrated Activity and z-scores instead of raw counts.",
                ],
                [
                  "B2 Fallback on Custom AOI ≠ Model Error",
                  "STAN/HTS require full-AOI 12-month tile histories. Custom bbox/polygon, live:*, and upload:* queries use B2/statistical calibration for stability.",
                ],
                [
                  "Map 5,000-Cell Preview ≠ Truncated Stats",
                  "The map caps rendered markers for smooth rendering, while the Year × month matrix, z-scores, and CSV export aggregate the full filtered dataset.",
                ],
              ]
          ).map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-amber-500/20 bg-slate-900/60 p-4 space-y-1.5">
              <div className="font-bold text-amber-200">{title}</div>
              <p className="text-slate-300 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="best-practices" className="rounded-2xl border border-emerald-500/25 bg-[#111C2E] p-6 sm:p-8 space-y-4 scroll-mt-24">
        <div className="flex items-center gap-2 text-emerald-300 font-bold text-lg">
          <CheckCircle2 className="h-5 w-5" />
          <span>{isVi ? "Thao tác chuẩn cho người dùng & nhà nghiên cứu" : "Standard Operating Practices"}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 text-xs sm:text-sm">
          {(isVi
            ? [
                [
                  "1. Khám phá nhanh (Explore)",
                  "Giữ DATA FEED = NASA Raw, chọn vùng nghiên cứu -> mở tab Year × month để tìm tháng có z > 0 -> bấm vào tháng đó để kiểm tra điểm nóng trên bản đồ và Selected Month.",
                ],
                [
                  "2. Tải dữ liệu Live (Fetch NASA FIRMS)",
                  "Khoanh vùng gọn (tối đa 35° × 35°), tải từng khoảng ngắn (tối đa 14 ngày/lần), kiểm tra chấm cam trên Timeline trước khi bấm Expand để tránh gọi API trùng lặp.",
                ],
                [
                  "3. So sánh đa năm & xuất báo cáo (Research)",
                  "Bật chế độ Research, cố định bộ lọc (QA, Source, Day/Night, Min FRP) trước khi so sánh giữa các năm hoặc tải harmonized_hotspots.csv; luôn đối chiếu sai số trên X-Ray / Sensor Lab.",
                ],
                [
                  "4. Mở rộng vùng cho dự án clone",
                  "Khai báo vùng mới trong mục custom của backend/data/firms/aois.json thay vì sửa cứng presets; dùng Saved Custom AOIs trên bản đồ cho các vùng thử nghiệm nhanh.",
                ],
              ]
            : [
                [
                  "1. Quick Exploration (Explore)",
                  "Keep DATA FEED = NASA Raw, pick a study region -> open Year × month to spot anomalous months (z > 0) -> click a cell to inspect hotspots on the map and Selected Month.",
                ],
                [
                  "2. Live Fetching (NASA FIRMS)",
                  "Keep custom boxes compact (max 35° × 35°), fetch short windows (max 14 days/request), and check Timeline indicators before clicking Expand to avoid redundant API calls.",
                ],
                [
                  "3. Multi-Year Research & Export",
                  "Switch to Research mode, lock filters (QA, Source, Day/Night, Min FRP) before comparing years or exporting harmonized_hotspots.csv, and verify parity in X-Ray / Sensor Lab.",
                ],
                [
                  "4. Extending Cloned Repos",
                  "Add new regions under custom in backend/data/firms/aois.json instead of hardcoding presets; use Saved Custom AOIs on the map for ad-hoc exploratory polygons.",
                ],
              ]
          ).map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-emerald-500/20 bg-slate-900/60 p-4 space-y-1.5">
              <div className="font-bold text-emerald-200">{title}</div>
              <p className="text-slate-300 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="researchers" className="rounded-2xl border border-cyan-500/25 bg-[#111C2E] p-6 sm:p-8 space-y-4 scroll-mt-24">
        <div className="flex items-center gap-2 text-white font-bold text-lg">
          <FileCode2 className="h-5 w-5 text-cyan-400" />
          <span>{isVi ? "Dành cho nhà nghiên cứu mở rộng dự án" : "Extending the Project for Research"}</span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed max-w-3xl">
          {isVi
            ? "Khi clone repository để nghiên cứu trên vùng rừng riêng, bạn có thể mở rộng dữ liệu và vùng quan tâm mà không cần sửa code giao diện:"
            : "When cloning the repository for your own study area, you can extend regions and datasets without modifying UI code:"}
        </p>
        <div className="grid gap-4 md:grid-cols-3 text-xs sm:text-sm">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="font-bold text-cyan-300 flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              <span>{isVi ? "1. Khai báo AOI trong JSON" : "1. Register AOIs in JSON"}</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              {isVi
                ? "Thêm vùng mới vào mục custom trong backend/data/firms/aois.json với label và bbox. API /api/firms/aois và thanh chọn AOI sẽ tự động nhận."
                : "Add new regions under custom in backend/data/firms/aois.json with label and bbox. GET /api/firms/aois and the sidebar pick them up automatically."}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="font-bold text-emerald-300 flex items-center gap-1.5">
              <Upload className="h-4 w-4" />
              <span>{isVi ? "2. Nạp CSV hoặc vẽ trực tiếp" : "2. Upload CSV or Draw AOI"}</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              {isVi
                ? "Vẽ polygon/box trực tiếp trên bản đồ để lưu vào Saved Custom AOIs, hoặc tải lên tệp CSV điểm cháy riêng qua menu Actions."
                : "Draw polygons/boxes on the map to save in Saved Custom AOIs, or upload your own hotspot CSV via the Actions menu."}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <FlaskConical className="h-4 w-4" />
              <span>{isVi ? "3. Kiểm định trên Lab & Methods" : "3. Audit in Lab & Methods"}</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              {isVi
                ? "Dùng trang Evidence, Sensor Lab, X-Ray và Methods để đối chiếu sai số MAE/WAPE giữa các vệ tinh và mô hình."
                : "Use Evidence, Sensor Lab, X-Ray, and Methods to inspect MAE/WAPE parity across sensors and calibration models."}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/methods" className="text-cyan-300 hover:underline font-semibold">Methods</Link>
              <Link to="/lab" className="text-cyan-300 hover:underline font-semibold">Sensor Lab</Link>
              <Link to="/evidence" className="text-cyan-300 hover:underline font-semibold">Evidence</Link>
            </div>
          </div>
        </div>
      </section>

      <section id="ai-tools" className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 sm:p-8 space-y-4 scroll-mt-24">
        <div className="flex items-center gap-2 text-white font-bold text-lg">
          <MessagesSquare className="h-5 w-5 text-amber-400" />
          <span>{isVi ? "Ask AI Tool Agent hoạt động thế nào?" : "How the Ask AI Tool Agent Works"}</span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed max-w-3xl">
          {isVi
            ? "Thay vì nhồi toàn bộ dữ liệu vào prompt, mô hình AI (gemma4:cloud qua Ollama) tự chọn và gọi đúng tool cần thiết rồi hiển thị danh sách tool đã gọi ngay trên câu trả lời:"
            : "Instead of stuffing the entire dataset into a single prompt, the AI (gemma4:cloud via Ollama) dynamically invokes only the relevant tools and displays every tool call on the response card:"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          {[
            ["get_help_guide", isVi ? "Hướng dẫn thao tác UI" : "UI operation help"],
            ["get_region_summary", isVi ? "Tóm tắt vùng & bộ lọc" : "Region & filter summary"],
            ["get_month_evidence", isVi ? "Bằng chứng tháng & coverage" : "Month evidence & coverage"],
            ["get_critical_periods", isVi ? "Các tháng cao điểm bất thường" : "Top anomalous months"],
            ["get_evaluation_metrics", isVi ? "Sai số MAE / WAPE" : "MAE / WAPE parity metrics"],
            ["get_sensor_comparison", isVi ? "So sánh MODIS & VIIRS" : "MODIS vs VIIRS comparison"],
            ["get_seasonal_climatology", isVi ? "Trung vị 12 tháng theo mùa" : "12-month seasonal medians"],
            ["get_yearly_comparison", isVi ? "So sánh tổng hợp theo năm" : "Annual comparison"],
          ].map(([name, desc]) => (
            <div key={name} className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 space-y-1">
              <div className="flex items-center gap-1.5 font-mono font-semibold text-emerald-300">
                <Wrench className="h-3.5 w-3.5 shrink-0" />
                <span>{name}</span>
              </div>
              <p className="text-slate-300">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="principles" className="grid gap-4 lg:grid-cols-2 scroll-mt-24">
        <div className="rounded-2xl border border-amber-500/25 bg-[#111C2E] p-6 space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-400" />
            <span>{isVi ? "3 Nguyên tắc đọc số liệu" : "3 Scientific Principles"}</span>
          </h2>
          <ul className="space-y-2.5 text-sm text-slate-300 leading-relaxed">
            <li className="flex gap-2">
              <Satellite className="h-4 w-4 mt-1 shrink-0 text-cyan-400" />
              <span>
                {isVi
                  ? "Đơn vị luôn là lượt phát hiện điểm nóng (hotspot detections / sensor-adjusted index), không phải số đám cháy thực."
                  : "Units are always hotspot detections or sensor-adjusted activity index, never confirmed ground fire counts."}
              </span>
            </li>
            <li className="flex gap-2">
              <Database className="h-4 w-4 mt-1 shrink-0 text-emerald-400" />
              <span>
                {isVi
                  ? "Dữ liệu Sample là dữ liệu tổng hợp để minh họa; dữ liệu Live/NASA là quan trắc vệ tinh thực."
                  : "Sample data is synthetic for demonstration; Live/NASA datasets are satellite observations."}
              </span>
            </li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">
            {isVi ? "Câu hỏi thường gặp" : "Frequently Asked Questions"}
          </h2>
          <div className="space-y-3">
            {faqs.map((item) => (
              <div key={item.q} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-1">
                <div className="text-sm font-semibold text-white">{item.q}</div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
