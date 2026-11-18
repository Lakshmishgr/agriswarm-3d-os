import * as THREE from 'three';
import type { BayId, CropNode, RobotState } from '../types/swarm';
import { DEPOT_Z, SENSOR_RADIUS } from '../simulation/SwarmEngine';

export interface RoverVisual {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  cutterReel: THREE.Group;
  hopperFill: THREE.Mesh;
  ledBeacon: THREE.Mesh;
  ledMat: THREE.MeshStandardMaterial;
  batteryFill: THREE.Mesh;
  batteryFillMat: THREE.MeshBasicMaterial;
  batteryGroup: THREE.Group;
  sensorCone: THREE.Mesh;
  selectionRing: THREE.Mesh;
  hitProxy: THREE.Mesh;
}

export interface BatteryVehicleVisual {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  beacon: THREE.Mesh;
  beaconMat: THREE.MeshStandardMaterial;
}

export interface TractorVisual {
  group: THREE.Group;
  frontWheels: THREE.Mesh[];
  rearWheels: THREE.Mesh[];
}

export interface SolarStationVisual {
  group: THREE.Group;
  bayPads: Record<BayId, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }>;
}

export interface CropInstancedRig {
  group: THREE.Group;
  zone1Stalks: THREE.InstancedMesh;
  zone1Heads: THREE.InstancedMesh;
  zone2Stalks: THREE.InstancedMesh;
  zone2Cobs: THREE.InstancedMesh;
  zone3Stems: THREE.InstancedMesh;
  zone3Blooms: THREE.InstancedMesh;
}

const STATE_HEX: Record<RobotState, number> = {
  HARVEST: 0x22c55e,
  ASSISTING: 0x06b6d4,
  SEEK_CHARGE: 0xf59e0b,
  CHARGING: 0xfbbf24,
  CRITICAL_WAIT: 0xef4444,
  RESCUE_CHARGE: 0x38bdf8,
  DODGING: 0xf43f5e,
};

