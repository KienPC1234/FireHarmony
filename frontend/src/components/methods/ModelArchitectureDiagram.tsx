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
  Lock,
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
  badge?: string;
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
    badge: "1 km · Terra & Aqua",
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
    badge: "Fourier Phase",
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
    badge: "Spatial Prior",
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
    badge: "Linear Projection",
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
    titleVi: "Nhánh A: Neo Mùa Vụ B2 (Chính thức)",
    titleEn: "Branch A: Operational B2 Seasonal Anchor",
    categoryVi: "Hạt nhân sản xuất chính",
    categoryEn: "Primary Operational Backbone",
    badge: "VẬN HÀNH CHÍNH · HOLD MAE 2,387",
    badgeTone: "emerald",
    shape: "[12] Hệ số thực nghiệm",
    formula: "k_m = \\text{median}_{y \\in \\text{train}} \\left( \\frac{y_{viirs, y, m}}{x_{modis, y, m}} \\right)",
    descVi:
      "Mô hình vận hành chính thức: Sử dụng 12 hệ số trung vị tỷ lệ theo tháng lịch sử. Ổn định toán học cao, hoàn toàn không rò rỉ dữ liệu.",
    descEn:
      "Primary operational model: empirical 12-month median harmonic ratio. High mathematical stability, zero data leakage.",
    active: true,
  },
  hts_anchor: {
    id: "hts_anchor",
    titleVi: "Nhánh C: HTS — Neo Mùa Vụ Theo Ô 1°",
    titleEn: "Branch C: HTS 1° Tile-Seasonal Anchor",
    categoryVi: "Ứng viên không gian",
    categoryEn: "Spatial Candidate",
    badge: "CANDIDATE · MAE 2,231 · CI ⊃ 0",
    badgeTone: "amber",
    shape: "[AOI-month]",
    formula: "\\hat{y}_{tile,m} = w\\,\\mathrm{median}_{tile,m} + (1-w)\\,B2_{aoi,m}",
    descVi:
      "Chia AOI thành ô 1°, mỗi ô có tỷ lệ mùa riêng co về B2 (w=n/(n+3)); cộng ô-tháng lên AOI. Giảm MAE 6,5% và cải thiện cả 3 vùng, nhưng CI 95% còn chứa 0 nên chỉ là candidate.",
    descEn:
      "Split the AOI into 1° tiles, each with a seasonal ratio shrunk toward B2 (w=n/(n+3)); sum tile-months to the AOI. Cuts MAE 6.5% and improves all three regions, but the 95% CI still includes 0, so it remains a candidate.",
  },
  transformer_core: {
    id: "transformer_core",
    titleVi: "Nhánh B: SensorFormer Transformer",
    titleEn: "Branch B: SensorFormer Attention Core",
    categoryVi: "Mô hình thử nghiệm",
    categoryEn: "Research Prototype",
    badge: "THỬ NGHIỆM · HOLD MAE 2,458",
    badgeTone: "amber",
    shape: "[B, T=12, 64] · 4 Heads",
    formula: "\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V",
    descVi:
      "Mạng Transformer tự chú ý 4-head học phần dư hiệu chỉnh phi tuyến trên chuỗi 12 tháng. Đang ở chế độ nghiên cứu đối sánh.",
    descEn:
      "4-head temporal self-attention network learning non-linear residual adjustments. Currently serving as research benchmark.",
  },
  gate_controller: {
    id: "gate_controller",
    titleVi: "Statistical Gate Controller",
    titleEn: "Statistical Gate Circuit Breaker",
    categoryVi: "Khóa an toàn khoa học",
    categoryEn: "Safety Circuit Breaker",
    badge: "B2 DEFAULT · HTS/SF CANDIDATE",
    badgeTone: "amber",
    shape: "Boolean Control {0, 1}",
    formula: "\\text{Gate} = \\mathbf{1}_{\\{\\Delta \\text{Gain} \\ge 2\\% \\land \\text{Upper CI} < 0\\}}",
    descVi:
      "Cơ chế ngắt mạch an toàn: Nếu mô hình học sâu không giảm sai số ít nhất 2% trên tập holdout, hệ thống tự động khóa cổng và chỉ phục vụ neo B2.",
    descEn:
      "Strict scientific circuit breaker: trips to deterministic B2 anchor unless deep residual demonstrates >= 2% holdout gain with negative CI.",
    active: true,
  },
  output_telemetry: {
    id: "output_telemetry",
    titleVi: "Chỉ Số Hoạt Động Cháy Chuẩn Hóa",
    titleEn: "Standardized Fire Activity Index",
    categoryVi: "Dòng dữ liệu đầu ra",
    categoryEn: "Calibrated Output Stream",
    badge: "25 YEARS UNIFIED · 95% CI",
    badgeTone: "emerald",
    shape: "[B, 1] + [Lower, Upper]",
    formula: "\\hat{y} = x_{modis} \\cdot k_m \\cdot \\exp(\\Delta \\hat{r} \\cdot \\text{Gate})",
    descVi:
      "Chỉ số tương đương VIIRS 375m thống nhất trên toàn bộ 25 năm (2001 - 2025), loại bỏ bước nhảy cảm biến 2012 và có khoảng tin cậy 95%.",
    descEn:
      "Unified 2001-2025 VIIRS-equivalent fire activity series eliminating artificial sensor jump, accompanied by 95% uncertainty envelope.",
    active: true,
  },
};

