import AdaptiveMap from "../components/AdaptiveMap.jsx";
import BudgetPanel from "../components/BudgetPanel.jsx";
import LiveLidarScene from "../components/LiveLidarScene.jsx";
import RegionInspector from "../components/RegionInspector.jsx";
import UtilityEngine from "../components/UtilityEngine.jsx";

export default function LiveSystem({
  controls,
  regions,
  selectedRegion,
  selectedRegionId,
  resetSimulation,
  setControls,
  setSelectedRegionId,
  time,
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[1.05fr_1.15fr_390px]">
      <LiveLidarScene
        controls={controls}
        resetSimulation={resetSimulation}
        regions={regions}
        setControls={setControls}
        setSelectedRegionId={setSelectedRegionId}
        time={time}
      />
      <div className="space-y-4">
        <AdaptiveMap
          onSelectRegion={setSelectedRegionId}
          predictionEnabled={controls.showPrediction}
          regions={regions}
          selectedRegionId={selectedRegionId}
        />
        <RegionInspector region={selectedRegion} />
      </div>
      <aside className="space-y-4">
        <BudgetPanel onSelectRegion={setSelectedRegionId} regions={regions} selectedRegionId={selectedRegionId} />
        <UtilityEngine region={selectedRegion} />
      </aside>
    </section>
  );
}