export function createRoverVisual(robotId: string, castShadow: boolean): RoverVisual {
  const group = new THREE.Group();
  group.name = `rover-${robotId}`;

  const yellowPaint = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    roughness: 0.35,
    metalness: 0.18,
  });
  const slateMetal = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.55,
    metalness: 0.45,
  });
  const brushedSteel = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.25,
    metalness: 0.85,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.88,
    metalness: 0.05,
  });
  const hopperGrainMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.75,
    metalness: 0.05,
  });

  // Lower frame + hull
  const lowerFrame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.14, 0.92), slateMetal);
  lowerFrame.position.set(0, 0.23, 0);
  lowerFrame.castShadow = castShadow;
  group.add(lowerFrame);

  const upperHull = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.24, 0.62), yellowPaint);
  upperHull.position.set(0, 0.42, 0.08);
  upperHull.castShadow = castShadow;
  group.add(upperHull);

  // 4 off-road wheels
  const tireGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.15, 18).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.16, 12).rotateZ(Math.PI / 2);
  const wheelCoords: Array<[number, number, number]> = [
    [-0.41, 0.22, 0.32],
    [0.41, 0.22, 0.32],
    [-0.41, 0.22, -0.32],
    [0.41, 0.22, -0.32],
  ];

  const wheels: THREE.Mesh[] = [];
  for (const [wx, wy, wz] of wheelCoords) {
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.position.set(wx, wy, wz);
    tire.castShadow = castShadow;
    tire.add(new THREE.Mesh(rimGeo, brushedSteel));
    group.add(tire);
    wheels.push(tire);
  }

  // Rear hopper + rising fill block
  const hopperWalls = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.38), slateMetal);
  hopperWalls.position.set(0, 0.56, -0.22);
  hopperWalls.castShadow = castShadow;
  group.add(hopperWalls);

  const hopperFillGeo = new THREE.BoxGeometry(0.48, 0.24, 0.3);
  hopperFillGeo.translate(0, 0.12, 0);
  const hopperFill = new THREE.Mesh(hopperFillGeo, hopperGrainMat);
  hopperFill.position.set(0, 0.56, -0.22);
  hopperFill.scale.y = 0.05;
  group.add(hopperFill);

  // Front rotating cutter header
  const cutterArmL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.32), slateMetal);
  cutterArmL.position.set(-0.34, 0.24, 0.54);
  group.add(cutterArmL);

  const cutterArmR = cutterArmL.clone();
  cutterArmR.position.x = 0.34;
  group.add(cutterArmR);

  const cutterReel = new THREE.Group();
  cutterReel.position.set(0, 0.22, 0.68);
  const reelCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.84, 10).rotateZ(Math.PI / 2),
    brushedSteel
  );
  cutterReel.add(reelCore);
  for (let b = 0; b < 4; b++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.025, 0.22), yellowPaint);
    blade.rotation.x = (b * Math.PI) / 4;
    cutterReel.add(blade);
  }
  group.add(cutterReel);

  // LiDAR turret & LED beacon
  const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.12, 16), slateMetal);
  turretBase.position.set(0, 0.6, 0.18);
  group.add(turretBase);

  const lidarLens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.08, 16),
    new THREE.MeshPhysicalMaterial({ color: 0x0f172a, roughness: 0.12, metalness: 0.7, clearcoat: 1 })
  );
  lidarLens.position.set(0, 0.69, 0.18);
  group.add(lidarLens);

  const ledMat = new THREE.MeshStandardMaterial({
    color: STATE_HEX.HARVEST,
    emissive: STATE_HEX.HARVEST,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });
  const ledBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), ledMat);
  ledBeacon.position.set(0, 0.78, 0.18);
  group.add(ledBeacon);

  // Floating 3D battery health bar
  const batteryGroup = new THREE.Group();
  batteryGroup.position.set(0, 1.16, 0);
  const barBg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x0f172a, side: THREE.DoubleSide })
  );
  batteryGroup.add(barBg);

  const batteryFillGeo = new THREE.PlaneGeometry(0.8, 0.075);
  batteryFillGeo.translate(0.4, 0, 0.01);
  const batteryFillMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide });
  const batteryFill = new THREE.Mesh(batteryFillGeo, batteryFillMat);
  batteryFill.position.set(-0.4, 0, 0);
  batteryGroup.add(batteryFill);
  group.add(batteryGroup);

  // Translucent ground sensor cone (4.8m)
  const coneGeo = new THREE.CircleGeometry(SENSOR_RADIUS, 28, Math.PI / 2 - 0.65, 1.3);
  coneGeo.rotateX(-Math.PI / 2);
  coneGeo.rotateY(Math.PI / 2);
  const sensorMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const sensorCone = new THREE.Mesh(coneGeo, sensorMat);
  sensorCone.position.set(0, 0.05, 0);
  group.add(sensorCone);

  // Selection ring
  const selGeo = new THREE.RingGeometry(0.76, 0.94, 32);
  selGeo.rotateX(-Math.PI / 2);
  const selectionRing = new THREE.Mesh(
    selGeo,
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
  );
  selectionRing.position.set(0, 0.04, 0);
  selectionRing.visible = false;
  group.add(selectionRing);

  // Invisible simplified raycast hit proxy on layer 1
  const hitProxy = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 1.2, 1.45),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitProxy.position.set(0, 0.55, 0.05);
  hitProxy.layers.set(1);
  hitProxy.userData.robotId = robotId;
  group.add(hitProxy);

  return {
    group,
    wheels,
    cutterReel,
    hopperFill,
    ledBeacon,
    ledMat,
    batteryFill,
    batteryFillMat,
    batteryGroup,
    sensorCone,
    selectionRing,
    hitProxy,
  };
}

