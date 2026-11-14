import { BarChart3, Database, Link2 } from "lucide-react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CrossResponse } from "@/lib/api";
import { compact } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { Kpi, Section } from "./LabWidgets";

interface CrossDatasetTabProps {
  burned: string;
  setBurned: (b: string) => void;
  crossRes: CrossResponse | null;
}

export function CrossDatasetTab({ burned, setBurned, crossRes }: CrossDatasetTabProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  const crossChart = (crossRes?.joined ?? []).map((r) => ({
    x: r.activity_index,
    y: r.burned_area,
    ym: r.ym,
  }));

  return (
    <div className="space-y-4 animate-fade-in">
      <Section
        title={vi ? "Chuỗi Burned Area đối chiếu" : "Burned Area Series Input"}
        subtitle={vi ? "Định dạng: year,month,burned_area" : "Format: year,month,burned_area"}
      >
        <textarea
          value={burned}
          onChange={(e) => setBurned(e.target.value)}
          placeholder={"year,month,burned_area\n2020,1,1234.5\n2020,2,987.6"}
          rows={5}
          className="w-full rounded-xl border border-border/70 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          aria-label="Burned area series"
        />
        <p className="mt-2 text-xs text-slate-400">
          {vi
            ? "Lưu ý: Đây là kiểm tra tương quan nhất quán, không phải ground truth tuyệt đối. Burned area và hotspot là hai đại lượng vật lý khác biệt."
            : "A correlation sanity check, not ground truth. Burned area (hectares) and hotspot counts are distinct physical quantities."}
        </p>
      </Section>

      {!crossRes && (
        <Section title={vi ? "Chưa có dữ liệu đối chiếu" : "No External Dataset Loaded"}>
          <p className="text-xs text-slate-400 leading-relaxed">
            {vi
              ? "Dán chuỗi burned-area của bạn (ví dụ MCD64A1) vào ô trên rồi bấm chạy. Hệ thống không tự sinh số mẫu và không coi đây là ground truth."
              : "Paste your own burned-area series (e.g. MCD64A1) above, then run. No sample values are generated and this is not treated as ground truth."}
          </p>
        </Section>
      )}

      {crossRes && (
        <Section title={vi ? "Kết quả tương quan" : "Cross-dataset Correlation Results"}>
          {crossRes.available ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Kpi
                  icon={Database}
                  label={vi ? "Số tháng khớp (n)" : "Matched Months (n)"}
                  value={String(crossRes.n ?? 0)}
                />
                <Kpi
                  icon={BarChart3}
                  label="Pearson r"
                  value={crossRes.pearson == null ? "-" : crossRes.pearson.toFixed(3)}
                  tone="accent"
                />
                <Kpi
                  icon={BarChart3}
                  label="Spearman ρ"
                  value={crossRes.spearman == null ? "-" : crossRes.spearman.toFixed(3)}
                  tone="accent"
                />
              </div>
              <div className="mt-4" style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 12, bottom: 10, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name={vi ? "Chỉ số hoạt động" : "Activity Index"}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      tickFormatter={(v) => compact(Number(v))}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={vi ? "Diện tích cháy" : "Burned Area"}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      tickFormatter={(v) => compact(Number(v))}
                    />
                    <ZAxis range={[60, 160]} />
                    <RTooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                    />
                    <Scatter data={crossChart} fill="#06b6d4" fillOpacity={0.75} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-slate-400">{crossRes.caveat}</p>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-xs text-slate-400">
              <Link2 className="mx-auto mb-2 h-6 w-6 opacity-40 text-cyan-400" />
              {crossRes.reason === "no_series"
                ? vi
                  ? "Chưa có chuỗi dữ liệu. Nhập CSV ở khung trên rồi bấm Run."
                  : "No series yet. Enter CSV above and click Run."
                : vi
                ? `Không đủ tháng khớp (n=${crossRes.n ?? 0}).`
                : `Not enough matched months (n=${crossRes.n ?? 0}).`}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
