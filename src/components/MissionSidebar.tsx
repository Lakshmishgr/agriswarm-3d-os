import { BatteryCharging, Database, Radio, Trash2, Upload } from 'lucide-react';
import type { MissionRunRecord, RobotTelemetry, SwarmSnapshot } from '../types/swarm';
import GeoFieldMap from './GeoFieldMap';

interface MissionSidebarProps {
  snapshot: SwarmSnapshot;
  selectedRobotId: string | null;
  onSelectRobot: (id: string) => void;
  onChangeGeoSite: (siteId: string) => void;
  mapExpanded: boolean;
  onToggleMapExpand: () => void;
  missions: MissionRunRecord[];
  missionsLoading: boolean;
  missionsError: string | null;
  savingMission: boolean;
  onSaveToSqlite: () => void;
  onClearDb: () => void;
}

const STATE_STYLES: Record<RobotTelemetry['state'], string> = {
  HARVEST: 'text-emerald-400',
  ASSISTING: 'text-sky-400',
  SEEK_CHARGE: 'text-amber-400',
  CHARGING: 'text-amber-300',
  CRITICAL_WAIT: 'text-rose-400',
  RESCUE_CHARGE: 'text-cyan-300',
  DODGING: 'text-rose-400',
};

const ZONE_COLORS: Record<1 | 2 | 3, string> = {
  1: 'bg-yellow-400',
  2: 'bg-emerald-500',
  3: 'bg-orange-500',
};

