import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Compass, Eye, EyeOff, LocateFixed, Radio, RotateCcw, X } from 'lucide-react';
import type { SwarmEngine } from '../simulation/SwarmEngine';
import type { BayId, RobotTelemetry, SwarmSnapshot } from '../types/swarm';
import {
  createBarnWallTexture,
  createFarmGroundTexture,
  createSolarPanelTexture,
} from '../three/farmTextures';
import {
  createBatteryVehicleVisual,
  createCropInstancedRig,
  createEnvironmentProps,
  createObstacleVisual,
  createRoverVisual,
  createSolarStationVisual,
  createTractorVisual,
  updateRoverVisualState,
  type BatteryVehicleVisual,
  type CropInstancedRig,
  type RoverVisual,
  type TractorVisual,
} from '../three/farmModels';

interface FarmViewport3DProps {
  engine: SwarmEngine;
  snapshot: SwarmSnapshot;
  selectedRobotId: string | null;
  onSelectRobot: (robotId: string | null) => void;
  showSensorCones: boolean;
  onToggleSensorCones: () => void;
  resetSignal: number;
  onSnapshot: (snapshot: SwarmSnapshot) => void;
}

const DEFAULT_CAM_POS = new THREE.Vector3(24, 21, 28);
const DEFAULT_TARGET = new THREE.Vector3(0, 0.5, 1.5);

