import { useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BrainCircuit,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { Latex } from "@/components/common/Latex";

interface NodePayload {
  id: string;
  titleVi: string;
  titleEn: string;
  categoryVi: string;
  categoryEn: string;
  badgeVi?: string;
  badgeEn?: string;
  badgeTone?: "emerald" | "amber" | "sky" | "blue" | "purple";
  shape?: string;
  formula?: string;
  descVi: string;
  descEn: string;
  active?: boolean;
}

const ARCH_NODES_DATA: Record<string, NodePayload> = {
  modis_input: {
    id: "modis_input",
    titleVi: "MODIS C6.1 Chuỗi Thô",
    titleEn: "Raw MODIS C6.1 Stream",
    categoryVi: "Dữ liệu vệ tinh",
    categoryEn: "Satellite Observation",
    badgeVi: "1 km · Terra & Aqua",
    badgeEn: "1 km · Terra & Aqua",
    badgeTone: "blue",
    shape: "[B, T=12, C=1]",
    formula: "x_{modis} = \\sum_{d \\in m} \\text{detections}(d)",
    descVi:
      "Dữ liệu nhiệt độ sáng 1 km từ Terra (10:30) và Aqua (13:30). Chuỗi quan trắc khí hậu nền tảng 25 năm liên tục từ 2000.",
    descEn:
      "1 km thermal observations from Terra (10:30) and Aqua (13:30). Continuous 25-year multi-decadal record.",
  },
  covariates_input: {
    id: "covariates_input",
    titleVi: "Mã Hóa Chu Kỳ Mùa & Thiên Văn",
    titleEn: "Cyclic & Astronomical Encodings",
    categoryVi: "Đặc trưng phụ trợ",
    categoryEn: "Covariate Encodings",
    badgeVi: "Fourier Phase",
    badgeEn: "Fourier Phase",
    badgeTone: "sky",
    shape: "[B, T=12, C=4]",
    formula: "[\\sin(2\\pi m/12), \\cos(2\\pi m/12), \\text{day\\_frac}, \\text{terra\\_frac}]",
    descVi:
      "Mã hóa góc chiếu mặt trời, pha mùa vụ và tỷ lệ quan sát ngày/đêm để phản ánh sự thay đổi độ nhạy của cảm biến theo chu kỳ.",
    descEn:
      "Cyclic seasonal harmonics, solar elevation proxy, and day/night fractions capturing periodic sensor bias.",
  },
  aoi_embedding: {
    id: "aoi_embedding",
    titleVi: "Embedding Sinh Cảnh AOI",
    titleEn: "Regional Biome Embedding",
    categoryVi: "Đặc trưng không gian",
    categoryEn: "Spatial Biome Prior",
    badgeVi: "Spatial Prior",
    badgeEn: "Spatial Prior",
    badgeTone: "purple",
    shape: "[B, d=8]",
    formula: "e_{aoi} = \\text{Embedding}(\\text{region\\_id})",
    descVi:
      "Vector đặc trưng không gian đại diện cho từng vùng nghiên cứu (Tây Nguyên, Amazon, Đông Nam Úc) phản ánh đặc thù sinh cảnh cháy.",
    descEn:
      "Spatial prior embedding capturing biome-specific fuel moisture, canopy structure, and local fire regime dynamics.",
  },
  tokenizer: {
    id: "tokenizer",
    titleVi: "Bộ Ghép Đặc Trưng & Chiếu Tuyến Tính",
    titleEn: "Feature Tokenizer & Linear Projection",
    categoryVi: "Tiền xử lý học sâu",
    categoryEn: "Projection Layer",
    badgeVi: "Linear Projection",
    badgeEn: "Linear Projection",
    badgeTone: "sky",
    shape: "[B, T=12, d=64]",
    formula: "z = \\text{LayerNorm}(W_p [x_{modis} \\Vert c_{time} \\Vert e_{aoi}] + b_p)",
    descVi:
      "Ghép nối đa nguồn tín hiệu viễn thám và chiếu vào không gian tiềm ẩn d=64 chiều trước khi đưa vào các khối xử lý tiếp theo.",
    descEn:
      "Concatenates multi-modal remote sensing streams and projects into a 64-dimensional latent embedding space.",
  },
  b2_anchor: {
    id: "b2_anchor",
    titleVi: "Nhánh A: Neo Mùa Vụ B2 (Mô hình đối chứng)",
    titleEn: "Branch A: Operational B2 Seasonal Baseline",
    categoryVi: "Mỏ neo đối chứng nền tảng",
    categoryEn: "Baseline Reference Backbone",
    badgeVi: "ĐỐI CHỨNG · MAE 4.411,8",
    badgeEn: "BASELINE · MAE 4,411.8",
    badgeTone: "sky",
    shape: "[12] Monthly Ratios",
    formula: "k_m = \\text{median}_{y \\in \\text{train}} \\left( \\frac{y_{viirs, y, m}}{x_{modis, y, m}} \\right)",
    descVi:
      "Mô hình thống kê đối chứng: Sử dụng 12 hệ số trung vị tỷ lệ theo tháng lịch sử. Ổn định toán học cao, hoàn toàn không rò rỉ dữ liệu.",
    descEn:
      "Empirical reference baseline: 12-month median harmonic ratio. High mathematical stability, zero data leakage.",
    active: false,
  },
  hts_anchor: {
    id: "hts_anchor",
    titleVi: "Nhánh C: HTS - Neo Mùa Vụ Theo Ô 1° (Dự phòng)",
    titleEn: "Branch C: HTS 1° Tile-Seasonal Spatial Anchor",
    categoryVi: "Mô hình không gian dự phòng",
    categoryEn: "Spatial Fallback Anchor",
    badgeVi: "NEO KHÔNG GIAN · MAE 4.154,4",
    badgeEn: "SPATIAL ANCHOR · MAE 4,154.4",
    badgeTone: "amber",
    shape: "[AOI-month]",
    formula: "\\hat{y}_{tile,m} = w\\,\\mathrm{median}_{tile,m} + (1-w)\\,B2_{aoi,m}",
    descVi:
      "Chia AOI thành ô 1°, mỗi ô có tỷ lệ mùa riêng co về B2 (w=n/(n+3)); cộng ô-tháng lên AOI. Giảm MAE 5,8% và là mỏ neo không gian cho STAN.",
    descEn:
      "Split the AOI into 1° tiles, each with a seasonal ratio shrunk toward B2 (w=n/(n+3)); spatial anchor for STAN.",
  },
  stan_core: {
    id: "stan_core",
    titleVi: "Nhánh B: STAN - Mạng Không-Thời Gian (Chủ lực vận hành)",
    titleEn: "Branch B: STAN Spatio-Temporal Core (Operational)",
    categoryVi: "Mô hình Deep Learning chủ lực",
    categoryEn: "Primary Operational Deep Model",
    badgeVi: "CHỦ LỰC · MAE 3.765,8 (-14,6%)",
    badgeEn: "OPERATIONAL · MAE 3,765.8 (-14.6%)",
    badgeTone: "emerald",
    shape: "Causal TCN + FiLM + Attention · NB2",
    formula: "\\hat{y}_{t} = \\text{HTS}_{t} \\cdot \\exp(f_{\\theta}(X_{t-11:t}, m_t, \\text{AOI}))",
    descVi:
      "Kiến trúc học sâu chủ lực vận hành: Dilated Causal TCN kết hợp điều biến mùa FiLM, cơ chế chú ý tháng đích và hàm mất mát Negative Binomial NB2. Giảm -14,6% MAE (tỷ lệ thắng 95,8%; 3.765,8 vs B2 4.411,8).",
    descEn:
      "Primary operational architecture: Dilated causal TCN with seasonal FiLM modulation, target-month attention, and NB2 loss. Achieves -14.6% MAE reduction (95.8% win rate; 3,765.8 vs B2 4,411.8).",
    active: true,
  },
  gate_controller: {
    id: "gate_controller",
    titleVi: "Statistical Gate Controller",
    titleEn: "Statistical Gate Verification",
    categoryVi: "Khóa an toàn khoa học",
    categoryEn: "Statistical Safety Gate",
    badgeVi: "CHỦ LỰC · STAN VẬN HÀNH",
    badgeEn: "PRIMARY · STAN SERVED",
    badgeTone: "emerald",
    shape: "Boolean Control {0, 1}",
    formula: "\\Delta \\text{MAE} = -14.6\\% \\land \\text{Win} = 95.8\\% \\land \\text{All 3 AOIs} > \\text{B2}",
    descVi:
      "Kiểm định lựa chọn vận hành: STAN đạt MAE gộp thấp nhất (-14,6% vs B2, tỷ lệ thắng 95,8%) và cải thiện cả 3 vùng; 95% bootstrap CI [-1.452,9, +81,8] vẫn chứa 0.",
    descEn:
      "Operational selection check: STAN achieves the lowest pooled MAE (-14.6% vs B2, 95.8% win rate) and improves every AOI over B2, though 95% bootstrap CI [-1,452.9, +81.8] includes 0.",
    active: true,
  },
  output_telemetry: {
    id: "output_telemetry",
    titleVi: "Chỉ Số Hoạt Động Cháy Chuẩn Hóa",
    titleEn: "Standardized Fire Activity Index",
    categoryVi: "Dòng dữ liệu đầu ra",
    categoryEn: "Calibrated Output Stream",
    badgeVi: "25 NĂM THỐNG NHẤT · 95% CI",
    badgeEn: "25 YEARS UNIFIED · 95% CI",
    badgeTone: "emerald",
    shape: "[B, 1] + [Lower, Upper]",
    formula: "\\hat{y}_t = \\text{HTS}_t \\cdot \\exp(\\delta_t) \\quad [\\text{STAN Operational}]",
    descVi:
      "Chỉ số tương đương VIIRS 375m thống nhất trên toàn bộ 25 năm (2001 - 2025), loại bỏ bước nhảy cảm biến 2012 và có khoảng tin cậy 95%.",
    descEn:
      "VIIRS-equivalent hotspot activity series with the artificial 2012 sensor step reduced, an uncertainty envelope, and per-cell estimated/observed labels.",
    active: true,
  },
};

function CustomArchNode({ data }: NodeProps) {
  const { t, lang } = useLang();
  const node = ARCH_NODES_DATA[data.id as string];
  if (!node) return null;
  const badgeText = lang === "vi" ? node.badgeVi : node.badgeEn;

  const toneBorder =
    node.badgeTone === "emerald"
      ? "border-emerald-500/50 bg-[#0B1A18]"
      : node.badgeTone === "amber"
      ? "border-amber-500/50 bg-[#1A160B]"
      : node.badgeTone === "sky"
      ? "border-sky-500/50 bg-[#0B1522]"
      : node.badgeTone === "purple"
      ? "border-purple-500/50 bg-[#160B22]"
      : "border-blue-500/50 bg-[#0B1222]";

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 shadow-xl backdrop-blur-md transition-[border-color,background-color,box-shadow,transform] duration-150 text-xs w-[290px] min-h-[168px] flex flex-col justify-between overflow-hidden",
        toneBorder,
        node.active && "ring-1 ring-cyan-400 shadow-cyan-500/20",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !w-2.5 !h-2.5" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5">
          <span className="font-mono text-[10px] uppercase font-bold text-slate-400 tracking-wider truncate max-w-full">
            {t(`diagram.node_${node.id}_cat`)}
          </span>
          {badgeText && (
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold border max-w-full truncate",
                node.badgeTone === "emerald"
                  ? "border-emerald-400 bg-emerald-950/60 text-emerald-300"
                  : node.badgeTone === "amber"
                  ? "border-amber-400 bg-amber-950/60 text-amber-300"
                  : "border-cyan-400 bg-cyan-950/60 text-cyan-300",
              )}
            >
              {badgeText}
            </span>
          )}
        </div>

        <div className="font-bold text-white text-xs leading-snug">
          {t(`diagram.node_${node.id}_title`)}
        </div>
        <div className="font-mono text-[10px] text-slate-400 mt-1">{node.shape}</div>
      </div>

      {node.formula && (
        <div className="mt-2 pt-1.5 border-t border-slate-700/60 overflow-hidden text-[11px] text-cyan-300 font-sans">
          <Latex math={node.formula} />
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!bg-cyan-400 !w-2.5 !h-2.5" />
    </div>
  );
}