export function updateRoverVisualState(
  visual: RoverVisual,
  state: RobotState,
  battery: number,
  hopperFill: number
): void {
  const hex = STATE_HEX[state];
  visual.ledMat.color.setHex(hex);
  visual.ledMat.emissive.setHex(hex);
  visual.hopperFill.scale.y = Math.max(0.04, hopperFill);

  const pct = Math.max(0.02, Math.min(1, battery / 100));
  visual.batteryFill.scale.x = pct;
  if (battery > 50) visual.batteryFillMat.color.setHex(0x22c55e);
  else if (battery > 30) visual.batteryFillMat.color.setHex(0xf59e0b);
  else visual.batteryFillMat.color.setHex(0xef4444);
}

export function createBatteryVehicleVisual(
  solarTex: THREE.CanvasTexture,
  isSoftwareGl: boolean
): BatteryVehicleVisual {
  const group = new THREE.Group();
  group.name = 'battery-vehicle-BAT-01';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.35,
    metalness: 0.25,
  });
  const batteryPackMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    roughness: 0.3,
    metalness: 0.4,
  });
  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.65,
    metalness: 0.4,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.8 });

  // Heavy-duty chassis
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.2, 1.95), chassisMat);
  frame.position.set(0, 0.36, 0);
  frame.castShadow = !isSoftwareGl;
  group.add(frame);

  // Front cab (+Z)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.56, 0.68), bodyMat);
  cab.position.set(0, 0.74, 0.58);
  cab.castShadow = !isSoftwareGl;
  group.add(cab);

  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(0.94, 0.32, 0.06),
    new THREE.MeshPhysicalMaterial({
      color: 0xbae6fd,
      roughness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.7,
      transparent: true,
      opacity: isSoftwareGl ? 0.5 : 1,
    })
  );
  windshield.position.set(0, 0.8, 0.92);
  group.add(windshield);

  // Rear high-capacity Li-Ion battery bank module
  const pack = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.68, 1.08), batteryPackMat);
  pack.position.set(0, 0.8, -0.35);
  pack.castShadow = !isSoftwareGl;
  group.add(pack);

  // Roof solar trickle panel
  const roofSolar = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.05, 1.0),
    new THREE.MeshStandardMaterial({ map: solarTex, roughness: 0.2, metalness: 0.3 })
  );
  roofSolar.position.set(0, 1.17, -0.35);
  group.add(roofSolar);

  // Emergency beacon light bar
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 0.8,
  });
  const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.16), beaconMat);
  beacon.position.set(0, 1.08, 0.58);
  group.add(beacon);

  // 4 Wheels (radius 0.34)
  const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 18).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.23, 12).rotateZ(Math.PI / 2);
  const wheels: THREE.Mesh[] = [];
  for (const [wx, wz] of [
    [-0.64, 0.62],
    [0.64, 0.62],
    [-0.64, -0.58],
    [0.64, -0.58],
  ]) {
    const w = new THREE.Mesh(tireGeo, tireMat);
    w.position.set(wx, 0.34, wz);
    w.castShadow = !isSoftwareGl;
    w.add(new THREE.Mesh(rimGeo, rimMat));
    group.add(w);
    wheels.push(w);
  }

  return { group, wheels, beacon, beaconMat };
}

