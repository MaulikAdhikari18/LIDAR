import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MetricCard from "../components/MetricCard.jsx";
import { buildBudgetHistory } from "../utils/utilityCalculation.js";

const COLORS = ["#22d3ee", "#22c55e", "#f59e0b", "#94a3b8", "#38bdf8", "#ef4444"];

export default function BudgetAnalytics({ controls, regions, time }) {
  const history = buildBudgetHistory(time, { predictionEnabled: controls.showPrediction });
  const utilityData = regions.map((region) => ({ name: region.name, utility: Number(region.utility.toFixed(2)) }));
  const cellData = regions.map((region) => ({ name: region.name, cells: region.cellsAllocated }));
  const resolutionData = [
    { name: "Fine 5 cm", value: regions.filter((region) => region.decision === "REFINE").reduce((sum, region) => sum + region.cellsAllocated, 0) },
    { name: "Medium 20 cm", value: regions.filter((region) => region.decision === "MAINTAIN").reduce((sum, region) => sum + region.cellsAllocated, 0) },
    { name: "Coarse 50 cm", value: regions.filter((region) => region.decision === "COARSEN").reduce((sum, region) => sum + region.cellsAllocated, 0) },
  ];

  return (
    <section className="grid gap-4 xl:grid-cols-4">
      <div className="panel xl:col-span-2">
        <div className="section-title">Computational Budget Allocation Over Time</div>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <AreaChart data={history}>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" />
              <XAxis dataKey="label" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)", color: "#e5eef7" }} />
              <Area dataKey="Pedestrian" fill="#22d3ee" fillOpacity={0.25} stroke="#22d3ee" />
              <Area dataKey="Vehicle" fill="#22c55e" fillOpacity={0.2} stroke="#22c55e" />
              <Area dataKey="Terrain" fill="#f59e0b" fillOpacity={0.18} stroke="#f59e0b" />
              <Area dataKey="RoadEdge" fill="#94a3b8" fillOpacity={0.16} stroke="#94a3b8" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="section-title">Utility Score Per Region</div>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={utilityData} layout="vertical">
              <XAxis hide type="number" />
              <YAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} type="category" width={92} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)" }} />
              <Bar dataKey="utility" fill="#22d3ee" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="section-title">Cells Allocated Per Region</div>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={cellData} layout="vertical">
              <XAxis hide type="number" />
              <YAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} type="category" width={92} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)" }} />
              <Bar dataKey="cells" fill="#22c55e" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="section-title">Resolution Distribution</div>
        <div className="h-[260px]">
          <ResponsiveContainer height="100%" width="100%">
            <PieChart>
              <Pie data={resolutionData} dataKey="value" innerRadius={58} outerRadius={88} paddingAngle={3}>
                {resolutionData.map((entry, index) => (
                  <Cell fill={COLORS[index]} key={entry.name} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.25)" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <MetricCard label="Estimated memory saved" tone="green" value="38%" />
      <MetricCard label="Refined regions" tone="cyan" value={regions.filter((region) => region.decision === "REFINE").length} />
      <MetricCard label="Coarsened regions" tone="slate" value={regions.filter((region) => region.decision === "COARSEN").length} />
      <MetricCard label="Active high-utility regions" tone="amber" value={regions.filter((region) => region.utility > 1.8).length} />
    </section>
  );
}
