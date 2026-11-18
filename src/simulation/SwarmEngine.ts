import type {
  BatteryVehicleState,
  BayId,
  CropNode,
  FieldObstacle,
  GeoSitePreset,
  P2PBeamEvent,
  P2PLogEntry,
  RobotState,
  RobotTelemetry,
  SharedHazard,
  SolarBayState,
  SwarmSnapshot,
  TractorState,
  ZoneStats,
} from '../types/swarm';

export const GEO_SITES: GeoSitePreset[] = [
  {
    id: 'mandya',
    name: 'Mandya Precision Ag Plot',
    region: 'Karnataka, India',
    lat: 12.5218,
    lon: 76.8951,
  },
  {
    id: 'ames',
    name: 'Ames Research Farm Strip',
    region: 'Iowa, USA',
    lat: 42.0308,
    lon: -93.6319,
  },
  {
    id: 'fresno',
    name: 'San Joaquin Valley Block',
    region: 'California, USA',
    lat: 36.7378,
    lon: -119.7871,
  },
];

// Rectangular farm geometry (meters in local scene coordinates)
// Cultivated rectangle: X in [-17.0, +17.0], Z in [-11.5, +11.5]
// Perimeter headland service road: X in [-19.4, +19.4], Z in [-13.6, +13.6]
// Solar Charging Station & Mobile Battery Depot along South apron: Z = +16.2
export const RECT_HALF_W = 17.0;
export const RECT_HALF_D = 11.5;
export const HEADLAND_N = -13.1;
export const HEADLAND_S = 13.1;
export const HEADLAND_W = -18.6;
export const HEADLAND_E = 18.6;
export const DEPOT_Z = 16.2;

export const SENSOR_RADIUS = 4.8;
export const RADIO_RADIUS = 12.5;
export const BATTERY_CHARGE_THRESHOLD = 30;
export const CRITICAL_BATTERY_THRESHOLD = 16;
export const BASE_STEP_SPEED = 0.085;
const TICK_RATE_HZ = 22;
const WHEEL_RADIUS = 0.22;

const ZONE_BOUNDS: Record<
  1 | 2 | 3,
  { minX: number; maxX: number; name: string; cropName: string }
> = {
  1: { minX: -16.8, maxX: -6.2, name: 'Zone 1 (West)', cropName: 'Golden Wheat' },
  2: { minX: -5.0, maxX: 5.0, name: 'Zone 2 (Center)', cropName: 'Green Corn' },
  3: { minX: 6.2, maxX: 16.8, name: 'Zone 3 (East)', cropName: 'Orange Sunflowers' },
};

interface InternalRobot extends RobotTelemetry {
  targetCropIndex: number | null;
  claimedRow: number | null;
  trailTimer: number;
  lastObstacleBroadcast: Map<string, number>;
  lastYieldLogTime: number;
}

export class SwarmEngine {
  public cropsByZone: Record<1 | 2 | 3, CropNode[]> = { 1: [], 2: [], 3: [] };
  public dirtyCrops: Array<{ zone: 1 | 2 | 3; index: number }> = [];

  private robots: InternalRobot[] = [];
  private bays: SolarBayState[] = [];
  private batteryVehicle!: BatteryVehicleState;
  private tractors: TractorState[] = [];
  private obstacles: FieldObstacle[] = [];
  private sharedHazards: SharedHazard[] = [];
  private p2pBeams: P2PBeamEvent[] = [];
  private logs: P2PLogEntry[] = [];

  private logSeq = 1;
  private beamSeq = 1;
  private activeCommsCount = 0;
  private lastCollisionPairTimes = new Map<string, number>();

  public elapsedSec = 0;
  public paused = false;
  public fieldPace = 1.0;
  public geoSite: GeoSitePreset = GEO_SITES[0];
  public collisions = 0;
  public deadlocks = 0;

  constructor() {
    this.resetField();
  }

  public setGeoSite(siteId: string): void {
    const found = GEO_SITES.find((s) => s.id === siteId);
    if (found) {
      this.geoSite = found;
      for (const r of this.robots) {
        this.updateRobotGPS(r, true);
        r.gpsTrail = [];
      }
      for (const obs of this.obstacles) {
        const g = this.toGPS(obs.x, obs.z);
        obs.latitude = g.lat;
        obs.longitude = g.lon;
      }
      const bvGps = this.toGPS(this.batteryVehicle.x, this.batteryVehicle.z);
      this.batteryVehicle.latitude = bvGps.lat;
      this.batteryVehicle.longitude = bvGps.lon;
      this.pushLog('GEO', 'P2P', `Switched geo reference to ${found.name} (${found.lat.toFixed(4)}°, ${found.lon.toFixed(4)}°).`);
    }
  }

  public resetField(): void {
    this.elapsedSec = 0;
    this.collisions = 0;
    this.deadlocks = 0;
    this.logs = [];
    this.p2pBeams = [];
    this.sharedHazards = [];
    this.dirtyCrops = [];
    this.logSeq = 1;
    this.beamSeq = 1;
    this.activeCommsCount = 0;
    this.lastCollisionPairTimes.clear();

    this.initBays();
    this.initBatteryVehicle();
    this.initCrops();
    this.initRobots();
    this.initTractors();
    this.initObstacles();

    this.pushLog('SWARM', 'P2P', 'Rectangular 3-zone farm initialized. 6 staggered-speed rovers coordinating via P2P.');
    this.pushLog('DEPOT', 'BAY', 'Solar Station (BAY-1..4) & Mobile Battery Vehicle BAT-01 ready.');
  }

  private initBays(): void {
    // 4 drive-in solar bays aligned along South apron (Z = 16.2)
    const baySpecs: Array<{ id: BayId; x: number }> = [
      { id: 'BAY-1', x: -6.0 },
      { id: 'BAY-2', x: -2.0 },
      { id: 'BAY-3', x: 2.0 },
      { id: 'BAY-4', x: 6.0 },
    ];
    this.bays = baySpecs.map((b) => ({
      id: b.id,
      x: b.x,
      z: DEPOT_Z,
      approachX: b.x,
      approachZ: HEADLAND_S,
      occupiedBy: null,
      reservedBy: null,
      exitingBy: null,
    }));
  }