const nodeTypes = {
  archNode: CustomArchNode,
};

const INITIAL_NODES: Node[] = [
  {
    id: "modis_input",
    type: "archNode",
    position: { x: 40, y: 30 },
    data: { id: "modis_input" },
  },
  {
    id: "covariates_input",
    type: "archNode",
    position: { x: 40, y: 250 },
    data: { id: "covariates_input" },
  },
  {
    id: "aoi_embedding",
    type: "archNode",
    position: { x: 40, y: 470 },
    data: { id: "aoi_embedding" },
  },
  {
    id: "tokenizer",
    type: "archNode",
    position: { x: 370, y: 250 },
    data: { id: "tokenizer" },
  },
  {
    id: "b2_anchor",
    type: "archNode",
    position: { x: 700, y: 30 },
    data: { id: "b2_anchor" },
  },
  {
    id: "stan_core",
    type: "archNode",
    position: { x: 700, y: 250 },
    data: { id: "stan_core" },
  },
  {
    id: "hts_anchor",
    type: "archNode",
    position: { x: 700, y: 470 },
    data: { id: "hts_anchor" },
  },
  {
    id: "gate_controller",
    type: "archNode",
    position: { x: 1030, y: 250 },
    data: { id: "gate_controller" },
  },
  {
    id: "output_telemetry",
    type: "archNode",
    position: { x: 1360, y: 250 },
    data: { id: "output_telemetry" },
  },
];