export function createTractorVisual(tractorId: string, isSoftwareGl: boolean): TractorVisual {
  const group = new THREE.Group();
  group.name = `tractor-${tractorId}`;

  const redBody = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.32, metalness: 0.25 });
  const darkChassis = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65, metalness: 0.45 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.9, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.75 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbae6fd,
    roughness: 0.08,
    metalness: 0.1,
    transmission: isSoftwareGl ? 0 : 0.72,
    transparent: true,
    opacity: isSoftwareGl ? 0.45 : 1,
    ior: 1.5,
  });

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.24, 1.7), darkChassis);
  frame.position.set(0, 0.46, 0);
  frame.castShadow = !isSoftwareGl;
  group.add(frame);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.48, 0.95), redBody);
  hood.position.set(0, 0.78, 0.42);
  hood.castShadow = !isSoftwareGl;
  group.add(hood);

  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.38, 0.06), darkChassis);
  grille.position.set(0, 0.76, 0.9);
  group.add(grille);

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.65, 10), darkChassis);
  exhaust.position.set(0.32, 1.18, 0.56);
  group.add(exhaust);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.72, 0.72), glassMat);
  cab.position.set(0, 1.06, -0.35);
  group.add(cab);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.1, 0.84), redBody);
  roof.position.set(0, 1.46, -0.35);
  roof.castShadow = !isSoftwareGl;
  group.add(roof);

  const frontTireGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 16).rotateZ(Math.PI / 2);
  const frontRimGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.19, 10).rotateZ(Math.PI / 2);
  const frontWheels: THREE.Mesh[] = [];
  for (const side of [-0.52, 0.52]) {
    const wheel = new THREE.Mesh(frontTireGeo, tireMat);
    wheel.position.set(side, 0.28, 0.64);
    wheel.castShadow = !isSoftwareGl;
    wheel.add(new THREE.Mesh(frontRimGeo, rimMat));
    group.add(wheel);
    frontWheels.push(wheel);
  }

  const rearTireGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.26, 20).rotateZ(Math.PI / 2);
  const rearRimGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.27, 12).rotateZ(Math.PI / 2);
  const rearWheels: THREE.Mesh[] = [];
  for (const side of [-0.58, 0.58]) {
    const wheel = new THREE.Mesh(rearTireGeo, tireMat);
    wheel.position.set(side, 0.46, -0.42);
    wheel.castShadow = !isSoftwareGl;
    wheel.add(new THREE.Mesh(rearRimGeo, rimMat));
    group.add(wheel);
    rearWheels.push(wheel);
  }

  return { group, frontWheels, rearWheels };
}

export function createSolarStationVisual(
  solarTexture: THREE.CanvasTexture,
  castShadow: boolean
): SolarStationVisual {
  const group = new THREE.Group();

  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85, metalness: 0.08 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.3, metalness: 0.8 });

  // Rectangular Solar Station canopy spanning X: [-8, +8] at Z = DEPOT_Z (+16.2)
  const canopyW = 16.5;
  const canopyD = 3.2;

  // Support stanchions
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 2.7, 10);
  for (const px of [-7.8, -4.0, 0, 4.0, 7.8]) {
    for (const pz of [DEPOT_Z - 1.25, DEPOT_Z + 1.25]) {
      const post = new THREE.Mesh(postGeo, steelMat);
      post.position.set(px, 1.35, pz);
      post.castShadow = castShadow;
      group.add(post);
    }
  }

  // Angled photovoltaic solar roof
  const roofGroup = new THREE.Group();
  roofGroup.position.set(0, 2.75, DEPOT_Z);
  roofGroup.rotation.x = 0.22;

  const roofFrame = new THREE.Mesh(new THREE.BoxGeometry(canopyW, 0.12, canopyD), steelMat);
  roofFrame.castShadow = castShadow;
  roofGroup.add(roofFrame);

  const panelMat = new THREE.MeshPhysicalMaterial({
    map: solarTexture,
    roughness: 0.16,
    metalness: 0.35,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const panelSurface = new THREE.Mesh(new THREE.BoxGeometry(canopyW - 0.3, 0.06, canopyD - 0.3), panelMat);
  panelSurface.position.y = 0.07;
  roofGroup.add(panelSurface);
  group.add(roofGroup);

  // Battery Storage Inverter Bank behind bays
  const bankBox = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.15, 0.85), concreteMat);
  bankBox.position.set(-10.2, 0.58, DEPOT_Z + 0.8);
  bankBox.castShadow = castShadow;
  group.add(bankBox);

  // 4 Drive-in Charging Pads (BAY-1..4 at X = -6, -2, +2, +6)
  const bayCoords: Record<BayId, number> = {
    'BAY-1': -6.0,
    'BAY-2': -2.0,
    'BAY-3': 2.0,
    'BAY-4': 6.0,
  };
  const bayPads = {} as Record<BayId, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }>;
  const padGeo = new THREE.BoxGeometry(1.5, 0.06, 1.7);

  for (const bayId of ['BAY-1', 'BAY-2', 'BAY-3', 'BAY-4'] as BayId[]) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.8,
      roughness: 0.3,
    });
    const mesh = new THREE.Mesh(padGeo, mat);
    mesh.position.set(bayCoords[bayId], 0.04, DEPOT_Z);
    group.add(mesh);
    bayPads[bayId] = { mesh, mat };
  }

  return { group, bayPads };
}