  private initBatteryVehicle(): void {
    const startX = -12.5;
    const startZ = DEPOT_Z;
    const gps = this.toGPS(startX, startZ);
    this.batteryVehicle = {
      id: 'BAT-01',
      x: startX,
      z: startZ,
      heading: 0,
      wheelAngle: 0,
      energyReserve: 100,
      mode: 'STANDBY',
      targetRobotId: null,
      latitude: gps.lat,
      longitude: gps.lon,
    };
  }

  private initCrops(): void {
    this.cropsByZone = { 1: [], 2: [], 3: [] };

    const zoneSpecs: Array<{ zone: 1 | 2 | 3; xStart: number; xEnd: number; rowStep: number; zStep: number }> = [
      { zone: 1, xStart: -16.4, xEnd: -6.6, rowStep: 0.98, zStep: 0.92 },
      { zone: 2, xStart: -4.6, xEnd: 4.6, rowStep: 1.02, zStep: 0.96 },
      { zone: 3, xStart: 6.6, xEnd: 16.4, rowStep: 1.08, zStep: 1.02 },
    ];

    for (const spec of zoneSpecs) {
      let idx = 0;
      let rowNum = 0;
      for (let x = spec.xStart; x <= spec.xEnd + 0.05; x += spec.rowStep) {
        for (let z = -10.8; z <= 10.8 + 0.05; z += spec.zStep) {
          this.cropsByZone[spec.zone].push({
            index: idx++,
            zone: spec.zone,
            row: rowNum,
            x,
            z,
            scale: 0.88 + ((idx * 13 + rowNum * 7) % 24) * 0.01,
            harvested: false,
          });
        }
        rowNum++;
      }
    }
  }

  private initRobots(): void {
    // 6 distinct speeds ensure batteries drain asynchronously and charge cleanly without congestion
    const configs: Array<{
      id: string;
      label: string;
      zone: 1 | 2 | 3;
      speedMs: number;
      x: number;
      z: number;
      heading: number;
      battery: number;
    }> = [
      { id: 'R1', label: 'Turbo-Fast', zone: 1, speedMs: 1.24, x: -16.4, z: -10.5, heading: 0, battery: 82 },
      { id: 'R2', label: 'Eco-Mid', zone: 1, speedMs: 0.64, x: -9.5, z: 10.5, heading: Math.PI, battery: 96 },
      { id: 'R3', label: 'Fast-Cruise', zone: 2, speedMs: 1.04, x: -4.6, z: -10.5, heading: 0, battery: 74 },
      { id: 'R4', label: 'Precision', zone: 2, speedMs: 0.46, x: 2.5, z: 10.5, heading: Math.PI, battery: 98 },
      { id: 'R5', label: 'Med-Cruise', zone: 3, speedMs: 0.88, x: 6.6, z: -10.5, heading: 0, battery: 88 },
      { id: 'R6', label: 'Balanced', zone: 3, speedMs: 0.56, x: 13.5, z: 10.5, heading: Math.PI, battery: 93 },
    ];

    this.robots = configs.map((c) => {
      const gps = this.toGPS(c.x, c.z);
      return {
        id: c.id,
        label: c.label,
        homeZone: c.zone,
        activeZone: c.zone,
        promotedFrom: null,
        speedMs: c.speedMs,
        x: c.x,
        z: c.z,
        heading: c.heading,
        wheelAngle: 0,
        cutterAngle: 0,
        battery: c.battery,
        hopperFill: 0,
        harvestedCount: 0,
        state: 'HARVEST',
        chargePhase: 'NONE',
        assignedBay: null,
        latitude: gps.lat,
        longitude: gps.lon,
        connectedPeers: [],
        lastComms: 'Online in P2P mesh',
        dodgingObstacleId: null,
        avoidanceVec: null,
        gpsTrail: [{ lat: gps.lat, lon: gps.lon, x: c.x, z: c.z }],
        targetCropIndex: null,
        claimedRow: null,
        trailTimer: 0,
        lastObstacleBroadcast: new Map(),
        lastYieldLogTime: -10,
      };
    });
  }

  private initTractors(): void {
    this.tractors = [];
    // Patrol along the perimeter & central service alleys of the rectangular farm
    this.spawnTractor(0, 1);
  }

  public addMovingTractor(): void {
    const idx = this.tractors.length;
    const dir: 1 | -1 = idx % 2 === 0 ? 1 : -1;
    const t = this.spawnTractor(idx, dir);
    this.pushLog(t.id, 'OBSTACLE', `Patrol tractor deployed on rectangular service corridor ${t.laneIndex + 1}.`);
  }

  private spawnTractor(laneIdx: number, direction: 1 | -1): TractorState {
    const id = `TR-${this.tractors.length + 1}`;
    // Lane 0: central N-S alley X=-5.6, Lane 1: central N-S alley X=+5.6, Lane 2: North headland Z=-13.1
    const lane = laneIdx % 3;
    let x = -5.6;
    let z = -10;
    let vx = 0;
    let vz = 1.6 * direction;
    if (lane === 1) {
      x = 5.6;
      z = 10;
      vz = -1.5 * direction;
    } else if (lane === 2) {
      x = -12;
      z = HEADLAND_N;
      vx = 1.8 * direction;
      vz = 0;
    }
    const t: TractorState = {
      id,
      x,
      z,
      vx,
      vz,
      heading: Math.atan2(vx, vz),
      wheelAngle: 0,
      laneIndex: lane,
      direction,
    };
    this.tractors.push(t);
    return t;
  }

  private initObstacles(): void {
    // 1 initial field boulder in Zone 2 so swarm obstacle discovery & P2P sharing is immediately observable
    const x = 0.4;
    const z = -1.2;
    const gps = this.toGPS(x, z);
    this.obstacles = [
      {
        id: 'OBS-1',
        x,
        z,
        radius: 0.95,
        label: 'Field Boulder',
        discoveredBy: null,
        latitude: gps.lat,
        longitude: gps.lon,
      },
    ];
  }