// Pre-allocated math helpers (zero GC inside animation loop)
const _mat4 = new THREE.Matrix4();
const _zeroScale = new THREE.Vector3(0, 0, 0);
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _targetFocus = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export default function FarmViewport3D({
  engine,
  snapshot,
  selectedRobotId,
  onSelectRobot,
  showSensorCones,
  onToggleSensorCones,
  resetSignal,
  onSnapshot,
}: FarmViewport3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const selectedIdRef = useRef<string | null>(selectedRobotId);
  const showConesRef = useRef<boolean>(showSensorCones);
  const onSelectRef = useRef(onSelectRobot);
  const onSnapshotRef = useRef(onSnapshot);
  const resetAnimRef = useRef<boolean>(false);
  const lastResetSignalRef = useRef<number>(resetSignal);
  const cameraResetBtnRef = useRef<boolean>(false);

  selectedIdRef.current = selectedRobotId;
  showConesRef.current = showSensorCones;
  onSelectRef.current = onSelectRobot;
  onSnapshotRef.current = onSnapshot;

  useEffect(() => {
    if (resetSignal !== lastResetSignalRef.current) {
      lastResetSignalRef.current = resetSignal;
      resetAnimRef.current = true;
    }
  }, [resetSignal]);

  const handleResetViewClick = () => {
    onSelectRef.current(null);
    cameraResetBtnRef.current = true;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('WebGL2 context could not be initialized on this device.');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initW = container.clientWidth || 800;
    const initH = container.clientHeight || 600;
    renderer.setSize(initW, initH);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError('WebGL rendering context was temporarily lost.');
    };
    const onContextRestored = () => {
      setWebglError(null);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    const skyColor = new THREE.Color(0xc7e3f7);
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(0xc7e3f7, 0.008);

    const camera = new THREE.PerspectiveCamera(46, initW / initH, 0.25, 220);
    camera.position.copy(DEFAULT_CAM_POS);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    const hemiLight = new THREE.HemisphereLight(0x9bd3f7, 0x4b6036, 0.85);
    hemiLight.position.set(0, 40, 0);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff4d6, 1.85);
    sunLight.position.set(26, 36, 20);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 2;
    sunLight.shadow.camera.far = 105;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 30;
    sunLight.shadow.camera.bottom = -30;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.45);
    rimLight.position.set(-24, 16, -22);
    scene.add(rimLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.minDistance = 6;
    controls.maxDistance = 64;
    controls.target.copy(DEFAULT_TARGET);
    controls.update();

    controls.addEventListener('start', () => {
      cameraResetBtnRef.current = false;
    });

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const groundTex = createFarmGroundTexture(maxAniso);
    const solarTex = createSolarPanelTexture(maxAniso);
    const barnTex = createBarnWallTexture(maxAniso);

    // Farm Terrain (140m x 140m)
    const groundGeo = new THREE.PlaneGeometry(140, 140);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.92,
      metalness: 0.02,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    const envProps = createEnvironmentProps(barnTex, !isSoftwareGl);
    scene.add(envProps);

    // Solar Charging Station along South Apron
    const solarStation = createSolarStationVisual(solarTex, !isSoftwareGl);
    scene.add(solarStation.group);

    // Mobile Battery Support Vehicle (BAT-01)
    const batteryVehicleRig: BatteryVehicleVisual = createBatteryVehicleVisual(
      solarTex,
      isSoftwareGl
    );
    scene.add(batteryVehicleRig.group);

    // 3-Zone Rectangular Instanced Crops
    let cropRig: CropInstancedRig = createCropInstancedRig(
      engine.cropsByZone,
      !isSoftwareGl
    );
    scene.add(cropRig.group);

    // 6 Articulated Harvester Rovers
    const roverMap = new Map<string, RoverVisual>();
    const hitProxies: THREE.Object3D[] = [];
    const initialSnap = engine.getSnapshot();
    for (const r of initialSnap.robots) {
      const rig = createRoverVisual(r.id, !isSoftwareGl);
      rig.group.position.set(r.x, 0, r.z);
      rig.group.rotation.y = r.heading;
      scene.add(rig.group);
      roverMap.set(r.id, rig);
      hitProxies.push(rig.hitProxy);
    }

    // Dynamic Tractors
    const tractorMap = new Map<string, TractorVisual>();
    const syncTractors = (snap: SwarmSnapshot) => {
      for (const [tid, trig] of tractorMap.entries()) {
        if (!snap.tractors.some((t) => t.id === tid)) {
          scene.remove(trig.group);
          tractorMap.delete(tid);
        }
      }
      for (const t of snap.tractors) {
        let trig = tractorMap.get(t.id);
        if (!trig) {
          trig = createTractorVisual(t.id, isSoftwareGl);
          scene.add(trig.group);
          tractorMap.set(t.id, trig);
        }
        trig.group.position.set(t.x, 0, t.z);
        trig.group.rotation.y = t.heading;
        for (const fw of trig.frontWheels) fw.rotation.x = t.wheelAngle * 1.4;
        for (const rw of trig.rearWheels) rw.rotation.x = t.wheelAngle;
      }
    };
    syncTractors(initialSnap);

    // Dynamic Field Obstacles
    const obstacleMap = new Map<string, THREE.Group>();
    const syncObstacles = (snap: SwarmSnapshot) => {
      for (const [oid, oGroup] of obstacleMap.entries()) {
        if (!snap.obstacles.some((o) => o.id === oid)) {
          scene.remove(oGroup);
          obstacleMap.delete(oid);
        }
      }
      for (const obs of snap.obstacles) {
        if (!obstacleMap.has(obs.id)) {
          const oGroup = createObstacleVisual(obs.label, !isSoftwareGl);
          oGroup.position.set(obs.x, 0, obs.z);
          scene.add(oGroup);
          obstacleMap.set(obs.id, oGroup);
        }
      }
    };
    syncObstacles(initialSnap);

    // Pre-allocated P2P Radio Communication Beam LineSegments (up to 40 beams)
    const maxBeams = 40;
    const beamPositions = new Float32Array(maxBeams * 6);
    const beamColors = new Float32Array(maxBeams * 6);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPositions, 3));
    beamGeo.setAttribute('color', new THREE.BufferAttribute(beamColors, 3));
    beamGeo.setDrawRange(0, 0);
    const beamLines = new THREE.LineSegments(
      beamGeo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
      })
    );
    beamLines.frustumCulled = false;
    scene.add(beamLines);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Raycasting for Click-on-Rover
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      const moveDist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moveDist > 6 || e.button !== 0) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const hits = raycaster.intersectObjects(hitProxies, false);
      if (hits.length > 0) {
        const clickedId = hits[0].object.userData.robotId as string | undefined;
        if (clickedId) {
          cameraResetBtnRef.current = false;
          onSelectRef.current(clickedId);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(100, entry.contentRect.width);
        const h = Math.max(100, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();
    let uiEmitAccum = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const rebuildCropsIfReset = () => {
      scene.remove(cropRig.group);
      cropRig.zone1Stalks.geometry.dispose();
      cropRig.zone1Heads.geometry.dispose();
      cropRig.zone2Stalks.geometry.dispose();
      cropRig.zone2Cobs.geometry.dispose();
      cropRig.zone3Stems.geometry.dispose();
      cropRig.zone3Blooms.geometry.dispose();
      cropRig = createCropInstancedRig(engine.cropsByZone, !isSoftwareGl);
      scene.add(cropRig.group);
    };

    const tick = (now?: number) => {
      if (disposed) return;
      const ts = now ?? performance.now();
      const rawDt = Math.min(0.05, Math.max(0.001, (ts - lastTime) / 1000));
      lastTime = ts;

      if (resetAnimRef.current) {
        resetAnimRef.current = false;
        rebuildCropsIfReset();
      }

      engine.step(rawDt);

      if (engine.dirtyCrops.length > 0) {
        let z1Dirty = false;
        let z2Dirty = false;
        let z3Dirty = false;
        for (let i = 0; i < engine.dirtyCrops.length; i++) {
          const item = engine.dirtyCrops[i];
          const meshes =
            item.zone === 1
              ? [cropRig.zone1Stalks, cropRig.zone1Heads]
              : item.zone === 2
              ? [cropRig.zone2Stalks, cropRig.zone2Cobs]
              : [cropRig.zone3Stems, cropRig.zone3Blooms];

          meshes[0].getMatrixAt(item.index, _mat4);
          _mat4.decompose(_pos, _quat, _scale);
          _mat4.compose(_pos, _quat, _zeroScale);
          meshes[0].setMatrixAt(item.index, _mat4);
          meshes[1].setMatrixAt(item.index, _mat4);

          if (item.zone === 1) z1Dirty = true;
          else if (item.zone === 2) z2Dirty = true;
          else z3Dirty = true;
        }
        if (z1Dirty) {
          cropRig.zone1Stalks.instanceMatrix.needsUpdate = true;
          cropRig.zone1Heads.instanceMatrix.needsUpdate = true;
        }
        if (z2Dirty) {
          cropRig.zone2Stalks.instanceMatrix.needsUpdate = true;
          cropRig.zone2Cobs.instanceMatrix.needsUpdate = true;
        }
        if (z3Dirty) {
          cropRig.zone3Stems.instanceMatrix.needsUpdate = true;
          cropRig.zone3Blooms.instanceMatrix.needsUpdate = true;
        }
        engine.dirtyCrops.length = 0;
      }

      const snap = engine.getSnapshot();

      // Update Solar Station pads
      for (const bay of snap.bays) {
        const pad = solarStation.bayPads[bay.id as BayId];
        if (!pad) continue;
        if (bay.occupiedBy) {
          pad.mat.color.setHex(0xf59e0b);
          pad.mat.emissive.setHex(0xd97706);
          pad.mat.emissiveIntensity = 1.25;
        } else if (bay.reservedBy) {
          pad.mat.color.setHex(0x38bdf8);
          pad.mat.emissive.setHex(0x0284c7);
          pad.mat.emissiveIntensity = 1.0;
        } else {
          pad.mat.color.setHex(0x10b981);
          pad.mat.emissive.setHex(0x059669);
          pad.mat.emissiveIntensity = 0.75;
        }
      }

      // Sync Mobile Battery Vehicle BAT-01
      const bv = snap.batteryVehicle;
      batteryVehicleRig.group.position.set(bv.x, 0, bv.z);
      batteryVehicleRig.group.rotation.y = bv.heading;
      for (const w of batteryVehicleRig.wheels) {
        w.rotation.x = bv.wheelAngle;
      }
      if (bv.mode === 'DISPATCHING' || bv.mode === 'CHARGING_ROVER') {
        batteryVehicleRig.beaconMat.color.setHex(0xf59e0b);
        batteryVehicleRig.beaconMat.emissive.setHex(0xf59e0b);
        batteryVehicleRig.beaconMat.emissiveIntensity = 1.6;
      } else {
        batteryVehicleRig.beaconMat.color.setHex(0x38bdf8);
        batteryVehicleRig.beaconMat.emissive.setHex(0x0ea5e9);
        batteryVehicleRig.beaconMat.emissiveIntensity = 0.6;
      }

      // Sync Rovers
      const activeSel = selectedIdRef.current;
      const conesVisible = showConesRef.current;

      for (const r of snap.robots) {
        const rig = roverMap.get(r.id);
        if (!rig) continue;

        rig.group.position.set(r.x, 0, r.z);
        rig.group.rotation.y = r.heading;

        for (const w of rig.wheels) {
          w.rotation.x = r.wheelAngle;
        }
        rig.cutterReel.rotation.x = r.cutterAngle;

        updateRoverVisualState(rig, r.state, r.battery, r.hopperFill);

        rig.batteryGroup.quaternion.copy(camera.quaternion);
        rig.batteryGroup.rotateY(-r.heading);

        rig.sensorCone.visible = conesVisible;
        rig.selectionRing.visible = activeSel === r.id;

        if (activeSel === r.id) {
          _targetFocus.set(r.x, 0.5, r.z);
          const prevTargetX = controls.target.x;
          const prevTargetZ = controls.target.z;
          controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetFocus.x, 6.5, rawDt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetFocus.y, 6.5, rawDt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetFocus.z, 6.5, rawDt);
          camera.position.x += controls.target.x - prevTargetX;
          camera.position.z += controls.target.z - prevTargetZ;
        }
      }

      // Update P2P Radio Beam Lines
      const beamCount = Math.min(maxBeams, snap.p2pBeams.length);
      for (let i = 0; i < beamCount; i++) {
        const b = snap.p2pBeams[i];
        const base = i * 6;
        beamPositions[base] = b.fromX;
        beamPositions[base + 1] = 0.85;
        beamPositions[base + 2] = b.fromZ;
        beamPositions[base + 3] = b.toX;
        beamPositions[base + 4] = 0.85;
        beamPositions[base + 5] = b.toZ;

        let cr = 0.22, cg = 0.74, cb = 0.97;
        if (b.kind === 'OBSTACLE') {
          cr = 0.97; cg = 0.25; cb = 0.35;
        } else if (b.kind === 'RESCUE') {
          cr = 0.98; cg = 0.75; cb = 0.14;
        }
        beamColors[base] = cr; beamColors[base + 1] = cg; beamColors[base + 2] = cb;
        beamColors[base + 3] = cr; beamColors[base + 4] = cg; beamColors[base + 5] = cb;
      }
      beamGeo.attributes.position.needsUpdate = true;
      beamGeo.attributes.color.needsUpdate = true;
      beamGeo.setDrawRange(0, beamCount * 2);

      if (cameraResetBtnRef.current && !activeSel) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, DEFAULT_CAM_POS.x, 5.5, rawDt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, DEFAULT_CAM_POS.y, 5.5, rawDt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, DEFAULT_CAM_POS.z, 5.5, rawDt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, DEFAULT_TARGET.x, 5.5, rawDt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, DEFAULT_TARGET.y, 5.5, rawDt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, DEFAULT_TARGET.z, 5.5, rawDt);
        if (camera.position.distanceTo(DEFAULT_CAM_POS) < 0.08) {
          cameraResetBtnRef.current = false;
        }
      }

      syncTractors(snap);
      syncObstacles(snap);
      controls.update();
      renderer.render(scene, camera);

      uiEmitAccum += rawDt;
      if (uiEmitAccum >= 0.1) {
        uiEmitAccum = 0;
        onSnapshotRef.current(snap);
      }

      if (isSoftwareGl) {
        afterDraw(() => tick());
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      renderer.render(scene, camera);
      afterDraw(() => tick());
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();
      envTex.dispose();
      groundTex.dispose();
      solarTex.dispose();
      barnTex.dispose();
      beamGeo.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [engine]);

  const selectedRobot: RobotTelemetry | undefined = selectedRobotId
    ? snapshot.robots.find((r) => r.id === selectedRobotId)
    : undefined;

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 p-6 text-center">
          <div className="max-w-md border border-slate-700 bg-slate-950 p-6 rounded-xl">
            <h2 className="text-base font-semibold text-slate-100">3D Viewport Unavailable</h2>
            <p className="mt-2 text-sm text-slate-400">{webglError}</p>
          </div>
        </div>
      )}

      {/* Click-on-Robot Floating Information Inspector */}
      {selectedRobot && (
        <div className="absolute top-3 left-3 z-10 w-80 rounded-xl bg-slate-950/94 border border-slate-700/80 shadow-xl p-3.5 text-xs text-slate-100">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-sm text-sky-400">{selectedRobot.id}</span>
              <span className="text-slate-300 font-medium">{selectedRobot.label}</span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-slate-300">{selectedRobot.speedMs.toFixed(2)} m/s</span>
            </div>
            <button
              type="button"
              onClick={() => onSelectRobot(null)}
              aria-label="Close robot inspector"
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-y-2 gap-x-3 font-mono text-[11px]">
            <div>
              <div className="text-slate-400 font-sans">Status</div>
              <div className="text-emerald-400 font-semibold">{selectedRobot.state}</div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">Battery / Hopper</div>
              <div className="text-slate-100 tabular-nums">
                {selectedRobot.battery.toFixed(1)}% · {Math.round(selectedRobot.hopperFill * 100)}%
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">Latitude (WGS84)</div>
              <div className="text-slate-200 tabular-nums">{selectedRobot.latitude.toFixed(6)}°</div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">Longitude (WGS84)</div>
              <div className="text-slate-200 tabular-nums">{selectedRobot.longitude.toFixed(6)}°</div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">Active Zone / Crops</div>
              <div className="text-slate-200 tabular-nums">
                Zone {selectedRobot.activeZone} · {selectedRobot.harvestedCount} cut
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-sans">P2P Peers in Mesh</div>
              <div className="text-sky-300 truncate">
                {selectedRobot.connectedPeers.length > 0
                  ? selectedRobot.connectedPeers.join(', ')
                  : 'Scanning...'}
              </div>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-start gap-1.5 text-[11px] text-slate-300">
            <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <span className="font-mono leading-snug">{selectedRobot.lastComms}</span>
          </div>
        </div>
      )}

      {/* Bottom-Center Camera & Sensor Controls */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 max-w-[94%]">
        <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/92 border border-slate-700/80 shadow-lg text-xs text-slate-200 whitespace-nowrap">
          <button
            type="button"
            onClick={handleResetViewClick}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
            <span>Reset 3D View</span>
          </button>

          <button
            type="button"
            onClick={onToggleSensorCones}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              showSensorCones
                ? 'bg-sky-600/25 text-sky-300 border border-sky-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            {showSensorCones ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>Sensor Cones</span>
          </button>

          {selectedRobotId ? (
            <button
              type="button"
              onClick={() => onSelectRobot(null)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-300 hover:bg-amber-500/30 font-medium transition-colors cursor-pointer"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span>Following {selectedRobotId} · Unlock</span>
            </button>
          ) : (
            <span className="hidden xl:inline-flex items-center gap-1.5 pl-1 text-slate-400">
              <Compass className="w-3.5 h-3.5 text-slate-400" />
              <span>Orbit · Zoom · Pan · Click Rover for Telemetry</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
