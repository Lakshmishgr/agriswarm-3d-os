import * as THREE from 'three';

export function createFarmGroundTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  // Ground plane is 140m x 140m
  const pxPerMeter = size / 140;
  const toPxX = (x: number) => cx + x * pxPerMeter;
  const toPxZ = (z: number) => cy + z * pxPerMeter;

  // 1. Lush surrounding pasture & agricultural meadow
  ctx.fillStyle = '#4c7a36';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 7000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const w = 3 + Math.random() * 8;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(95, 142, 64, 0.24)' : 'rgba(48, 86, 33, 0.22)';
    ctx.fillRect(x, y, w, w);
  }

  // Subtle distant neighboring field patchwork outside fence for realism
  ctx.fillStyle = 'rgba(116, 134, 62, 0.22)';
  ctx.fillRect(0, 0, toPxX(-22), toPxZ(-16));
  ctx.fillStyle = 'rgba(72, 108, 48, 0.25)';
  ctx.fillRect(toPxX(22), toPxZ(-18), size - toPxX(22), toPxZ(20));

  // 2. Rectangular compacted gravel perimeter road & headland lanes
  const roadX1 = toPxX(-20.2);
  const roadZ1 = toPxZ(-14.4);
  const roadW = 40.4 * pxPerMeter;
  const roadH = 32.4 * pxPerMeter;
  ctx.fillStyle = '#6f5c46';
  ctx.fillRect(roadX1, roadZ1, roadW, roadH);

  // Subtle gravel texture dots on headland
  for (let i = 0; i < 2200; i++) {
    const gx = roadX1 + Math.random() * roadW;
    const gy = roadZ1 + Math.random() * roadH;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(180,165,140,0.16)' : 'rgba(45,35,24,0.16)';
    ctx.fillRect(gx, gy, 2, 2);
  }

  // 3. Three rectangular cultivated plowed loamy soil plots
  const zones: Array<[number, number]> = [
    [-17.1, -6.2],
    [-5.0, 5.0],
    [6.2, 17.1],
  ];

  for (const [xMin, xMax] of zones) {
    const pxX = toPxX(xMin);
    const pxZ = toPxZ(-11.6);
    const w = (xMax - xMin) * pxPerMeter;
    const h = 23.2 * pxPerMeter;

    ctx.fillStyle = '#47301c';
    ctx.fillRect(pxX, pxZ, w, h);

    // Straight North-South plowed furrows
    for (let x = xMin + 0.25; x < xMax - 0.1; x += 0.48) {
      const fx = toPxX(x);
      ctx.strokeStyle =
        Math.round(x * 10) % 2 === 0 ? 'rgba(26, 15, 7, 0.45)' : 'rgba(108, 76, 46, 0.28)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(fx, pxZ);
      ctx.lineTo(fx, pxZ + h);
      ctx.stroke();
    }

    // Crisp plot border edge
    ctx.strokeStyle = 'rgba(218, 190, 140, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pxX, pxZ, w, h);
  }

  // 4. Concrete Solar Charging Depot & Battery Vehicle Apron (South)
  const apronX = toPxX(-14.8);
  const apronZ = toPxZ(14.5);
  const apronW = 23.8 * pxPerMeter;
  const apronH = 3.4 * pxPerMeter;
  ctx.fillStyle = '#64748b';
  ctx.fillRect(apronX, apronZ, apronW, apronH);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.strokeRect(apronX, apronZ, apronW, apronH);

  // Bay parking lane markings
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.4;
  for (const bx of [-8, -4, 0, 4, 8]) {
    ctx.beginPath();
    ctx.moveTo(toPxX(bx), toPxZ(14.6));
    ctx.lineTo(toPxX(bx), toPxZ(17.7));
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createSolarPanelTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0f2854';
  ctx.fillRect(0, 0, size, size);

  const cols = 8;
  const rows = 8;
  const cellW = size / cols;
  const cellH = size / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW;
      const y = r * cellH;
      const grad = ctx.createLinearGradient(x, y, x + cellW, y + cellH);
      grad.addColorStop(0, '#173f82');
      grad.addColorStop(1, '#0d2247');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 3, y + 3, cellW - 6, cellH - 6);

      ctx.strokeStyle = 'rgba(186, 214, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + cellW * 0.33, y + 3);
      ctx.lineTo(x + cellW * 0.33, y + cellH - 3);
      ctx.moveTo(x + cellW * 0.66, y + 3);
      ctx.lineTo(x + cellW * 0.66, y + cellH - 3);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  for (let i = 0; i <= cols; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellW, 0);
    ctx.lineTo(i * cellW, size);
    ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    ctx.beginPath();
    ctx.moveTo(0, j * cellH);
    ctx.lineTo(size, j * cellH);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createBarnWallTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#99241e';
  ctx.fillRect(0, 0, size, size);

  for (let x = 0; x < size; x += 16) {
    ctx.fillStyle = x % 32 === 0 ? 'rgba(60, 10, 8, 0.25)' : 'rgba(220, 90, 75, 0.08)';
    ctx.fillRect(x, 0, 2, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}