  public dropFieldObstacle(): FieldObstacle {
    // Pick a spot inside the rectangular cultivated zones away from depot
    const zones: Array<1 | 2 | 3> = [1, 2, 3];
    const zChoice = zones[this.obstacles.length % 3];
    const bounds = ZONE_BOUNDS[zChoice];
    const x = bounds.minX + 1.8 + ((this.obstacles.length * 3.7) % (bounds.maxX - bounds.minX - 3.6));
    const z = -7.5 + ((this.obstacles.length * 5.3) % 15);
    const gps = this.toGPS(x, z);
    const obs: FieldObstacle = {
      id: `OBS-${this.obstacles.length + 1}`,
      x,
      z,
      radius: 0.95,
      label: this.obstacles.length % 2 === 0 ? 'Rock Outcrop' : 'Fallen Crate',
      discoveredBy: null,
      latitude: gps.lat,
      longitude: gps.lon,
    };
    this.obstacles.push(obs);
    this.pushLog('FIELD', 'OBSTACLE', `New ${obs.label} (${obs.id}) detected at ${gps.lat.toFixed(5)}°, ${gps.lon.toFixed(5)}°.`);
    return obs;
  }

  public triggerLowBatteryTest(targetPct = 28): string | null {
    const candidates = this.robots.filter(
      (r) => r.state === 'HARVEST' || r.state === 'ASSISTING'
    );
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    chosen.battery = targetPct;
    const tag = targetPct <= CRITICAL_BATTERY_THRESHOLD ? 'RESCUE' : 'BAY';
    this.pushLog(
      chosen.id,
      tag,
      targetPct <= CRITICAL_BATTERY_THRESHOLD
        ? `CRITICAL BATTERY (${targetPct}%)! Broadcasting Mayday for Mobile Battery Vehicle BAT-01.`
        : `Battery dropped to ${targetPct}% (< 30% threshold) -> Heading to Solar Charging Station.`
    );
    return chosen.id;
  }

  public toGPS(x: number, z: number): { lat: number; lon: number } {
    const metersPerUnit = 2.5;
    const degLatPerMeter = 1 / 111111;
    const degLonPerMeter = 1 / (111111 * Math.cos((this.geoSite.lat * Math.PI) / 180));
    const northMeters = -z * metersPerUnit;
    const eastMeters = x * metersPerUnit;
    return {
      lat: this.geoSite.lat + northMeters * degLatPerMeter,
      lon: this.geoSite.lon + eastMeters * degLonPerMeter,
    };
  }

  private emitP2PBeam(
    from: { id: string; x: number; z: number },
    to: { id: string; x: number; z: number },
    kind: P2PBeamEvent['kind']
  ): void {
    // Avoid flooding duplicate identical beam
    const existing = this.p2pBeams.find(
      (b) => b.fromId === from.id && b.toId === to.id && b.kind === kind && b.ttl > 0.3
    );
    if (existing) {
      existing.fromX = from.x;
      existing.fromZ = from.z;
      existing.toX = to.x;
      existing.toZ = to.z;
      existing.ttl = 0.85;
      return;
    }
    this.p2pBeams.push({
      id: this.beamSeq++,
      fromId: from.id,
      toId: to.id,
      fromX: from.x,
      fromZ: from.z,
      toX: to.x,
      toZ: to.z,
      kind,
      ttl: 0.85,
    });
    if (this.p2pBeams.length > 36) {
      this.p2pBeams.shift();
    }
  }

  private pushLog(sender: string, tag: P2PLogEntry['tag'], message: string): void {
    const totalSec = Math.floor(this.elapsedSec);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    this.logs.unshift({
      id: this.logSeq++,
      timestamp: `${mm}:${ss}`,
      sender,
      tag,
      message,
    });
    if (this.logs.length > 50) {
      this.logs.length = 50;
    }
  }

  public step(dtSec: number): void {
    if (this.paused) return;
    const clampedDt = Math.min(dtSec, 0.05);
    const simDt = clampedDt * this.fieldPace;
    this.elapsedSec += simDt;
    const tickScale = simDt * TICK_RATE_HZ;

    // Age & expire P2P beams and temporary shared hazards
    for (let i = this.p2pBeams.length - 1; i >= 0; i--) {
      this.p2pBeams[i].ttl -= clampedDt;
      if (this.p2pBeams[i].ttl <= 0) {
        this.p2pBeams.splice(i, 1);
      }
    }
    for (let i = this.sharedHazards.length - 1; i >= 0; i--) {
      this.sharedHazards[i].ttl -= simDt;
      if (this.sharedHazards[i].ttl <= 0) {
        this.sharedHazards.splice(i, 1);
      }
    }

    // 1. Update patrolling tractors along rectangular service corridors
    this.stepTractors(simDt);

    // 2. Update P2P peer discovery & neighbor comms
    let commsLinks = 0;
    for (const r of this.robots) {
      r.connectedPeers = [];
      for (const peer of this.robots) {
        if (peer.id === r.id) continue;
        if (Math.hypot(peer.x - r.x, peer.z - r.z) <= RADIO_RADIUS) {
          r.connectedPeers.push(peer.id);
          commsLinks++;
        }
      }
    }
    this.activeCommsCount = Math.floor(commsLinks / 2);

    // 3. Remaining crops per rectangular zone
    const remainingByZone: Record<1 | 2 | 3, number> = {
      1: this.countRemaining(1),
      2: this.countRemaining(2),
      3: this.countRemaining(3),
    };

    // 4. Battery management (30% fixed station threshold + 16% critical mobile battery vehicle rescue)
    for (const robot of this.robots) {
      // Check if critical ("about to die" <= 16%) and not already docked at solar bay
      if (
        robot.battery <= CRITICAL_BATTERY_THRESHOLD &&
        robot.chargePhase !== 'DOCKED' &&
        robot.state !== 'RESCUE_CHARGE' &&
        robot.state !== 'CRITICAL_WAIT'
      ) {
        this.requestBatteryVehicleRescue(robot);
      } else if (
        robot.battery <= BATTERY_CHARGE_THRESHOLD &&
        robot.state !== 'CHARGING' &&
        robot.state !== 'SEEK_CHARGE' &&
        robot.state !== 'CRITICAL_WAIT' &&
        robot.state !== 'RESCUE_CHARGE'
      ) {
        this.requestSolarBay(robot);
      }

      // If waiting for a solar bay, try reserving as soon as one opens
      if (robot.state === 'SEEK_CHARGE' && !robot.assignedBay) {
        this.requestSolarBay(robot);
      }

      // Autonomous Zone Assistance: if activeZone is 100% harvested, promote to assist remaining zones
      if (
        (robot.state === 'HARVEST' || robot.state === 'ASSISTING') &&
        remainingByZone[robot.activeZone] === 0
      ) {
        const nextZone = this.findNextZone(robot.activeZone, remainingByZone);
        if (nextZone && nextZone !== robot.activeZone) {
          const prev = robot.activeZone;
          robot.activeZone = nextZone;
          if (!robot.promotedFrom) {
            robot.promotedFrom = robot.homeZone;
          }
          robot.targetCropIndex = null;
          robot.claimedRow = null;
          robot.state = 'ASSISTING';
          robot.lastComms = `Assisting Zone ${nextZone}`;
          this.pushLog(
            robot.id,
            'ASSIST',
            `Zone ${prev} 100% harvested -> Coordinating with Zone ${nextZone} peers to finish field.`
          );
          for (const peer of this.robots) {
            if (peer.id !== robot.id) {
              this.emitP2PBeam(robot, peer, 'COORD');
            }
          }
        }
      }
    }

    // 5. Step Mobile Battery Vehicle (BAT-01)
    this.stepBatteryVehicle(simDt, tickScale);

    // 6. Step all 6 Autonomous Harvester Rovers
    for (const robot of this.robots) {
      this.stepRobot(robot, simDt, tickScale, remainingByZone);
    }

    // 7. Pairwise collision audit
    for (let i = 0; i < this.robots.length; i++) {
      for (let j = i + 1; j < this.robots.length; j++) {
        const a = this.robots[i];
        const b = this.robots[j];
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        if (dist < 0.72) {
          const pairKey = `${a.id}-${b.id}`;
          const lastT = this.lastCollisionPairTimes.get(pairKey) ?? -10;
          if (this.elapsedSec - lastT > 3.0) {
            this.collisions += 1;
            this.lastCollisionPairTimes.set(pairKey, this.elapsedSec);
          }
        }
      }
    }
  }