export function createObstacleVisual(label: string, castShadow: boolean): THREE.Group {
  const group = new THREE.Group();
  const isRock = label.toLowerCase().includes('boulder') || label.toLowerCase().includes('rock');

  if (isRock) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.92, metalness: 0.04 });
    const rock1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 1), rockMat);
    rock1.scale.set(1.15, 0.72, 0.95);
    rock1.position.y = 0.38;
    rock1.castShadow = castShadow;
    group.add(rock1);
  } else {
    const crateMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.75 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.78, 0.95), crateMat);
    crate.position.y = 0.39;
    crate.castShadow = castShadow;
    group.add(crate);
  }

  const hazardRingGeo = new THREE.RingGeometry(0.95, 1.15, 24);
  hazardRingGeo.rotateX(-Math.PI / 2);
  const hazardRing = new THREE.Mesh(
    hazardRingGeo,
    new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    })
  );
  hazardRing.position.y = 0.04;
  group.add(hazardRing);

  return group;
}

export function createEnvironmentProps(
  barnTex: THREE.CanvasTexture,
  castShadow: boolean
): THREE.Group {
  const envGroup = new THREE.Group();

  // 1. Rectangular Wooden Perimeter Fence enclosing X:[-21.2..21.2], Z:[-15.4..19.0]
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7c5331, roughness: 0.88, metalness: 0.02 });
  const postPoints: Array<[number, number]> = [];
  const xMin = -21.2;
  const xMax = 21.2;
  const zMin = -15.4;
  const zMax = 19.0;
  const step = 2.65;

  for (let x = xMin; x <= xMax + 0.1; x += step) {
    postPoints.push([x, zMin]);
    postPoints.push([x, zMax]);
  }
  for (let z = zMin + step; z <= zMax - step + 0.1; z += step) {
    postPoints.push([xMin, z]);
    postPoints.push([xMax, z]);
  }

  const postGeo = new THREE.BoxGeometry(0.16, 1.1, 0.16);
  postGeo.translate(0, 0.55, 0);
  const posts = new THREE.InstancedMesh(postGeo, woodMat, postPoints.length);
  posts.castShadow = castShadow;
  const dummy = new THREE.Object3D();
  postPoints.forEach(([px, pz], i) => {
    dummy.position.set(px, 0, pz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  });
  posts.computeBoundingSphere();
  envGroup.add(posts);

  // Fence horizontal rails along all 4 sides
  const railGeoEW = new THREE.BoxGeometry(xMax - xMin, 0.09, 0.07);
  const railGeoNS = new THREE.BoxGeometry(0.07, 0.09, zMax - zMin);
  for (const ry of [0.42, 0.84]) {
    const rN = new THREE.Mesh(railGeoEW, woodMat);
    rN.position.set(0, ry, zMin);
    const rS = new THREE.Mesh(railGeoEW, woodMat);
    rS.position.set(0, ry, zMax);
    const rW = new THREE.Mesh(railGeoNS, woodMat);
    rW.position.set(xMin, ry, (zMin + zMax) / 2);
    const rE = new THREE.Mesh(railGeoNS, woodMat);
    rE.position.set(xMax, ry, (zMin + zMax) / 2);
    envGroup.add(rN, rS, rW, rE);
  }

  // 2. Classic Red Barn + Grain Silo at (-28, 0, -10)
  const barnGroup = new THREE.Group();
  barnGroup.position.set(-28.5, 0, -9.5);
  barnGroup.rotation.y = Math.PI / 2 - 0.15;

  const wallMat = new THREE.MeshStandardMaterial({ map: barnTex, roughness: 0.78 });
  const whiteTrimMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65, metalness: 0.2 });
  const siloMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.32, metalness: 0.78 });

  const barnBody = new THREE.Mesh(new THREE.BoxGeometry(7.2, 4.2, 9.6), wallMat);
  barnBody.position.set(0, 2.1, 0);
  barnBody.castShadow = castShadow;
  barnBody.receiveShadow = true;
  barnGroup.add(barnBody);

  const roofShape = new THREE.Shape();
  roofShape.moveTo(-4.1, 0);
  roofShape.lineTo(0, 2.8);
  roofShape.lineTo(4.1, 0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 10.2, bevelEnabled: false });
  roofGeo.translate(0, 0, -5.1);
  const roofMesh = new THREE.Mesh(roofGeo, roofMat);
  roofMesh.position.set(0, 4.15, 0);
  roofMesh.castShadow = castShadow;
  barnGroup.add(roofMesh);

  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.9, 0.14), whiteTrimMat);
  doorFrame.position.set(0, 1.45, 4.82);
  barnGroup.add(doorFrame);

  const siloBody = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 8.2, 20), siloMat);
  siloBody.position.set(5.4, 4.1, -1.6);
  siloBody.castShadow = castShadow;
  barnGroup.add(siloBody);

  const siloDome = new THREE.Mesh(
    new THREE.SphereGeometry(1.86, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    siloMat
  );
  siloDome.position.set(5.4, 8.2, -1.6);
  barnGroup.add(siloDome);

  envGroup.add(barnGroup);

  // 3. Windbreak Farm Trees outside rectangular fence
  const treeCoords: Array<[number, number]> = [
    [-25, -18], [-15, -20], [-4, -20], [8, -20], [19, -19], [26, -12],
    [26, 0], [26, 12], [24, 22], [12, 23], [-2, 23], [-16, 23], [-26, 16], [-27, 4],
  ];
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 8);
  trunkGeo.translate(0, 1.1, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3c24, roughness: 0.9 });
  const crownGeo = new THREE.ConeGeometry(1.65, 3.8, 9);
  crownGeo.translate(0, 3.6, 0);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f6b31, roughness: 0.82 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCoords.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCoords.length);
  trunks.castShadow = castShadow;
  crowns.castShadow = castShadow;

  const tintColor = new THREE.Color();
  treeCoords.forEach(([tx, tz], i) => {
    const scale = 0.88 + ((i * 7) % 28) * 0.01;
    dummy.position.set(tx, 0, tz);
    dummy.rotation.set(0, i * 0.7, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    crowns.setMatrixAt(i, dummy.matrix);
    tintColor.setHSL(0.31 + ((i % 5) - 2) * 0.015, 0.45, 0.28 + (i % 4) * 0.03);
    crowns.setColorAt(i, tintColor);
  });
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  envGroup.add(trunks, crowns);

  return envGroup;
}

