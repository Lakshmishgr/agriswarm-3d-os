export type RobotState =
  | 'HARVEST'
  | 'ASSISTING'
  | 'SEEK_CHARGE'
  | 'CHARGING'
  | 'CRITICAL_WAIT'
  | 'RESCUE_CHARGE'
  | 'DODGING';

export type BayId = 'BAY-1' | 'BAY-2' | 'BAY-3' | 'BAY-4';

export type ChargePhase = 'NONE' | 'HEADLAND' | 'DOCKING_IN' | 'DOCKED' | 'EXITING';

export interface GeoSitePreset {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
}

export interface RobotTelemetry {
  id: string;
  label: string;
  homeZone: 1 | 2 | 3;
  activeZone: 1 | 2 | 3;
  promotedFrom: 1 | 2 | 3 | null;
  speedMs: number;
  x: number;
  z: number;
  heading: number;
  wheelAngle: number;
  cutterAngle: number;
  battery: number; // 0..100
  hopperFill: number; // 0..1
  harvestedCount: number;
  state: RobotState;
  chargePhase: ChargePhase;
  assignedBay: BayId | null;
  latitude: number;
  longitude: number;
  connectedPeers: string[];
  lastComms: string;
  dodgingObstacleId: string | null;
  avoidanceVec: { x: number; z: number } | null;
  gpsTrail: Array<{ lat: number; lon: number; x: number; z: number }>;
}

export interface SolarBayState {
  id: BayId;
  x: number;
  z: number;
  approachX: number;
  approachZ: number;
  occupiedBy: string | null;
  reservedBy: string | null;
  exitingBy: string | null;
}

export type BatteryVehicleMode = 'STANDBY' | 'DISPATCHING' | 'CHARGING_ROVER' | 'RETURNING';

export interface BatteryVehicleState {
  id: string;
  x: number;
  z: number;
  heading: number;
  wheelAngle: number;
  energyReserve: number; // 0..100
  mode: BatteryVehicleMode;
  targetRobotId: string | null;
  latitude: number;
  longitude: number;
}

export interface TractorState {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  wheelAngle: number;
  laneIndex: number;
  direction: 1 | -1;
}

export interface FieldObstacle {
  id: string;
  x: number;
  z: number;
  radius: number;
  label: string;
  discoveredBy: string | null;
  latitude: number;
  longitude: number;
}

export interface SharedHazard {
  obstacleId: string;
  x: number;
  z: number;
  radius: number;
  reportedBy: string;
  lat: number;
  lon: number;
  ttl: number;
}

export interface P2PBeamEvent {
  id: number;
  fromId: string;
  toId: string;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  kind: 'COORD' | 'OBSTACLE' | 'RESCUE' | 'CHARGE';
  ttl: number;
}

export interface CropNode {
  index: number;
  zone: 1 | 2 | 3;
  row: number;
  x: number;
  z: number;
  scale: number;
  harvested: boolean;
}

export interface P2PLogEntry {
  id: number;
  timestamp: string;
  sender: string;
  tag: 'P2P' | 'BAY' | 'OBSTACLE' | 'ASSIST' | 'RESCUE';
  message: string;
}

export interface ZoneStats {
  zone: 1 | 2 | 3;
  name: string;
  cropName: string;
  total: number;
  harvested: number;
  pct: number;
}

export interface SwarmSnapshot {
  elapsedSec: number;
  paused: boolean;
  fieldPace: number;
  geoSite: GeoSitePreset;
  fieldHarvestedPct: number;
  totalCrops: number;
  totalHarvested: number;
  baysInUse: number;
  avgBattery: number;
  collisions: number;
  deadlocks: number;
  activeCommsCount: number;
  layers: ZoneStats[];
  robots: RobotTelemetry[];
  bays: SolarBayState[];
  batteryVehicle: BatteryVehicleState;
  tractors: TractorState[];
  obstacles: FieldObstacle[];
  sharedHazards: SharedHazard[];
  p2pBeams: P2PBeamEvent[];
  logs: P2PLogEntry[];
}

export interface MissionRunRecord {
  id: number;
  created_at: string;
  duration_sec: number;
  field_harvested_pct: number;
  layer1_pct: number;
  layer2_pct: number;
  layer3_pct: number;
  avg_battery_pct: number;
  collisions: number;
  deadlocks: number;
  tractors_active: number;
  field_pace: number;
  notes: string | null;
}