  private stepTractors(simDt: number): void {
    for (const t of this.tractors) {
      if (t.laneIndex === 2) {
        // North headland East-West patrol
        t.x += t.vx * simDt;
        if (t.x > RECT_HALF_W) {
          t.x = RECT_HALF_W;
          t.vx = -Math.abs(t.vx);
        } else if (t.x < -RECT_HALF_W) {
          t.x = -RECT_HALF_W;
          t.vx = Math.abs(t.vx);
        }
      } else {
        // Central service alleys (X = -5.6 or +5.6) North-South patrol
        t.z += t.vz * simDt;
        if (t.z > RECT_HALF_D + 0.8) {
          t.z = RECT_HALF_D + 0.8;
          t.vz = -Math.abs(t.vz);
        } else if (t.z < -(RECT_HALF_D + 0.8)) {
          t.z = -(RECT_HALF_D + 0.8);
          t.vz = Math.abs(t.vz);
        }
      }
      t.heading = Math.atan2(t.vx, t.vz);
      t.wheelAngle += Math.hypot(t.vx, t.vz) * simDt / 0.44;
    }
  }

  private countRemaining(zone: 1 | 2 | 3): number {
    let rem = 0;
    const arr = this.cropsByZone[zone];
    for (let i = 0; i < arr.length; i++) {
      if (!arr[i].harvested) rem++;
    }
    return rem;
  }

  private findNextZone(
    current: 1 | 2 | 3,
    remaining: Record<1 | 2 | 3, number>
  ): (1 | 2 | 3) | null {
    const order: Array<1 | 2 | 3> =
      current === 1 ? [2, 3] : current === 2 ? [3, 1] : [2, 1];
    for (const z of order) {
      if (remaining[z] > 0) return z;
    }
    return null;
  }

  private requestSolarBay(robot: InternalRobot): void {
    if (robot.assignedBay) return;
    const openBays = this.bays
      .filter((b) => !b.occupiedBy && !b.reservedBy && !b.exitingBy)
      .sort((a, b) => Math.hypot(a.x - robot.x, a.z - robot.z) - Math.hypot(b.x - robot.x, b.z - robot.z));

    if (openBays.length > 0) {
      const bay = openBays[0];
      bay.reservedBy = robot.id;
      robot.assignedBay = bay.id;
      robot.state = 'SEEK_CHARGE';
      robot.chargePhase = 'HEADLAND';
      robot.targetCropIndex = null;
      robot.claimedRow = null;
      robot.lastComms = `Reserved ${bay.id} (<30% bat)`;
      this.pushLog(
        robot.id,
        'BAY',
        `Battery ${robot.battery.toFixed(0)}% <= 30% -> Reserved ${bay.id} at Solar Station.`
      );
      return;
    }

    // All bays currently occupied: check if mobile battery support vehicle can assist if critically low
    if (robot.battery <= CRITICAL_BATTERY_THRESHOLD) {
      this.requestBatteryVehicleRescue(robot);
    } else if (robot.state !== 'SEEK_CHARGE') {
      robot.state = 'SEEK_CHARGE';
      robot.chargePhase = 'HEADLAND';
      robot.lastComms = 'Holding headland queue for bay';
      this.pushLog(robot.id, 'P2P', `All 4 bays active; staging along South headland.`);
    }
  }

  private requestBatteryVehicleRescue(robot: InternalRobot): void {
    // Release any pending fixed bay reservation if BAT-01 takes over
    if (robot.assignedBay) {
      const bay = this.bays.find((b) => b.id === robot.assignedBay);
      if (bay && bay.reservedBy === robot.id) bay.reservedBy = null;
      robot.assignedBay = null;
    }

    robot.state = 'CRITICAL_WAIT';
    robot.chargePhase = 'NONE';
    robot.targetCropIndex = null;
    robot.lastComms = `MAYDAY ${robot.battery.toFixed(0)}% -> BAT-01`;

    if (this.batteryVehicle.mode === 'STANDBY' || this.batteryVehicle.mode === 'RETURNING') {
      this.batteryVehicle.mode = 'DISPATCHING';
      this.batteryVehicle.targetRobotId = robot.id;
      this.pushLog(
        'BAT-01',
        'RESCUE',
        `Emergency dispatch to ${robot.id} (${robot.battery.toFixed(0)}%) at GPS ${robot.latitude.toFixed(5)}°, ${robot.longitude.toFixed(5)}°.`
      );
      this.emitP2PBeam(robot, this.batteryVehicle, 'RESCUE');
    } else {
      this.pushLog(
        robot.id,
        'RESCUE',
        `Low battery (${robot.battery.toFixed(0)}%) queued for BAT-01 mobile charge.`
      );
    }
  }

