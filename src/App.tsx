import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  BatteryWarning,
  Pause,
  Play,
  RefreshCw,
  Tractor,
} from 'lucide-react';
import FarmViewport3D from './components/FarmViewport3D';
import GeoFieldMap from './components/GeoFieldMap';
import MissionSidebar from './components/MissionSidebar';
import { SwarmEngine } from './simulation/SwarmEngine';
import type { MissionRunRecord, SwarmSnapshot } from './types/swarm';

export default function App() {
  const engine = useMemo(() => new SwarmEngine(), []);
  const [snapshot, setSnapshot] = useState<SwarmSnapshot>(() => engine.getSnapshot());
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [showSensorCones, setShowSensorCones] = useState<boolean>(true);
  const [mapExpanded, setMapExpanded] = useState<boolean>(false);
  const [resetSignal, setResetSignal] = useState<number>(0);
  const [fieldPace, setFieldPace] = useState<number>(1.0);
  const [paused, setPaused] = useState<boolean>(false);

  const [missions, setMissions] = useState<MissionRunRecord[]>([]);
  const [missionsLoading, setMissionsLoading] = useState<boolean>(true);
  const [missionsError, setMissionsError] = useState<string | null>(null);
  const [savingMission, setSavingMission] = useState<boolean>(false);

  const loadMissions = useCallback(async () => {
    try {
      setMissionsError(null);
      const res = await fetch('/api/missions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { missions: MissionRunRecord[] };
      setMissions(data.missions ?? []);
    } catch (err) {
      setMissionsError(err instanceof Error ? err.message : 'Failed to load SQLite logs');
    } finally {
      setMissionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMissions();
  }, [loadMissions]);

  const handleTogglePause = () => {
    const next = !paused;
    engine.paused = next;
    setPaused(next);
    setSnapshot(engine.getSnapshot());
  };

  const handleFieldPaceChange = (val: number) => {
    engine.fieldPace = val;
    setFieldPace(val);
  };

  const handleTest30Charge = () => {
    const chosen = engine.triggerLowBatteryTest(28);
    if (chosen) setSelectedRobotId(chosen);
    setSnapshot(engine.getSnapshot());
  };

  const handleTestCriticalRescue = () => {
    const chosen = engine.triggerLowBatteryTest(12);
    if (chosen) setSelectedRobotId(chosen);
    setSnapshot(engine.getSnapshot());
  };

  const handleDropObstacle = () => {
    engine.dropFieldObstacle();
    setSnapshot(engine.getSnapshot());
  };

  const handleAddTractor = () => {
    engine.addMovingTractor();
    setSnapshot(engine.getSnapshot());
  };

  const handleResetField = () => {
    engine.resetField();
    setSelectedRobotId(null);
    setResetSignal((s) => s + 1);
    setSnapshot(engine.getSnapshot());
  };

  const handleChangeGeoSite = (siteId: string) => {
    engine.setGeoSite(siteId);
    setSnapshot(engine.getSnapshot());
  };

  const handleSaveToSqlite = async () => {
    setSavingMission(true);
    setMissionsError(null);
    try {
      const snap = engine.getSnapshot();
      const z1 = snap.layers.find((l) => l.zone === 1)?.pct ?? 0;
      const z2 = snap.layers.find((l) => l.zone === 2)?.pct ?? 0;
      const z3 = snap.layers.find((l) => l.zone === 3)?.pct ?? 0;

      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationSec: Number(snap.elapsedSec.toFixed(1)),
          fieldHarvestedPct: Number(snap.fieldHarvestedPct.toFixed(2)),
          layer1Pct: Number(z1.toFixed(2)),
          layer2Pct: Number(z2.toFixed(2)),
          layer3Pct: Number(z3.toFixed(2)),
          avgBatteryPct: Number(snap.avgBattery.toFixed(2)),
          collisions: snap.collisions,
          deadlocks: snap.deadlocks,
          tractorsActive: snap.tractors.length,
          fieldPace: snap.fieldPace,
          notes: `${snap.geoSite.name} (${snap.totalHarvested}/${snap.totalCrops})`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadMissions();
    } catch (err) {
      setMissionsError(err instanceof Error ? err.message : 'Failed to save mission');
    } finally {
      setSavingMission(false);
    }
  };

  const handleClearDb = async () => {
    setMissionsError(null);
    try {
      const res = await fetch('/api/missions', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMissions([]);
    } catch (err) {
      setMissionsError(err instanceof Error ? err.message : 'Failed to clear DB');
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B1120] text-slate-100">
      {/* Top Control Bar */}
      <header className="h-14 shrink-0 px-4 bg-[#0F172A] border-b border-slate-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            AgriSwarm 3D OS
          </h1>

          <div className="hidden lg:flex items-center gap-2.5 pl-4 border-l border-slate-800">
            <label
              htmlFor="field-pace-slider"
              className="text-xs font-medium text-slate-300 whitespace-nowrap"
            >
              Field Pace
            </label>
            <input
              id="field-pace-slider"
              type="range"
              min={0.4}
              max={2.0}
              step={0.1}
              value={fieldPace}
              onChange={(e) => handleFieldPaceChange(parseFloat(e.target.value))}
              className="w-24 accent-sky-400 cursor-pointer"
            />
            <span className="font-mono text-xs text-sky-400 w-9 tabular-nums">
              {fieldPace.toFixed(1)}x
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={handleTogglePause}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              paused
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-100'
            }`}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{paused ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            type="button"
            onClick={handleTest30Charge}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BatteryWarning className="w-3.5 h-3.5" />
            <span>Test 30% Station</span>
          </button>

          <button
            type="button"
            onClick={handleTestCriticalRescue}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BatteryCharging className="w-3.5 h-3.5" />
            <span>Dispatch BAT-01 (12%)</span>
          </button>

          <button
            type="button"
            onClick={handleDropObstacle}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Drop Obstacle</span>
          </button>

          <button
            type="button"
            onClick={handleAddTractor}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Tractor className="w-3.5 h-3.5 text-rose-400" />
            <span>Add Tractor</span>
          </button>

          <button
            type="button"
            onClick={handleResetField}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
            <span>Reset Farm</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 h-full flex flex-col lg:flex-row">
          <div className={mapExpanded ? 'flex-1 min-w-0 h-1/2 lg:h-full' : 'w-full h-full'}>
            <FarmViewport3D
              engine={engine}
              snapshot={snapshot}
              selectedRobotId={selectedRobotId}
              onSelectRobot={setSelectedRobotId}
              showSensorCones={showSensorCones}
              onToggleSensorCones={() => setShowSensorCones((v) => !v)}
              resetSignal={resetSignal}
              onSnapshot={setSnapshot}
            />
          </div>

          {mapExpanded && (
            <div className="w-full lg:w-[44%] h-1/2 lg:h-full bg-[#0B1120] border-t lg:border-t-0 lg:border-l border-slate-800 p-4 overflow-y-auto">
              <GeoFieldMap
                snapshot={snapshot}
                selectedRobotId={selectedRobotId}
                onSelectRobot={setSelectedRobotId}
                onChangeGeoSite={handleChangeGeoSite}
                expanded={true}
                onToggleExpand={() => setMapExpanded(false)}
              />
            </div>
          )}
        </div>

        <MissionSidebar
          snapshot={snapshot}
          selectedRobotId={selectedRobotId}
          onSelectRobot={setSelectedRobotId}
          onChangeGeoSite={handleChangeGeoSite}
          mapExpanded={mapExpanded}
          onToggleMapExpand={() => setMapExpanded((v) => !v)}
          missions={missions}
          missionsLoading={missionsLoading}
          missionsError={missionsError}
          savingMission={savingMission}
          onSaveToSqlite={handleSaveToSqlite}
          onClearDb={handleClearDb}
        />
      </main>
    </div>
  );
}
