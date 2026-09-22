import AdaptiveMap from "../components/AdaptiveMap.jsx";
import BackendConfigurationPanel from "../components/BackendConfigurationPanel.jsx";
import BudgetPanel from "../components/BudgetPanel.jsx";
import DecisionLogicPanel from "../components/DecisionLogicPanel.jsx";
import LiveLidarScene from "../components/LiveLidarScene.jsx";
import PlaybackControlsPanel from "../components/PlaybackControlsPanel.jsx";
import RegionInspector from "../components/RegionInspector.jsx";
import TrackedObjectsTable from "../components/TrackedObjectsTable.jsx";
import UtilityEngine from "../components/UtilityEngine.jsx";

export default function LiveSystem({
  autoPlay,
  budgetTotal,
  budgetUsed,
  controls,
  dataSource,
  isAdvancingFrame,
  isLive,
  onStep,
  regions,
  resolutionLevels,
  selectedRegion,
  selectedRegionId,
  resetSimulation,
  setAutoPlay,
  setControls,
  setSelectedRegionId,
  time,
}) {
  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-2">
        <PlaybackControlsPanel
          autoPlay={autoPlay}
          controls={controls}
          dataSource={dataSource}
          isAdvancingFrame={isAdvancingFrame}
          onStep={onStep}
          resetSimulation={resetSimulation}
          setAutoPlay={setAutoPlay}
          setControls={setControls}
        />
        <BackendConfigurationPanel dataSource={dataSource} />
      </section>

      {/* LiDAR view | Information Utility Engine (now carries Resolution
          Allocation in the same box, below the decision explanation) | 2.5D map.
          All three are roughly the same height now instead of the utility
          panel ending early and leaving empty space next to the two map views. */}
      <section className="grid gap-4 xl:grid-cols-3">
        <LiveLidarScene
          controls={controls}
          resetSimulation={resetSimulation}
          regions={regions}
          setControls={setControls}
          setSelectedRegionId={setSelectedRegionId}
          time={time}
        />
        <UtilityEngine region={selectedRegion} regions={regions} resolutionLevels={resolutionLevels} />
        <AdaptiveMap
          onAdvanceFrame={dataSource === "live" ? onStep : undefined}
          onSelectRegion={setSelectedRegionId}
          predictionEnabled={controls.showPrediction}
          regions={regions}
          resolutionLevels={resolutionLevels}
          selectedRegionId={selectedRegionId}
        />
      </section>

      {/* Budget | Region Inspector (moved up from below) | Tracked Objects +
          Decision Logic stacked in the third column. This replaces the old
          Resolution Allocation slot and the separate row underneath it, so
          the page ends after this row instead of trailing off with a mostly
          empty final section. */}
      <section className="grid gap-4 xl:grid-cols-3">
        <BudgetPanel
          budgetTotal={budgetTotal}
          budgetUsed={budgetUsed}
          isLive={isLive}
          onSelectRegion={setSelectedRegionId}
          regions={regions}
          selectedRegionId={selectedRegionId}
        />
        <RegionInspector region={selectedRegion} />
        <div className="flex flex-col gap-4">
          <TrackedObjectsTable onSelectRegion={setSelectedRegionId} regions={regions} selectedRegionId={selectedRegionId} />
          <DecisionLogicPanel />
        </div>
      </section>
    </div>
  );
}