  private stepBatteryVehicle(simDt: number, tickScale: number): void {
    const bv = this.batteryVehicle;
    const speedStep = BASE_STEP_SPEED * 1.45 * tickScale;

    if (bv.mode === 'STANDBY') {
      bv.energyReserve = Math.min(100, bv.energyReserve + 4 * simDt);
      // Check if any robot is waiting in CRITICAL_WAIT
      const waiting = this.robots
        .filter((r) => r.state === 'CRITICAL_WAIT')
        .sort((a, b) => a.battery - b.battery);
      if (waiting.length > 0) {
        bv.mode = 'DISPATCHING';
        bv.targetRobotId = waiting[0].id;
        this.pushLog('BAT-01', 'RESCUE', `Auto-dispatching to critical rover ${waiting[0].id}.`);
      }
      return;
    }

    if (bv.mode === 'DISPATCHING' && bv.targetRobotId) {
      const target = this.robots.find((r) => r.id === bv.targetRobotId);
      if (!target) {
        bv.mode = 'RETURNING';
        bv.targetRobotId = null;
        return;
      }

      // Stand off 1.55m beside the stranded robot
      const dx = target.x - bv.x;
      const dz = target.z - bv.z;
      const dist = Math.hypot(dx, dz);

      if (dist <= 1.65) {
        bv.mode = 'CHARGING_ROVER';
        target.state = 'RESCUE_CHARGE';
        target.lastComms = 'Receiving BAT-01 fast charge';
        this.pushLog('BAT-01', 'RESCUE', `Docked alongside ${target.id}. High-rate field recharge active.`);
        this.emitP2PBeam(bv, target, 'RESCUE');
      } else {
        const nx = dx / dist;
        const nz = dz / dist;
        const step = Math.min(speedStep, dist - 1.55);
        bv.x += nx * step;
        bv.z += nz * step;
        bv.heading = Math.atan2(nx, nz);
        bv.wheelAngle += step / 0.35;
      }
      const gps = this.toGPS(bv.x, bv.z);
      bv.latitude = gps.lat;
      bv.longitude = gps.lon;
      return;
    }

    if (bv.mode === 'CHARGING_ROVER' && bv.targetRobotId) {
      const target = this.robots.find((r) => r.id === bv.targetRobotId);
      if (!target) {
        bv.mode = 'RETURNING';
        bv.targetRobotId = null;
        return;
      }
      target.state = 'RESCUE_CHARGE';
      target.battery = Math.min(100, target.battery + 16 * simDt);
      bv.energyReserve = Math.max(20, bv.energyReserve - 2.2 * simDt);
      this.emitP2PBeam(bv, target, 'RESCUE');

      if (target.battery >= 95) {
        target.battery = 100;
        target.state = target.activeZone !== target.homeZone ? 'ASSISTING' : 'HARVEST';
        target.lastComms = 'Rescued to 100% by BAT-01';
        this.pushLog('BAT-01', 'RESCUE', `${target.id} recharged to 100%. Returning to depot.`);
        bv.targetRobotId = null;
        bv.mode = 'RETURNING';
      }
      return;
    }

    if (bv.mode === 'RETURNING') {
      const homeX = -12.5;
      const homeZ = DEPOT_Z;
      const dx = homeX - bv.x;
      const dz = homeZ - bv.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.25) {
        bv.x = homeX;
        bv.z = homeZ;
        bv.heading = 0;
        bv.mode = 'STANDBY';
      } else {
        const step = Math.min(speedStep, dist);
        bv.x += (dx / dist) * step;
        bv.z += (dz / dist) * step;
        bv.heading = Math.atan2(dx, dz);
        bv.wheelAngle += step / 0.35;
      }
      const gps = this.toGPS(bv.x, bv.z);
      bv.latitude = gps.lat;
      bv.longitude = gps.lon;
    }
  }

  private stepRobot(
    robot: InternalRobot,
    simDt: number,
    tickScale: number,
    remainingByZone: Record<1 | 2 | 3, number>
  ): void {
    const moveStep = BASE_STEP_SPEED * robot.speedMs * tickScale;

    // Waiting or charging with Mobile Battery Vehicle BAT-01
    if (robot.state === 'CRITICAL_WAIT' || robot.state === 'RESCUE_CHARGE') {
      this.updateRobotGPS(robot, false, simDt);
      return;
    }

    // Docked at Solar Charging Station: charge completely to 100%
    if (robot.chargePhase === 'DOCKED' && robot.assignedBay) {
      robot.state = 'CHARGING';
      robot.battery = Math.min(100, robot.battery + 11.5 * simDt);
      robot.hopperFill = Math.max(0, robot.hopperFill - 0.35 * simDt);

      const bay = this.bays.find((b) => b.id === robot.assignedBay);
      if (bay) {
        robot.x += (bay.x - robot.x) * Math.min(1, simDt * 8);
        robot.z += (bay.z - robot.z) * Math.min(1, simDt * 8);
      }

      if (robot.battery >= 100) {
        robot.battery = 100;
        robot.hopperFill = 0;
        if (bay) {
          bay.occupiedBy = null;
          bay.exitingBy = robot.id;
        }
        robot.chargePhase = 'EXITING';
        robot.state = robot.activeZone !== robot.homeZone ? 'ASSISTING' : 'HARVEST';
        robot.lastComms = `${robot.assignedBay} full (100%)`;
        this.pushLog(robot.id, 'BAY', `${robot.assignedBay} charge complete (100%). Rejoining field.`);
      }
      this.updateRobotGPS(robot, false, simDt);
      return;
    }

    // Exiting solar bay back onto South headland road
    if (robot.chargePhase === 'EXITING' && robot.assignedBay) {
      const bay = this.bays.find((b) => b.id === robot.assignedBay);
      if (bay) {
        const reached = this.steerTowards(robot, bay.approachX, HEADLAND_S, moveStep, simDt, false);
        if (reached || robot.z <= HEADLAND_S + 0.3) {
          bay.exitingBy = null;
          robot.assignedBay = null;
          robot.chargePhase = 'NONE';
        }
      } else {
        robot.assignedBay = null;
        robot.chargePhase = 'NONE';
      }
      this.drainBattery(robot, simDt, 0.55);
      this.updateRobotGPS(robot, true, simDt);
      return;
    }

    // Scan local sensors for tractors & field obstacles -> broadcast P2P alert to ALL peers!
    const threat = this.detectAndBroadcastObstacles(robot, tickScale);
    if (threat && robot.chargePhase !== 'DOCKING_IN') {
      const prev = robot.state;
      robot.state = 'DODGING';
      robot.dodgingObstacleId = threat.id;
      robot.avoidanceVec = { x: threat.perpX, z: threat.perpZ };
      if (prev !== 'DODGING') {
        robot.lastComms = `Avoiding ${threat.id} (P2P shared)`;
      }
      const tx = robot.x + threat.perpX * 2.2;
      const tz = robot.z + threat.perpZ * 2.2;
      this.steerTowards(robot, tx, tz, moveStep * 1.15, simDt, true);
      this.drainBattery(robot, simDt, 1.1);
      this.updateRobotGPS(robot, true, simDt);
      return;
    } else {
      robot.dodgingObstacleId = null;
      robot.avoidanceVec = null;
    }

    // Seeking Solar Charging Bay via South Headland road
    if (robot.state === 'SEEK_CHARGE') {
      const bay = this.bays.find((b) => b.id === robot.assignedBay);
      if (!bay) {
        // Hold smoothly on South headland staging point
        const holdX = -10 + (Number(robot.id.slice(1)) - 1) * 3.8;
        this.steerTowards(robot, holdX, HEADLAND_S, moveStep, simDt, true);
        this.drainBattery(robot, simDt, 0.55);
        this.updateRobotGPS(robot, true, simDt);
        return;
      }

      if (robot.chargePhase === 'HEADLAND') {
        // First reach South headland if inside field, then drive straight to bay approachX
        const targetZ = robot.z < HEADLAND_S - 0.6 ? HEADLAND_S : bay.approachZ;
        const distToBayApproach = Math.hypot(bay.approachX - robot.x, bay.approachZ - robot.z);
        if (distToBayApproach < 0.45 && !bay.exitingBy && !bay.occupiedBy) {
          robot.chargePhase = 'DOCKING_IN';
        } else {
          this.steerTowards(robot, bay.approachX, targetZ, moveStep, simDt, true);
        }
      } else if (robot.chargePhase === 'DOCKING_IN') {
        const arrived = this.steerTowards(robot, bay.x, bay.z, moveStep * 0.9, simDt, false);
        if (arrived) {
          bay.reservedBy = null;
          bay.occupiedBy = robot.id;
          robot.chargePhase = 'DOCKED';
          robot.state = 'CHARGING';
          robot.heading = 0;
          robot.lastComms = `Charging at ${bay.id}`;
          this.pushLog(robot.id, 'BAY', `Docked cleanly at ${bay.id}. Recharging to 100%.`);
        }
      }
      this.drainBattery(robot, simDt, 0.8);
      this.updateRobotGPS(robot, true, simDt);
      return;
    }

    // Rectangular Row-by-Row Harvest / Assisting
    const zone = robot.activeZone;
    const crops = this.cropsByZone[zone];

    if (remainingByZone[1] === 0 && remainingByZone[2] === 0 && remainingByZone[3] === 0) {
      // 100% of rectangular farm harvested! Return cleanly along headland standby
      robot.state = 'HARVEST';
      robot.lastComms = 'Farm 100% harvested';
      const parkX = -13 + (Number(robot.id.slice(1)) - 1) * 5.2;
      this.steerTowards(robot, parkX, HEADLAND_S, moveStep * 0.7, simDt, true);
      this.updateRobotGPS(robot, true, simDt);
      return;
    }

    robot.state = robot.activeZone !== robot.homeZone ? 'ASSISTING' : 'HARVEST';

    // Validate or pick next crop along rectangular serpentine row, avoiding rows claimed by peers!
    let targetCrop: CropNode | null = null;
    if (
      robot.targetCropIndex !== null &&
      crops[robot.targetCropIndex] &&
      !crops[robot.targetCropIndex].harvested
    ) {
      targetCrop = crops[robot.targetCropIndex];
    } else {
      targetCrop = this.pickNextRectCrop(robot, crops);
      robot.targetCropIndex = targetCrop ? targetCrop.index : null;
      if (targetCrop && targetCrop.row !== robot.claimedRow) {
        robot.claimedRow = targetCrop.row;
        robot.lastComms = `Claimed Z${zone} Row ${targetCrop.row + 1}`;
      }
    }

    if (targetCrop) {
      robot.cutterAngle += simDt * 12 * robot.speedMs;
      this.steerTowards(robot, targetCrop.x, targetCrop.z, moveStep, simDt, true);

      // Harvest crops within 0.72m cutter reach
      for (let i = 0; i < crops.length; i++) {
        const c = crops[i];
        if (c.harvested) continue;
        if (Math.hypot(c.x - robot.x, c.z - robot.z) < 0.72) {
          c.harvested = true;
          robot.harvestedCount += 1;
          robot.hopperFill = Math.min(1, robot.hopperFill + 0.015);
          this.dirtyCrops.push({ zone, index: c.index });
          if (robot.targetCropIndex === c.index) {
            robot.targetCropIndex = null;
          }
        }
      }
    }

    this.drainBattery(robot, simDt, 1.0);
    this.updateRobotGPS(robot, true, simDt);
  }

  private pickNextRectCrop(robot: InternalRobot, crops: CropNode[]): CropNode | null {
    // Rows claimed by peer robots in the same zone
    const peerRows = new Set<number>();
    for (const peer of this.robots) {
      if (peer.id !== robot.id && peer.activeZone === robot.activeZone && peer.claimedRow !== null) {
        peerRows.add(peer.claimedRow);
      }
    }

    let best: CropNode | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < crops.length; i++) {
      const c = crops[i];
      if (c.harvested) continue;

      // Avoid crops sitting directly inside a shared hazard zone
      let inHazard = false;
      for (const hz of this.sharedHazards) {
        if (Math.hypot(c.x - hz.x, c.z - hz.z) < hz.radius + 0.35) {
          inHazard = true;
          break;
        }
      }
      if (inHazard) continue;

      const dist = Math.hypot(c.x - robot.x, c.z - robot.z);
      const sameRowBonus = robot.claimedRow === c.row ? -3.2 : 0;
      const peerRowPenalty = peerRows.has(c.row) ? 6.5 : 0;
      const score = dist + sameRowBonus + peerRowPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    // Fallback if remaining crops are near a hazard edge
    if (!best) {
      for (let i = 0; i < crops.length; i++) {
        const c = crops[i];
        if (!c.harvested) return c;
      }
    }
    return best;
  }

  private detectAndBroadcastObstacles(
    robot: InternalRobot,
    tickScale: number
  ): { id: string; perpX: number; perpZ: number } | null {
    // 1. Check moving tractors within local sensor radius (4.8m)
    for (const tractor of this.tractors) {
      const distNow = Math.hypot(tractor.x - robot.x, tractor.z - robot.z);
      if (distNow <= SENSOR_RADIUS) {
        // Share tractor hazard across P2P mesh
        this.broadcastHazardToSwarm(robot, tractor.id, tractor.x, tractor.z, 1.35, `Tractor ${tractor.id}`);

        const stepDt = (1 / TICK_RATE_HZ) * Math.max(0.5, tickScale);
        const projX = tractor.x + tractor.vx * stepDt * 14;
        const projZ = tractor.z + tractor.vz * stepDt * 14;
        const segDx = projX - tractor.x;
        const segDz = projZ - tractor.z;
        const segLenSq = segDx * segDx + segDz * segDz || 1;
        const t = Math.max(
          0,
          Math.min(1, ((robot.x - tractor.x) * segDx + (robot.z - tractor.z) * segDz) / segLenSq)
        );
        const closestX = tractor.x + t * segDx;
        const closestZ = tractor.z + t * segDz;
        const distToPath = Math.hypot(robot.x - closestX, robot.z - closestZ);

        if (distNow < 2.6 || distToPath < 1.7) {
          const velLen = Math.hypot(tractor.vx, tractor.vz) || 1;
          const ux = tractor.vx / velLen;
          const uz = tractor.vz / velLen;
          const p1x = -uz;
          const p1z = ux;
          const p2x = uz;
          const p2z = -ux;
          const d1 = Math.hypot(robot.x + p1x - closestX, robot.z + p1z - closestZ);
          const d2 = Math.hypot(robot.x + p2x - closestX, robot.z + p2z - closestZ);
          return {
            id: tractor.id,
            perpX: d1 >= d2 ? p1x : p2x,
            perpZ: d1 >= d2 ? p1z : p2z,
          };
        }
      }
    }

    // 2. Check static field obstacles & shared swarm hazards
    for (const obs of this.obstacles) {
      const dist = Math.hypot(obs.x - robot.x, obs.z - robot.z);
      if (dist <= SENSOR_RADIUS) {
        if (!obs.discoveredBy) obs.discoveredBy = robot.id;
        this.broadcastHazardToSwarm(robot, obs.id, obs.x, obs.z, obs.radius + 0.4, `${obs.label} (${obs.id})`);
      }
      if (dist < obs.radius + 1.25) {
        const dx = robot.x - obs.x;
        const dz = robot.z - obs.z;
        const len = Math.hypot(dx, dz) || 1;
        // Tangential + outward bypass
        const tx = -dz / len + (dx / len) * 0.45;
        const tz = dx / len + (dz / len) * 0.45;
        const tLen = Math.hypot(tx, tz) || 1;
        return { id: obs.id, perpX: tx / tLen, perpZ: tz / tLen };
      }
    }

    // 3. Pre-emptive steering around shared hazards reported by peer robots
    for (const hz of this.sharedHazards) {
      if (hz.reportedBy === robot.id) continue;
      const dist = Math.hypot(hz.x - robot.x, hz.z - robot.z);
      if (dist < hz.radius + 1.15) {
        const dx = robot.x - hz.x;
        const dz = robot.z - hz.z;
        const len = Math.hypot(dx, dz) || 1;
        const tx = -dz / len + (dx / len) * 0.4;
        const tz = dx / len + (dz / len) * 0.4;
        const tLen = Math.hypot(tx, tz) || 1;
        return { id: hz.obstacleId, perpX: tx / tLen, perpZ: tz / tLen };
      }
    }

    return null;
  }

  private broadcastHazardToSwarm(
    sender: InternalRobot,
    obsId: string,
    x: number,
    z: number,
    radius: number,
    label: string
  ): void {
    const gps = this.toGPS(x, z);
    const existing = this.sharedHazards.find((h) => h.obstacleId === obsId);
    if (existing) {
      existing.x = x;
      existing.z = z;
      existing.lat = gps.lat;
      existing.lon = gps.lon;
      existing.ttl = 6.0;
    } else {
      this.sharedHazards.push({
        obstacleId: obsId,
        x,
        z,
        radius,
        reportedBy: sender.id,
        lat: gps.lat,
        lon: gps.lon,
        ttl: 6.0,
      });
    }

    const lastSent = sender.lastObstacleBroadcast.get(obsId) ?? -10;
    if (this.elapsedSec - lastSent >= 5.0) {
      sender.lastObstacleBroadcast.set(obsId, this.elapsedSec);
      sender.lastComms = `Broadcast ${obsId} to swarm`;
      this.pushLog(
        sender.id,
        'OBSTACLE',
        `Detected ${label} -> Broadcast GPS (${gps.lat.toFixed(5)}°, ${gps.lon.toFixed(5)}°) to ${sender.connectedPeers.length} peer(s).`
      );
      for (const peer of this.robots) {
        if (peer.id !== sender.id) {
          this.emitP2PBeam(sender, peer, 'OBSTACLE');
          peer.lastComms = `Alert: ${obsId} from ${sender.id}`;
        }
      }
    }
  }

  private steerTowards(
    robot: InternalRobot,
    targetX: number,
    targetZ: number,
    maxStep: number,
    simDt: number,
    avoidPeers: boolean
  ): boolean {
    let dx = targetX - robot.x;
    let dz = targetZ - robot.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.08) return true;

    dx /= dist;
    dz /= dist;

    if (avoidPeers) {
      let repX = 0;
      let repZ = 0;
      for (const peer of this.robots) {
        if (peer.id === robot.id) continue;
        const pdx = robot.x - peer.x;
        const pdz = robot.z - peer.z;
        const pDist = Math.hypot(pdx, pdz);
        if (pDist > 0.001 && pDist < 2.35) {
          const strength = ((2.35 - pDist) / 2.35) * 1.55;
          repX += (pdx / pDist) * strength;
          repZ += (pdz / pDist) * strength;
          this.emitP2PBeam(robot, peer, 'COORD');
          if (this.elapsedSec - robot.lastYieldLogTime > 6.5 && robot.speedMs < peer.speedMs) {
            robot.lastYieldLogTime = this.elapsedSec;
            robot.lastComms = `Yielding to ${peer.id}`;
            this.pushLog(
              robot.id,
              'P2P',
              `Proximity ${pDist.toFixed(1)}m -> Yielding right-of-way to faster peer ${peer.id}.`
            );
          }
        }
      }
      dx += repX;
      dz += repZ;

      const norm = Math.hypot(dx, dz) || 1;
      dx /= norm;
      dz /= norm;
    }

    const stepDist = Math.min(maxStep, dist);
    robot.x += dx * stepDist;
    robot.z += dz * stepDist;

    // Keep inside rectangular farm fence bounds
    robot.x = Math.max(HEADLAND_W, Math.min(HEADLAND_E, robot.x));
    robot.z = Math.max(HEADLAND_N, Math.min(DEPOT_Z + 0.8, robot.z));

    const desiredHeading = Math.atan2(dx, dz);
    const angleDiff = this.normalizeAngle(desiredHeading - robot.heading);
    robot.heading = this.normalizeAngle(robot.heading + angleDiff * Math.min(1, simDt * 8.5));
    robot.wheelAngle += stepDist / WHEEL_RADIUS;

    return dist <= maxStep + 0.12;
  }

  private drainBattery(robot: InternalRobot, simDt: number, multiplier: number): void {
    // Staggered drain rate proportional to speed so robots charge sequentially
    const drainPerSec = (0.28 + robot.speedMs * 1.05) * multiplier;
    robot.battery = Math.max(5, robot.battery - drainPerSec * simDt);
  }

  private updateRobotGPS(robot: InternalRobot, recordTrail: boolean, simDt = 0): void {
    const gps = this.toGPS(robot.x, robot.z);
    robot.latitude = gps.lat;
    robot.longitude = gps.lon;
    if (recordTrail) {
      robot.trailTimer += simDt;
      if (robot.trailTimer >= 0.85) {
        robot.trailTimer = 0;
        robot.gpsTrail.push({ lat: gps.lat, lon: gps.lon, x: robot.x, z: robot.z });
        if (robot.gpsTrail.length > 40) {
          robot.gpsTrail.shift();
        }
      }
    }
  }

  private normalizeAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  public getSnapshot(): SwarmSnapshot {
    const layers: ZoneStats[] = ([1, 2, 3] as const).map((zone) => {
      const arr = this.cropsByZone[zone];
      const total = arr.length;
      let harvested = 0;
      for (let i = 0; i < total; i++) {
        if (arr[i].harvested) harvested++;
      }
      return {
        zone,
        name: ZONE_BOUNDS[zone].name,
        cropName: ZONE_BOUNDS[zone].cropName,
        total,
        harvested,
        pct: total > 0 ? (harvested / total) * 100 : 100,
      };
    });

    const totalCrops = layers.reduce((acc, l) => acc + l.total, 0);
    const totalHarvested = layers.reduce((acc, l) => acc + l.harvested, 0);
    const fieldHarvestedPct = totalCrops > 0 ? (totalHarvested / totalCrops) * 100 : 100;
    const baysInUse = this.bays.filter((b) => b.occupiedBy !== null).length;
    const avgBattery =
      this.robots.reduce((acc, r) => acc + r.battery, 0) / Math.max(1, this.robots.length);

    return {
      elapsedSec: this.elapsedSec,
      paused: this.paused,
      fieldPace: this.fieldPace,
      geoSite: this.geoSite,
      fieldHarvestedPct,
      totalCrops,
      totalHarvested,
      baysInUse,
      avgBattery,
      collisions: this.collisions,
      deadlocks: this.deadlocks,
      activeCommsCount: this.activeCommsCount,
      layers,
      robots: this.robots.map((r) => ({
        id: r.id,
        label: r.label,
        homeZone: r.homeZone,
        activeZone: r.activeZone,
        promotedFrom: r.promotedFrom,
        speedMs: r.speedMs,
        x: r.x,
        z: r.z,
        heading: r.heading,
        wheelAngle: r.wheelAngle,
        cutterAngle: r.cutterAngle,
        battery: r.battery,
        hopperFill: r.hopperFill,
        harvestedCount: r.harvestedCount,
        state: r.state as RobotState,
        chargePhase: r.chargePhase,
        assignedBay: r.assignedBay,
        latitude: r.latitude,
        longitude: r.longitude,
        connectedPeers: [...r.connectedPeers],
        lastComms: r.lastComms,
        dodgingObstacleId: r.dodgingObstacleId,
        avoidanceVec: r.avoidanceVec,
        gpsTrail: r.gpsTrail,
      })),
      bays: this.bays.map((b) => ({ ...b })),
      batteryVehicle: { ...this.batteryVehicle },
      tractors: this.tractors.map((t) => ({ ...t })),
      obstacles: this.obstacles.map((o) => ({ ...o })),
      sharedHazards: this.sharedHazards.map((h) => ({ ...h })),
      p2pBeams: this.p2pBeams.map((b) => ({ ...b })),
      logs: [...this.logs],
    };
  }
}