export default function MissionSidebar({
  snapshot,
  selectedRobotId,
  onSelectRobot,
  onChangeGeoSite,
  mapExpanded,
  onToggleMapExpand,
  missions,
  missionsLoading,
  missionsError,
  savingMission,
  onSaveToSqlite,
  onClearDb,
}: MissionSidebarProps) {
  const occupiedBays = snapshot.bays.filter((b) => b.occupiedBy !== null);
  const bv = snapshot.batteryVehicle;

  return (
    <aside className="w-[400px] xl:w-[430px] shrink-0 h-full bg-[#0B1120] border-l border-slate-800 flex flex-col overflow-y-auto text-slate-100">
      {/* 1. KPI Grid */}
      <section className="p-4 border-b border-slate-800/80">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
            <div className="text-xs text-slate-400">Field Harvested</div>
            <div className="mt-1 text-xl font-semibold font-mono text-emerald-400 tabular-nums">
              {snapshot.fieldHarvestedPct.toFixed(1)}%
            </div>
            <div className="mt-0.5 text-[11px] font-mono text-slate-400 tabular-nums">
              {snapshot.totalHarvested} / {snapshot.totalCrops} crops
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
            <div className="text-xs text-slate-400">Solar Bays (&lt;30%)</div>
            <div className="mt-1 text-xl font-semibold font-mono text-amber-400 tabular-nums">
              {snapshot.baysInUse} / 4
            </div>
            <div className="mt-0.5 text-[11px] font-mono text-slate-400 truncate">
              {occupiedBays.length > 0
                ? occupiedBays.map((b) => `${b.id}:${b.occupiedBy}`).join(' ')
                : 'BAY-1..4 Open'}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
            <div className="text-xs text-slate-400">Avg Fleet Battery</div>
            <div className="mt-1 text-xl font-semibold font-mono text-sky-400 tabular-nums">
              {snapshot.avgBattery.toFixed(1)}%
            </div>
            <div className="mt-0.5 text-[11px] font-mono text-slate-400 tabular-nums">
              {snapshot.activeCommsCount} active P2P links
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
            <div className="text-xs text-slate-400">Collisions / Deadlocks</div>
            <div className="mt-1 text-xl font-semibold font-mono text-slate-100 tabular-nums">
              {snapshot.collisions} / {snapshot.deadlocks}
            </div>
            <div className="mt-0.5 text-[11px] font-mono text-slate-400 tabular-nums">
              {snapshot.sharedHazards.length} shared hazards · T+{Math.floor(snapshot.elapsedSec)}s
            </div>
          </div>
        </div>
      </section>

      {/* 2. Real-World Geo-Satellite Field Map (Docked Mode) */}
      {!mapExpanded && (
        <section className="p-4 border-b border-slate-800/80">
          <GeoFieldMap
            snapshot={snapshot}
            selectedRobotId={selectedRobotId}
            onSelectRobot={onSelectRobot}
            onChangeGeoSite={onChangeGeoSite}
            expanded={false}
            onToggleExpand={onToggleMapExpand}
          />
        </section>
      )}

      {/* 3. Rectangular Zone Progress */}
      <section className="p-4 border-b border-slate-800/80">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-xs font-semibold tracking-wide text-slate-300">
            Rectangular Field Zones
          </h2>
          <span className="text-[11px] font-mono text-slate-400">Auto-Assist Enabled</span>
        </div>
        <div className="space-y-2.5">
          {snapshot.layers.map((zone) => (
            <div key={zone.zone}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-200 font-medium truncate">
                  {zone.name} · <span className="text-slate-400 font-normal">{zone.cropName}</span>
                </span>
                <span className="font-mono text-slate-300 tabular-nums ml-2 shrink-0">
                  {zone.pct.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${ZONE_COLORS[zone.zone]}`}
                  style={{ width: `${Math.min(100, zone.pct)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Mobile Battery Support Vehicle Status */}
      <section className="px-4 py-3 border-b border-slate-800/80 bg-slate-900/30">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <BatteryCharging className="w-4 h-4 text-sky-400" />
            <span className="font-mono font-semibold text-slate-100">{bv.id}</span>
            <span className="text-slate-400">Mobile Support</span>
          </div>
          <span
            className={`font-mono text-[11px] font-semibold ${
              bv.mode === 'STANDBY' ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {bv.mode}
            {bv.targetRobotId ? ` → ${bv.targetRobotId}` : ''}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
          <span>Reserve: {bv.energyReserve.toFixed(0)}%</span>
          <span>
            GPS {bv.latitude.toFixed(5)}°, {bv.longitude.toFixed(5)}°
          </span>
        </div>
      </section>

      {/* 5. Swarm Fleet Roster */}
      <section className="p-4 border-b border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold tracking-wide text-slate-300">
            Autonomous Rovers (Staggered Speeds)
          </h2>
          <span className="text-[11px] text-slate-400">Click for info</span>
        </div>

        <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-lg overflow-hidden bg-slate-900/40">
          {snapshot.robots.map((robot) => {
            const isSelected = selectedRobotId === robot.id;
            return (
              <button
                key={robot.id}
                type="button"
                onClick={() => onSelectRobot(robot.id)}
                className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors cursor-pointer ${
                  isSelected ? 'bg-sky-500/15' : 'hover:bg-slate-800/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono font-semibold text-slate-100">{robot.id}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-300 truncate">{robot.label}</span>
                    {robot.promotedFrom !== null && (
                      <span className="font-mono text-[11px] text-sky-400 font-semibold">
                        ⬆Z{robot.promotedFrom}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                    <span>{robot.speedMs.toFixed(2)} m/s</span>
                    <span>·</span>
                    <span>Z{robot.activeZone}</span>
                    <span>·</span>
                    <span className={`font-semibold ${STATE_STYLES[robot.state]}`}>
                      {robot.state}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0 ml-2">
                  <div
                    className={`text-xs font-mono font-semibold tabular-nums ${
                      robot.battery > 50
                        ? 'text-emerald-400'
                        : robot.battery > 30
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {robot.battery.toFixed(0)}%
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                    {robot.assignedBay ?? `${robot.connectedPeers.length} peers`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 6. P2P Coordination & Obstacle Radio Log */}
      <section className="p-4 border-b border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold tracking-wide text-slate-300 inline-flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>P2P Coordination & Obstacle Log</span>
          </h2>
          <span className="text-[11px] font-mono text-slate-400">12.5m mesh</span>
        </div>

        <div className="h-36 overflow-y-auto rounded-lg bg-slate-950 border border-slate-800 p-2 space-y-1.5 font-mono text-[11px]">
          {snapshot.logs.length === 0 ? (
            <div className="text-slate-500 p-2">Awaiting P2P radio packets...</div>
          ) : (
            snapshot.logs.map((entry) => (
              <div key={entry.id} className="leading-snug text-slate-300">
                <span className="text-slate-500">[{entry.timestamp}]</span>{' '}
                <span className="text-sky-400 font-semibold">{entry.sender}</span>{' '}
                <span className="text-slate-500">·</span>{' '}
                <span
                  className={
                    entry.tag === 'OBSTACLE' || entry.tag === 'RESCUE'
                      ? 'text-rose-400'
                      : entry.tag === 'ASSIST'
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }
                >
                  {entry.tag}
                </span>{' '}
                <span className="text-slate-300">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* 7. SQLite Mission Runs Persistence */}
      <section className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-xs font-semibold tracking-wide text-slate-300 inline-flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-amber-400" />
            <span>SQLite Mission Log</span>
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onSaveToSqlite}
              disabled={savingMission}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3 h-3" />
              <span>{savingMission ? 'Saving...' : 'Save to SQLite'}</span>
            </button>
            <button
              type="button"
              onClick={onClearDb}
              disabled={missions.length === 0}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear DB</span>
            </button>
          </div>
        </div>

        {missionsError && (
          <div className="mb-2 p-2 rounded-md bg-rose-950/60 border border-rose-800 text-xs text-rose-300">
            {missionsError}
          </div>
        )}

        {missionsLoading ? (
          <div className="text-xs text-slate-400 py-3">Loading mission_runs table...</div>
        ) : missions.length === 0 ? (
          <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-xs text-slate-400">
            No runs logged in SQLite yet. Click Save to SQLite to record current field telemetry.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {missions.map((m) => (
              <div
                key={m.id}
                className="p-2 rounded-lg border border-slate-800 bg-slate-900/50 text-xs flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-slate-200 tabular-nums">
                    Run #{m.id} · {m.field_harvested_pct.toFixed(1)}% harvested
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums truncate">
                    Z1:{m.layer1_pct.toFixed(0)}% · Z2:{m.layer2_pct.toFixed(0)}% · Z3:{m.layer3_pct.toFixed(0)}% · Bat:{m.avg_battery_pct.toFixed(0)}%
                  </div>
                </div>
                <div className="text-right shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                  <div>{m.duration_sec.toFixed(0)}s</div>
                  <div>{m.collisions}/{m.deadlocks} err</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
