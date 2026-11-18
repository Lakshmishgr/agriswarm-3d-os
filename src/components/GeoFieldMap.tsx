import { useEffect, useRef, useState } from 'react';
import { Globe, Layers, Maximize2, Minimize2 } from 'lucide-react';
import { GEO_SITES, HEADLAND_E, HEADLAND_N, HEADLAND_W, DEPOT_Z } from '../simulation/SwarmEngine';
import type { SwarmSnapshot } from '../types/swarm';

interface GeoFieldMapProps {
  snapshot: SwarmSnapshot;
  selectedRobotId: string | null;
  onSelectRobot: (id: string) => void;
  onChangeGeoSite: (siteId: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}

// Convert lat/lon to Web Mercator Slippy Tile X/Y at zoom Z
function latLonToTile(lat: number, lon: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const xFloat = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return {
    xTile: Math.floor(xFloat),
    yTile: Math.floor(yFloat),
    fracX: xFloat - Math.floor(xFloat),
    fracY: yFloat - Math.floor(yFloat),
  };
}

export default function GeoFieldMap({
  snapshot,
  selectedRobotId,
  onSelectRobot,
  onChangeGeoSite,
  expanded,
  onToggleExpand,
}: GeoFieldMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [useSatelliteTiles, setUseSatelliteTiles] = useState<boolean>(true);
  const [tileStatus, setTileStatus] = useState<'loading' | 'live' | 'offline'>('loading');
  const tileImgRef = useRef<HTMLImageElement | null>(null);

  // Load real-world Esri World Imagery / OSM tile centered on current geoSite
  useEffect(() => {
    if (!useSatelliteTiles) {
      tileImgRef.current = null;
      return;
    }
    setTileStatus('loading');
    const zoom = 18;
    const { xTile, yTile } = latLonToTile(snapshot.geoSite.lat, snapshot.geoSite.lon, zoom);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      tileImgRef.current = img;
      setTileStatus('live');
    };
    img.onerror = () => {
      tileImgRef.current = null;
      setTileStatus('offline');
    };
    img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${yTile}/${xTile}`;
  }, [snapshot.geoSite.id, snapshot.geoSite.lat, snapshot.geoSite.lon, useSatelliteTiles]);

  // Render real-time georeferenced telemetry overlay onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 1. Background layer: Real Satellite Tile OR Crisp GIS Orthophoto Terrain
    if (useSatelliteTiles && tileImgRef.current) {
      ctx.drawImage(tileImgRef.current, 0, 0, w, h);
      ctx.fillStyle = 'rgba(11, 17, 32, 0.36)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#1b2e1e';
      ctx.fillRect(0, 0, w, h);
      // Topographic contour / aerial parcel shading
      ctx.strokeStyle = 'rgba(134, 239, 172, 0.08)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 32) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += 32) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
    }

    // Coordinate mapping: scene X [-22..+22], Z [-16..+20] -> canvas
    const minX = -22;
    const maxX = 22;
    const minZ = -16;
    const maxZ = 20;
    const pad = 18;
    const toCanvasX = (x: number) => pad + ((x - minX) / (maxX - minX)) * (w - pad * 2);
    const toCanvasY = (z: number) => pad + ((z - minZ) / (maxZ - minZ)) * (h - pad * 2);

    // 2. Rectangular Parcel Geofence
    const rx1 = toCanvasX(HEADLAND_W - 0.8);
    const ry1 = toCanvasY(HEADLAND_N - 0.8);
    const rw = toCanvasX(HEADLAND_E + 0.8) - rx1;
    const rh = toCanvasY(DEPOT_Z + 1.4) - ry1;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx1, ry1, rw, rh);
    ctx.setLineDash([]);

    // 3. Three Rectangular Cultivated Zones
    const zoneRects: Array<{ x1: number; x2: number; color: string; label: string }> = [
      { x1: -17.0, x2: -6.2, color: 'rgba(250, 204, 21, 0.16)', label: 'Z1 Wheat' },
      { x1: -5.0, x2: 5.0, color: 'rgba(34, 197, 94, 0.16)', label: 'Z2 Corn' },
      { x1: 6.2, x2: 17.0, color: 'rgba(249, 115, 22, 0.16)', label: 'Z3 Sunfl.' },
    ];
    for (const zr of zoneRects) {
      const zx = toCanvasX(zr.x1);
      const zy = toCanvasY(-11.5);
      const zw = toCanvasX(zr.x2) - zx;
      const zh = toCanvasY(11.5) - zy;
      ctx.fillStyle = zr.color;
      ctx.fillRect(zx, zy, zw, zh);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(zx, zy, zw, zh);

      ctx.fillStyle = 'rgba(241,245,249,0.72)';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(zr.label, zx + 4, zy + 12);
    }

    // 4. Solar Charging Bays along South Apron
    for (const bay of snapshot.bays) {
      const bx = toCanvasX(bay.x);
      const by = toCanvasY(bay.z);
      ctx.fillStyle = bay.occupiedBy ? '#f59e0b' : bay.reservedBy ? '#38bdf8' : '#10b981';
      ctx.fillRect(bx - 6, by - 5, 12, 10);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 6, by - 5, 12, 10);
    }

    // 5. Shared Obstacle Hazards (broadcast via P2P)
    for (const hz of snapshot.sharedHazards) {
      const hx = toCanvasX(hz.x);
      const hy = toCanvasY(hz.z);
      ctx.beginPath();
      ctx.arc(hx, hy, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Static obstacles
    for (const obs of snapshot.obstacles) {
      const ox = toCanvasX(obs.x);
      const oy = toCanvasY(obs.z);
      ctx.fillStyle = '#f87171';
      ctx.fillRect(ox - 3, oy - 3, 6, 6);
    }

    // Moving Tractors
    for (const t of snapshot.tractors) {
      const tx = toCanvasX(t.x);
      const ty = toCanvasY(t.z);
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 6. Active P2P Communication Links
    for (const beam of snapshot.p2pBeams) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(beam.fromX), toCanvasY(beam.fromZ));
      ctx.lineTo(toCanvasX(beam.toX), toCanvasY(beam.toZ));
      ctx.strokeStyle =
        beam.kind === 'OBSTACLE'
          ? 'rgba(244, 63, 94, 0.85)'
          : beam.kind === 'RESCUE'
          ? 'rgba(251, 191, 36, 0.9)'
          : 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    // 7. Mobile Battery Vehicle BAT-01
    const bv = snapshot.batteryVehicle;
    const bvx = toCanvasX(bv.x);
    const bvy = toCanvasY(bv.z);
    ctx.fillStyle = bv.mode === 'STANDBY' ? '#0284c7' : '#fbbf24';
    ctx.fillRect(bvx - 6, bvy - 6, 12, 12);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bvx - 6, bvy - 6, 12, 12);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.fillText('BAT', bvx - 9, bvy - 9);

    // 8. Robot GPS Trails & Live Pins
    for (const r of snapshot.robots) {
      if (r.gpsTrail.length > 1) {
        ctx.beginPath();
        r.gpsTrail.forEach((pt, idx) => {
          const px = toCanvasX(pt.x);
          const py = toCanvasY(pt.z);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = selectedRobotId === r.id ? 'rgba(56, 189, 248, 0.9)' : 'rgba(250, 204, 21, 0.42)';
        ctx.lineWidth = selectedRobotId === r.id ? 2 : 1.2;
        ctx.stroke();
      }

      const rx = toCanvasX(r.x);
      const ry = toCanvasY(r.z);
      const isSel = selectedRobotId === r.id;

      ctx.beginPath();
      ctx.arc(rx, ry, isSel ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle =
        r.state === 'DODGING'
          ? '#f43f5e'
          : r.state === 'CHARGING' || r.state === 'RESCUE_CHARGE'
          ? '#fbbf24'
          : '#22c55e';
      ctx.fill();
      ctx.strokeStyle = isSel ? '#38bdf8' : '#0f172a';
      ctx.lineWidth = isSel ? 2.5 : 1.4;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillText(r.id, rx + 8, ry + 3);
    }

    // WGS84 Coordinate Overlay Stamp
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(8, h - 24, w - 16, 18);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillText(
      `WGS84 ${snapshot.geoSite.lat.toFixed(4)}°, ${snapshot.geoSite.lon.toFixed(4)}° · ${
        useSatelliteTiles && tileStatus === 'live' ? 'Satellite Imagery' : 'GIS Parcel Grid'
      }`,
      14,
      h - 11
    );
  }, [snapshot, selectedRobotId, useSatelliteTiles, tileStatus]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const minX = -22;
    const maxX = 22;
    const minZ = -16;
    const maxZ = 20;
    const pad = 18;
    const toCanvasX = (x: number) => pad + ((x - minX) / (maxX - minX)) * (canvas.width - pad * 2);
    const toCanvasY = (z: number) => pad + ((z - minZ) / (maxZ - minZ)) * (canvas.height - pad * 2);

    let closestId: string | null = null;
    let bestDist = 18;
    for (const r of snapshot.robots) {
      const rx = toCanvasX(r.x);
      const ry = toCanvasY(r.z);
      const d = Math.hypot(cx - rx, cy - ry);
      if (d < bestDist) {
        bestDist = d;
        closestId = r.id;
      }
    }
    if (closestId) {
      onSelectRobot(closestId);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Globe className="w-3.5 h-3.5 text-sky-400" />
          <span>Geo-Satellite Field Map</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setUseSatelliteTiles((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 cursor-pointer"
          >
            <Layers className="w-3 h-3 text-emerald-400" />
            <span>{useSatelliteTiles ? 'Satellite' : 'GIS Grid'}</span>
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 cursor-pointer"
          >
            {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span>{expanded ? 'Dock' : 'Expand'}</span>
          </button>
        </div>
      </div>

      <select
        aria-label="Select real-world geo farm site"
        value={snapshot.geoSite.id}
        onChange={(e) => onChangeGeoSite(e.target.value)}
        className="w-full px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-700 text-xs text-slate-200 font-medium focus:outline-none focus:border-sky-500"
      >
        {GEO_SITES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.region})
          </option>
        ))}
      </select>

      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
        <canvas
          ref={canvasRef}
          width={expanded ? 640 : 370}
          height={expanded ? 420 : 210}
          onClick={handleCanvasClick}
          className="w-full h-auto block cursor-crosshair"
        />
      </div>
    </div>
  );
}