function CustomArchNode({ data }: NodeProps) {
  const { lang } = useLang();
  const vi = lang === "vi";
  const node = ARCH_NODES_DATA[data.id as string];
  if (!node) return null;

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
        "rounded-xl border p-3 shadow-xl backdrop-blur-md transition-all text-xs w-[250px]",
        toneBorder,
        node.active && "ring-1 ring-cyan-400 shadow-cyan-500/20",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !w-2.5 !h-2.5" />
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="font-mono text-[10px] uppercase font-bold text-slate-400 tracking-wider">
          {vi ? node.categoryVi : node.categoryEn}
        </span>
        {node.badge && (
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold border",
              node.badgeTone === "emerald"
                ? "border-emerald-400 bg-emerald-950/60 text-emerald-300"
                : node.badgeTone === "amber"
                ? "border-amber-400 bg-amber-950/60 text-amber-300"
                : "border-cyan-400 bg-cyan-950/60 text-cyan-300",
            )}
          >
            {node.badge}
          </span>
        )}
      </div>

      <div className="font-bold text-white text-xs leading-snug">{vi ? node.titleVi : node.titleEn}</div>
      <div className="font-mono text-[10px] text-slate-400 mt-1">{node.shape}</div>

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
    position: { x: 30, y: 30 },
    data: { id: "modis_input" },
  },
  {
    id: "covariates_input",
    type: "archNode",
    position: { x: 30, y: 150 },
    data: { id: "covariates_input" },
  },
  {
    id: "aoi_embedding",
    type: "archNode",
    position: { x: 30, y: 270 },
    data: { id: "aoi_embedding" },
  },
  {
    id: "tokenizer",
    type: "archNode",
    position: { x: 340, y: 150 },
    data: { id: "tokenizer" },
  },
  {
    id: "b2_anchor",
    type: "archNode",
    position: { x: 650, y: 40 },
    data: { id: "b2_anchor" },
  },
  {
    id: "transformer_core",
    type: "archNode",
    position: { x: 650, y: 250 },
    data: { id: "transformer_core" },
  },
  {
    id: "hts_anchor",
    type: "archNode",
    position: { x: 650, y: 430 },
    data: { id: "hts_anchor" },
  },
  {
    id: "gate_controller",
    type: "archNode",
    position: { x: 960, y: 150 },
    data: { id: "gate_controller" },
  },
  {
    id: "output_telemetry",
    type: "archNode",
    position: { x: 1270, y: 150 },
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
    animated: true,
    style: { stroke: "#34d399", strokeWidth: 2.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#34d399" },
  },
  {
    id: "e-tok-trans",
    source: "tokenizer",
    target: "transformer_core",
    animated: true,
    style: { stroke: "#a855f7", strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#a855f7" },
  },
  {
    id: "e-modis-hts",
    source: "modis_input",
    target: "hts_anchor",
    style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "4 4" },
  },
  {
    id: "e-hts-gate",
    source: "hts_anchor",
    target: "gate_controller",
    style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "5 5" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
  },
  {
    id: "e-b2-gate",
    source: "b2_anchor",
    target: "gate_controller",
    animated: true,
    style: { stroke: "#34d399", strokeWidth: 2.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#34d399" },
  },
  {
    id: "e-trans-gate",
    source: "transformer_core",
    target: "gate_controller",
    style: { stroke: "#fbbf24", strokeWidth: 2, strokeDasharray: "5 5" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#fbbf24" },
  },
  {
    id: "e-gate-out",
    source: "gate_controller",
    target: "output_telemetry",
    animated: true,
    style: { stroke: "#2dd4bf", strokeWidth: 3 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#2dd4bf" },
  },
];

export function ModelArchitectureDiagram() {
  const { lang } = useLang();
  const vi = lang === "vi";

  const [selectedNodeId, setSelectedNodeId] = useState<string>("b2_anchor");
  const selectedNode = ARCH_NODES_DATA[selectedNodeId] ?? ARCH_NODES_DATA.b2_anchor;

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
              {vi ? "Sơ đồ tương tác mạng nơ-ron SensorFormer & Luồng B2" : "Interactive SensorFormer Neural Architecture"}
            </h3>
            <p className="text-slate-400 text-xs">
              {vi
                ? "Trực quan hóa trực tiếp với @xyflow/react: Kéo, phóng to/thu nhỏ, nhấp vào nút để kiểm tra toán học và tensor."
                : "Interactive @xyflow/react graph: Pan, zoom, click nodes to inspect formulas and tensor dimensions."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-bold">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>OPERATIONAL: B2 ACTIVE</span>
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300 font-bold">
            <Lock className="h-3.5 w-3.5" />
            <span>GATE: TRIP TO B2</span>
          </span>
        </div>
      </div>

      {/* React Flow Interactive Graph Canvas */}
      <div className="h-[440px] w-full rounded-2xl border border-slate-800 bg-[#060B13] overflow-hidden shadow-2xl relative">
        <ReactFlow
          nodes={INITIAL_NODES}
          edges={INITIAL_EDGES}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.5}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          className="bg-[#060B13]"
        >
          <Background color="#1e293b" gap={16} size={1} />
          <Controls className="!bg-[#0B1220] !border-slate-800 !fill-white [&>button]:!bg-[#0B1220] [&>button]:!border-slate-800 [&>button]:!text-slate-200" />
          <MiniMap
            nodeColor={(n) => {
              if (n.id === "b2_anchor" || n.id === "output_telemetry") return "#10b981";
              if (n.id === "gate_controller" || n.id === "transformer_core") return "#f59e0b";
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
                {vi ? selectedNode.categoryVi : selectedNode.categoryEn}
              </span>
              <h4 className="text-sm font-bold text-white">
                {vi ? selectedNode.titleVi : selectedNode.titleEn}
              </h4>
            </div>
          </div>

          {selectedNode.badge && (
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
              {selectedNode.badge}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          <div className="rounded-xl bg-slate-900/60 p-3.5 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-xs block font-sans">
              {vi ? "Công thức toán học:" : "Mathematical Formulation:"}
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
              {vi ? "Kích thước Tensor:" : "Tensor Dimensions:"}
            </span>
            <span className="text-white font-bold text-xs block font-mono">
              {selectedNode.shape ?? "N/A"}
            </span>
          </div>

          <div className="rounded-xl bg-slate-900/60 p-3.5 border border-slate-800 space-y-1">
            <span className="text-slate-400 text-xs block font-sans">
              {vi ? "Vai trò khoa học:" : "Scientific Role:"}
            </span>
            <span className="text-slate-200 text-xs font-sans block leading-relaxed">
              {vi ? selectedNode.descVi : selectedNode.descEn}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
