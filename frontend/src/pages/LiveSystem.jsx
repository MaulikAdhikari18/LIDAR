import AdaptiveMap from "../components/AdaptiveMap.jsx";
import BackendConfigCard from "../components/BackendConfigCard.jsx";
import BudgetPanel from "../components/BudgetPanel.jsx";
import PlaybackCard from "../components/PlaybackCard.jsx";
import RegionInspector from "../components/RegionInspector.jsx";
import ResolutionTiersCard from "../components/ResolutionTiersCard.jsx";
import UtilityEngine from "../components/UtilityEngine.jsx";

export default function LiveSystem({
  budgetTotal,
  budgetUsed,
  controls,
  dataSource,
  onStep,
  regions,
  resolutionLevels,
  selectedRegion,
  selectedRegionId,
  resetSimulation,
  setControls,
  setSelectedRegionId,
  isLive,
}) {
  return (
    <main className="grid flex-1 grid-cols-1 gap-3.5 lg:grid-cols-12" data-purpose="dashboard-content">
      <aside className="flex flex-col space-y-3 lg:col-span-3">
        <PlaybackCard controls={controls} onReset={resetSimulation} onStep={onStep} setControls={setControls} />
        <ResolutionTiersCard resolutionLevels={resolutionLevels} />
        <BackendConfigCard dataSource={dataSource} />
      </aside>

      <div className="lg:col-span-6">
        <AdaptiveMap
          onSelectRegion={setSelectedRegionId}
          predictionEnabled={controls.showPrediction}
          regions={regions}
          resolutionLevels={resolutionLevels}
          selectedRegionId={selectedRegionId}
        />
      </div>

      <aside className="flex flex-col space-y-3 lg:col-span-3">
        <BudgetPanel budgetTotal={budgetTotal} budgetUsed={budgetUsed} isLive={isLive} />
        <UtilityEngine onSelectRegion={setSelectedRegionId} regions={regions} selectedRegionId={selectedRegionId} />
        <RegionInspector region={selectedRegion} />
      </aside>
    </main>
  );
}