const INITIAL_EDGES: Edge[] = [
  {
    id: "e-modis-tok",
    source: "modis_input",
    target: "tokenizer",
    animated: true,
    style: { stroke: "#38bdf8", strokeWidth: 2 },
  },
  {
    id: "e-cov-tok",
    source: "covariates_input",
    target: "tokenizer",
    animated: true,
    style: { stroke: "#38bdf8", strokeWidth: 2 },
  },
  {
    id: "e-aoi-tok",
    source: "aoi_embedding",
    target: "tokenizer",
    animated: true,
    style: { stroke: "#c084fc", strokeWidth: 2 },
  },
  {
    id: "e-modis-b2",
    source: "modis_input",
    target: "b2_anchor",
    animated: false,
    style: { stroke: "#38bdf8", strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8" },
  },
  {
    id: "e-tok-stan",
    source: "tokenizer",
    target: "stan_core",
    animated: true,
    style: { stroke: "#10b981", strokeWidth: 2.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#10b981" },
  },
  {
    id: "e-modis-hts",
    source: "modis_input",
    target: "hts_anchor",
    style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "4 4" },
  },
  {
    id: "e-hts-stan",
    source: "hts_anchor",
    target: "stan_core",
    style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "5 5" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
  },
  {
    id: "e-b2-gate",
    source: "b2_anchor",
    target: "gate_controller",
    animated: false,
    style: { stroke: "#38bdf8", strokeWidth: 1.5, strokeDasharray: "4 4" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8" },
  },
  {
    id: "e-stan-gate",
    source: "stan_core",
    target: "gate_controller",
    animated: true,
    style: { stroke: "#10b981", strokeWidth: 2.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#10b981" },
  },
  {
    id: "e-gate-out",
    source: "gate_controller",
    target: "output_telemetry",
    animated: true,
    style: { stroke: "#10b981", strokeWidth: 3 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#10b981" },
  },
];

export function ModelArchitectureDiagram() {
  const { t, lang } = useLang();

  const [selectedNodeId, setSelectedNodeId] = useState<string>("stan_core");
  const selectedNode = ARCH_NODES_DATA[selectedNodeId] ?? ARCH_NODES_DATA.stan_core;

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    if (node.data?.id) {
      setSelectedNodeId(node.data.id as string);
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Top Banner Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-[#0B1220] p-4 text-xs">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-cyan-400" />
          <div>
            <h3 className="font-bold text-white text-sm">
              {t("diagram.banner_title")}
            </h3>
            <p className="text-slate-400 text-xs">
              {t("diagram.banner_desc")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-bold">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t("diagram.b2_active_pill")}</span>
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-bold">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t("diagram.gate_pill")}</span>
          </span>
        </div>
      </div>

      {/* React Flow Interactive Graph Canvas */}
      <div className="h-[620px] w-full rounded-2xl border border-slate-800 bg-[#060B13] overflow-hidden shadow-2xl relative">
        <ReactFlow
          nodes={INITIAL_NODES}
          edges={INITIAL_EDGES}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.4}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          className="bg-[#060B13]"
        >
          <Background color="#1e293b" gap={16} size={1} />
          <Controls className="!bg-[#0B1220] !border-slate-800 !fill-white [&>button]:!bg-[#0B1220] [&>button]:!border-slate-800 [&>button]:!text-slate-200" />
          <MiniMap
            nodeColor={(n) => {
              if (n.id === "stan_core" || n.id === "output_telemetry" || n.id === "gate_controller") return "#10b981";
              if (n.id === "hts_anchor") return "#f59e0b";
              return "#38bdf8";
            }}
            maskColor="rgba(6, 11, 19, 0.7)"
            className="!bg-[#0B1220] !border-slate-800 rounded-lg overflow-hidden"
          />
        </ReactFlow>
      </div>

      {/* Selected Node Mathematical & Physical Inspector */}
      <div className="rounded-2xl border border-slate-800 bg-[#0B1220] p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-bold font-mono text-xs">
              f(x)
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase text-slate-400 block tracking-wider">
                {t(`diagram.node_${selectedNode.id}_cat`)}
              </span>
              <h4 className="text-sm font-bold text-white">
                {t(`diagram.node_${selectedNode.id}_title`)}
              </h4>
            </div>
          </div>

          {(lang === "vi" ? selectedNode.badgeVi : selectedNode.badgeEn) && (
            <span
              className={cn(
                "px-3 py-1 rounded-full text-xs font-mono font-extrabold border",
                selectedNode.badgeTone === "emerald"
                  ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                  : selectedNode.badgeTone === "amber"
                  ? "bg-amber-950/60 border-amber-500/40 text-amber-300"
                  : "bg-cyan-950/60 border-cyan-500/40 text-cyan-300",
              )}
            >
              {lang === "vi" ? selectedNode.badgeVi : selectedNode.badgeEn}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          <div className="rounded-xl bg-slate-900/60 p-3.5 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-xs block font-sans">
              {t("diagram.math_form_label")}
            </span>
            <div className="text-cyan-300 font-bold text-xs block overflow-x-auto no-scrollbar font-sans py-1">
              {selectedNode.formula ? (
                <Latex math={selectedNode.formula} block />
              ) : (
                <span className="font-mono text-slate-500">N/A</span>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-900/60 p-3.5 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-xs block font-sans">
              {t("diagram.tensor_shape_label")}
            </span>
            <span className="text-white font-bold text-xs block font-mono">
              {selectedNode.shape ?? "N/A"}
            </span>
          </div>

          <div className="rounded-xl bg-slate-900/60 p-3.5 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-xs block font-sans">
              {t("diagram.science_desc_label")}
            </span>
            <span className="text-slate-200 text-xs font-sans block leading-relaxed">
              {t(`diagram.node_${selectedNode.id}_desc`)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