export function createCropInstancedRig(
  cropsByZone: Record<1 | 2 | 3, CropNode[]>,
  castShadow: boolean
): CropInstancedRig {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();

  // Zone 1: Golden Wheat
  const z1 = cropsByZone[1];
  const wheatStalkGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.58, 6);
  wheatStalkGeo.translate(0, 0.29, 0);
  const wheatHeadGeo = new THREE.ConeGeometry(0.095, 0.28, 6);
  wheatHeadGeo.translate(0, 0.65, 0);
  const wheatStalkMat = new THREE.MeshStandardMaterial({ color: 0xca8a04, roughness: 0.78 });
  const wheatHeadMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.68 });

  const zone1Stalks = new THREE.InstancedMesh(wheatStalkGeo, wheatStalkMat, z1.length);
  const zone1Heads = new THREE.InstancedMesh(wheatHeadGeo, wheatHeadMat, z1.length);
  zone1Stalks.castShadow = castShadow;
  zone1Heads.castShadow = castShadow;

  for (let i = 0; i < z1.length; i++) {
    const c = z1[i];
    dummy.position.set(c.x, 0, c.z);
    dummy.rotation.set(0, (i * 1.1) % Math.PI, 0);
    dummy.scale.setScalar(c.harvested ? 0 : c.scale);
    dummy.updateMatrix();
    zone1Stalks.setMatrixAt(i, dummy.matrix);
    zone1Heads.setMatrixAt(i, dummy.matrix);
  }
  zone1Stalks.computeBoundingSphere();
  zone1Heads.computeBoundingSphere();

  // Zone 2: Green Corn with Yellow Cobs
  const z2 = cropsByZone[2];
  const cornStalkGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.92, 6);
  cornStalkGeo.translate(0, 0.46, 0);
  const cornCobGeo = new THREE.CapsuleGeometry(0.065, 0.16, 4, 6);
  cornCobGeo.translate(0.08, 0.54, 0);
  const cornStalkMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.72 });
  const cornCobMat = new THREE.MeshStandardMaterial({ color: 0xfde047, roughness: 0.58 });

  const zone2Stalks = new THREE.InstancedMesh(cornStalkGeo, cornStalkMat, z2.length);
  const zone2Cobs = new THREE.InstancedMesh(cornCobGeo, cornCobMat, z2.length);
  zone2Stalks.castShadow = castShadow;
  zone2Cobs.castShadow = castShadow;

  for (let i = 0; i < z2.length; i++) {
    const c = z2[i];
    dummy.position.set(c.x, 0, c.z);
    dummy.rotation.set(0, (i * 0.8) % Math.PI, 0);
    dummy.scale.setScalar(c.harvested ? 0 : c.scale);
    dummy.updateMatrix();
    zone2Stalks.setMatrixAt(i, dummy.matrix);
    zone2Cobs.setMatrixAt(i, dummy.matrix);
  }
  zone2Stalks.computeBoundingSphere();
  zone2Cobs.computeBoundingSphere();

  // Zone 3: Tall Orange Sunflowers
  const z3 = cropsByZone[3];
  const sunStemGeo = new THREE.CylinderGeometry(0.045, 0.065, 1.12, 6);
  sunStemGeo.translate(0, 0.56, 0);
  const sunBloomGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.09, 10);
  sunBloomGeo.rotateX(Math.PI / 2 - 0.3);
  sunBloomGeo.translate(0, 1.12, 0.04);
  const sunStemMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.75 });
  const sunBloomMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.55 });

  const zone3Stems = new THREE.InstancedMesh(sunStemGeo, sunStemMat, z3.length);
  const zone3Blooms = new THREE.InstancedMesh(sunBloomGeo, sunBloomMat, z3.length);
  zone3Stems.castShadow = castShadow;
  zone3Blooms.castShadow = castShadow;

  for (let i = 0; i < z3.length; i++) {
    const c = z3[i];
    dummy.position.set(c.x, 0, c.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(c.harvested ? 0 : c.scale);
    dummy.updateMatrix();
    zone3Stems.setMatrixAt(i, dummy.matrix);
    zone3Blooms.setMatrixAt(i, dummy.matrix);
  }
  zone3Stems.computeBoundingSphere();
  zone3Blooms.computeBoundingSphere();

  group.add(zone1Stalks, zone1Heads, zone2Stalks, zone2Cobs, zone3Stems, zone3Blooms);

  return {
    group,
    zone1Stalks,
    zone1Heads,
    zone2Stalks,
    zone2Cobs,
    zone3Stems,
    zone3Blooms,
  };
}
