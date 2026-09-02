import AdaptiveMap from "../components/AdaptiveMap.jsx";

function distanceCells() {
  const cells = [];
  for (let y = 0; y < 100; y += 4) {
    for (let x = 0; x < 44; x += 4) cells.push({ id: `near-${x}-${y}`, x, y, size: 3.5, className: "stroke-cyanSignal/80 fill-cyanSignal/15" });
  }
  for (let y = 0; y < 100; y += 8) {
    for (let x = 44; x < 70; x += 8) cells.push({ id: `mid-${x}-${y}`, x, y, size: 7.5, className: "stroke-emerald-400/60 fill-emerald-400/10" });
  }
  for (let y = 0; y < 100; y += 20) {
    for (let x = 70; x < 100; x += 20) cells.push({ id: `far-${x}-${y}`, x, y, size: 19, className: "stroke-slate-500/30 fill-transparent" });
  }
  return cells;
}

function DistanceMap() {
  return (
    <div className="panel">
      <div className="section-title">Conventional Distance-Based Mapping</div>
      <svg className="aspect-[1/0.86] w-full rounded-md border border-line bg-slate-950" viewBox="0 0 100 100">
        <rect className="fill-[#081018]" height="100" width="100" />
        {distanceCells().map((cell) => (
          <rect className={cell.className} height={cell.size} key={cell.id} width={cell.size} x={cell.x} y={cell.y} />
        ))}
        <text className="fill-cyan-50 text-[3px] font-bold [paint-order:stroke] [stroke:rgba(0,0,0,0.7)] [stroke-width:0.45]" x="7" y="10">
          Near = 5 cm
        </text>
        <text className="fill-cyan-50 text-[3px] font-bold [paint-order:stroke] [stroke:rgba(0,0,0,0.7)] [stroke-width:0.45]" x="47" y="10">
          Mid = 20 cm
        </text>
        <text className="fill-cyan-50 text-[3px] font-bold [paint-order:stroke] [stroke:rgba(0,0,0,0.7)] [stroke-width:0.45]" x="72" y="10">
          Far = 50 cm
        </text>
      </svg>
      <p className="mt-3 text-sm leading-6 text-amber-200">
        Nearby empty road receives fine cells because distance dominates, even when added spatial information has low value.
      </p>
    </div>
  );
}

export default function Comparison({ controls, regions, selectedRegionId, setSelectedRegionId }) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <DistanceMap />
      <div>
        <AdaptiveMap
          onSelectRegion={setSelectedRegionId}
          predictionEnabled={controls.showPrediction}
          regions={regions}
          selectedRegionId={selectedRegionId}
          title="Predictive Adaptive Information Budgeting"
        />
        <p className="panel mt-4 text-center text-lg font-black uppercase tracking-[0.18em] text-cyan-100">
          Same computational budget. More useful spatial information.
        </p>
      </div>
    </section>
  );
}
