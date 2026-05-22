import { NextRequest, NextResponse } from "next/server";
import Jimp from "jimp";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Orientation type ─────────────────────────────────────────────────────────
type Orientation = "portrait" | "landscape";

interface PlotterSettings {
  z_draw: number;
  z_hop: number;
  feed_draw: number;
  feed_travel: number;
  canvas_x: number;
  canvas_y: number;
  offset_x: number;
  offset_y: number;
  detail_level: number;
}

type Point = [number, number];
type Stroke = Point[];
type DrawingMode = "single" | "multi" | "shading";

// ─── Gaussian blur (5×5) ─────────────────────────────────────────────────────
// Larger kernel for better noise reduction before thresholding
function gaussianBlur5(gray: Float32Array, w: number, h: number): Float32Array {
  // 5×5 Gaussian kernel (sigma≈1.0)
  const k = [
    1, 4,  7,  4,  1,
    4, 16, 26, 16, 4,
    7, 26, 41, 26, 7,
    4, 16, 26, 16, 4,
    1, 4,  7,  4,  1,
  ];
  const kSum = k.reduce((a, b) => a + b, 0); // 273
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, ki = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = Math.max(0, Math.min(w-1, x+dx));
          const ny = Math.max(0, Math.min(h-1, y+dy));
          sum += gray[ny*w+nx] * k[ki++];
        }
      }
      out[y*w+x] = sum / kSum;
    }
  }
  return out;
}

// ─── Gaussian blur (3×3) ─────────────────────────────────────────────────────
function gaussianBlur3(gray: Float32Array, w: number, h: number): Float32Array {
  const k = [1,2,1, 2,4,2, 1,2,1];
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, wt = 0, ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.max(0, Math.min(w-1, x+dx));
          const ny = Math.max(0, Math.min(h-1, y+dy));
          sum += gray[ny*w+nx] * k[ki]; wt += k[ki++];
        }
      }
      out[y*w+x] = sum / wt;
    }
  }
  return out;
}

// ─── Zhang-Suen skeletonize ───────────────────────────────────────────────────
function skeletonize(bin: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(bin);
  const del = new Uint8Array(w * h);
  const p = (x: number, y: number) => x>=0&&x<w&&y>=0&&y<h ? img[y*w+x] : 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let sub = 0; sub < 2; sub++) {
      del.fill(0);
      for (let y = 1; y < h-1; y++) {
        for (let x = 1; x < w-1; x++) {
          if (!img[y*w+x]) continue;
          const p2=p(x,y-1),p3=p(x+1,y-1),p4=p(x+1,y),p5=p(x+1,y+1);
          const p6=p(x,y+1),p7=p(x-1,y+1),p8=p(x-1,y),p9=p(x-1,y-1);
          const B=p2+p3+p4+p5+p6+p7+p8+p9;
          if (B<2||B>6) continue;
          const ring=[p2,p3,p4,p5,p6,p7,p8,p9];
          let A=0; for(let i=0;i<8;i++) if(!ring[i]&&ring[(i+1)%8]) A++;
          if (A!==1) continue;
          if (sub===0) { if(p2*p4*p6!==0||p4*p6*p8!==0) continue; }
          else         { if(p2*p4*p8!==0||p2*p6*p8!==0) continue; }
          del[y*w+x]=1;
        }
      }
      for (let i=0;i<del.length;i++) if(del[i]){img[i]=0;changed=true;}
    }
  }
  return img;
}

// ─── Canny Edge Detector (full implementation) ───────────────────────────────
// Industry-standard edge detection: Gaussian blur → Sobel gradients →
// Non-maximum suppression → Hysteresis thresholding.
// Produces clean, thin, single-pixel edges — far superior to threshold+skeletonize
// for fine-liner pen plotting because:
//   1. Edges are already 1px thin (no skeletonization artifacts)
//   2. Non-max suppression follows gradient direction → smooth curves
//   3. Hysteresis connects weak edges to strong ones → no broken lines
//   4. Works on grey-tone sketches AND clean line art
function cannyEdges(
  gray: Float32Array, w: number, h: number,
  lowThresh: number, highThresh: number
): Uint8Array {
  // Step 1: Gaussian blur to reduce noise (use existing 5×5)
  const blurred = gaussianBlur5(gray, w, h);

  // Step 2: Sobel gradients
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = blurred[(y-1)*w+(x-1)], tc = blurred[(y-1)*w+x], tr = blurred[(y-1)*w+(x+1)];
      const ml = blurred[y*w+(x-1)],                               mr = blurred[y*w+(x+1)];
      const bl = blurred[(y+1)*w+(x-1)], bc = blurred[(y+1)*w+x], br = blurred[(y+1)*w+(x+1)];

      const gxv = -tl - 2*ml - bl + tr + 2*mr + br;
      const gyv = -tl - 2*tc - tr + bl + 2*bc + br;

      gx[y*w+x] = gxv;
      gy[y*w+x] = gyv;
      mag[y*w+x] = Math.sqrt(gxv*gxv + gyv*gyv);
    }
  }

  // Step 3: Non-maximum suppression
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const m = mag[y*w+x];
      if (m === 0) continue;

      const angle = Math.atan2(gy[y*w+x], gx[y*w+x]) * 180 / Math.PI;
      const a = ((angle % 180) + 180) % 180;

      let m1: number, m2: number;
      if (a < 22.5 || a >= 157.5) {
        m1 = mag[y*w+(x-1)]; m2 = mag[y*w+(x+1)];
      } else if (a < 67.5) {
        m1 = mag[(y-1)*w+(x+1)]; m2 = mag[(y+1)*w+(x-1)];
      } else if (a < 112.5) {
        m1 = mag[(y-1)*w+x]; m2 = mag[(y+1)*w+x];
      } else {
        m1 = mag[(y-1)*w+(x-1)]; m2 = mag[(y+1)*w+(x+1)];
      }

      if (m >= m1 && m >= m2) nms[y*w+x] = m;
    }
  }

  // Step 4: Hysteresis thresholding with extended BFS gap-closing
  const STRONG = 2, WEAK = 1;
  const edges = new Uint8Array(w * h);
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= highThresh) edges[i] = STRONG;
    else if (nms[i] >= lowThresh) edges[i] = WEAK;
  }

  // BFS to connect weak edges to strong edges
  const dirs8: Array<[number,number]> = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const queue: number[] = [];
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] === STRONG) queue.push(i);
  }
  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % w, y = Math.floor(idx / w);
    for (const [dx, dy] of dirs8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (edges[ni] === WEAK) {
        edges[ni] = STRONG;
        queue.push(ni);
      }
    }
  }

  const result = new Uint8Array(w * h);
  for (let i = 0; i < edges.length; i++) {
    result[i] = edges[i] === STRONG ? 1 : 0;
  }
  return result;
}

// ─── Multi-scale Canny with gap closing ──────────────────────────────────────
// Runs Canny at two sensitivity levels and combines results.
// Then closes small gaps (≤2px) using morphological dilation + re-skeletonize.
// This is the key fix for broken/gapped strokes in pencil sketches.
function cannyMultiScale(
  gray: Float32Array, w: number, h: number,
  detailLevel: number
): Uint8Array {
  // Compute gradient magnitude range for adaptive thresholding
  // Use a blurred version to avoid noise spikes
  const blurred = gaussianBlur5(gray, w, h);
  let maxMag = 0;
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const gxv = -blurred[(y-1)*w+(x-1)] - 2*blurred[y*w+(x-1)] - blurred[(y+1)*w+(x-1)]
                + blurred[(y-1)*w+(x+1)] + 2*blurred[y*w+(x+1)] + blurred[(y+1)*w+(x+1)];
      const gyv = -blurred[(y-1)*w+(x-1)] - 2*blurred[(y-1)*w+x] - blurred[(y-1)*w+(x+1)]
                + blurred[(y+1)*w+(x-1)] + 2*blurred[(y+1)*w+x] + blurred[(y+1)*w+(x+1)];
      const m = Math.sqrt(gxv*gxv + gyv*gyv);
      if (m > maxMag) maxMag = m;
    }
  }

  // Adaptive thresholds based on actual gradient range
  // detailLevel 10 = very sensitive (catches light pencil strokes)
  // detailLevel 1  = less sensitive (only strong edges)
  const sensitivity = detailLevel / 10; // 0.1 to 1.0
  const highThresh = maxMag * (0.15 - sensitivity * 0.08); // 7% to 15% of max
  const lowThresh  = highThresh * 0.35; // 35% of high = more weak edges connected

  // Run Canny at normal sensitivity
  const edges1 = cannyEdges(gray, w, h, lowThresh, highThresh);

  // Run Canny at higher sensitivity (catches light strokes missed by first pass)
  const edges2 = cannyEdges(gray, w, h, lowThresh * 0.5, highThresh * 0.6);

  // Combine: union of both edge maps
  const combined = new Uint8Array(w * h);
  for (let i = 0; i < combined.length; i++) {
    combined[i] = (edges1[i] || edges2[i]) ? 1 : 0;
  }

  // Gap closing: dilate by 1px then erode by 1px (morphological closing)
  // This bridges gaps of 1-2px in broken strokes
  const dilated = new Uint8Array(w * h);
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      if (combined[y*w+x] ||
          combined[(y-1)*w+x] || combined[(y+1)*w+x] ||
          combined[y*w+(x-1)] || combined[y*w+(x+1)] ||
          combined[(y-1)*w+(x-1)] || combined[(y-1)*w+(x+1)] ||
          combined[(y+1)*w+(x-1)] || combined[(y+1)*w+(x+1)]) {
        dilated[y*w+x] = 1;
      }
    }
  }

  // Re-thin using skeletonization to get back to 1px edges after dilation
  return skeletonize(dilated, w, h);
}

// ─── Chain Canny edges into strokes ──────────────────────────────────────────
// Canny produces thin 1px edges. This chains them into ordered polylines
// by following 8-connected neighbours with momentum (prefer straight direction).
// Much cleaner than skeletonize+trace because Canny edges are already thin.
function chainEdges(edges: Uint8Array, w: number, h: number, minLen: number): Stroke[] {
  const visited = new Uint8Array(w * h);
  const strokes: Stroke[] = [];
  const dirs8: Array<[number,number]> = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

  const get = (x: number, y: number) =>
    x >= 0 && x < w && y >= 0 && y < h ? edges[y * w + x] : 0;

  // Find endpoints (pixels with exactly 1 neighbour) — start tracing from these
  const starts: Point[] = [];
  const fallbacks: Point[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y*w+x]) continue;
      let n = 0;
      for (const [dx, dy] of dirs8) if (get(x+dx, y+dy)) n++;
      if (n <= 1) starts.push([x, y]);
      else fallbacks.push([x, y]);
    }
  }

  const traceFrom = (sx: number, sy: number) => {
    if (visited[sy*w+sx]) return;
    const stroke: Point[] = [];
    let cx = sx, cy = sy, pdx = 0, pdy = 0;
    while (true) {
      if (visited[cy*w+cx]) break;
      visited[cy*w+cx] = 1;
      stroke.push([cx, cy]);
      // Prefer direction that continues current heading (momentum = smoother strokes)
      let bx = -1, by = -1, bScore = -Infinity;
      for (const [dx, dy] of dirs8) {
        const nx = cx+dx, ny = cy+dy;
        if (!get(nx, ny) || visited[ny*w+nx]) continue;
        const score = (pdx === 0 && pdy === 0) ? 0 : pdx*dx + pdy*dy;
        if (score > bScore) { bScore = score; bx = nx; by = ny; }
      }
      if (bx < 0) break;
      pdx = bx-cx; pdy = by-cy; cx = bx; cy = by;
    }
    if (stroke.length >= minLen) strokes.push(stroke);
  };

  for (const [sx, sy] of starts) traceFrom(sx, sy);
  for (const [sx, sy] of fallbacks) traceFrom(sx, sy);

  return strokes;
}

// ─── Merge nearby stroke endpoints (gap bridging) ────────────────────────────
// After chaining, nearby stroke endpoints that are within `gapPx` pixels
// get connected. This fixes remaining gaps that gap-closing didn't catch.
function bridgeStrokeGaps(strokes: Stroke[], gapPx: number): Stroke[] {
  if (strokes.length <= 1) return strokes;
  const result = strokes.map(s => [...s]);
  const gapSq = gapPx * gapPx;

  let changed = true;
  let passes = 0;
  while (changed && passes < 5) {
    changed = false;
    passes++;
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i], b = result[j];
        if (!a.length || !b.length) continue;
        const aS = a[0], aE = a[a.length-1];
        const bS = b[0], bE = b[b.length-1];
        const d1 = (aE[0]-bS[0])**2 + (aE[1]-bS[1])**2; // a-end → b-start
        const d2 = (aE[0]-bE[0])**2 + (aE[1]-bE[1])**2; // a-end → b-end
        const d3 = (aS[0]-bS[0])**2 + (aS[1]-bS[1])**2; // a-start → b-start
        const d4 = (aS[0]-bE[0])**2 + (aS[1]-bE[1])**2; // a-start → b-end
        const minD = Math.min(d1, d2, d3, d4);
        if (minD > gapSq) continue;
        let merged: Stroke;
        if (minD === d1) merged = [...a, ...b];
        else if (minD === d2) merged = [...a, ...[...b].reverse()];
        else if (minD === d3) merged = [...[...b].reverse(), ...a];
        else merged = [...b, ...a];
        result[i] = merged;
        result.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return result.filter(s => s.length >= 2);
}


function traceContours(binary: Uint8Array, w: number, h: number, minLen: number): Stroke[] {
  const visited = new Uint8Array(w * h);
  const strokes: Stroke[] = [];

  // 8-connected dirs for flood fill
  const dirs4: Array<[number,number]> = [[1,0],[0,1],[-1,0],[0,-1]];
  const dirs8: Array<[number,number]> = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

  const get = (x: number, y: number) =>
    x >= 0 && x < w && y >= 0 && y < h ? binary[y * w + x] : 0;

  // Max points per stroke — prevents runaway on large filled blobs
  const MAX_PTS = 4000;

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      if (!binary[sy * w + sx] || visited[sy * w + sx]) continue;

      // BFS to collect all pixels in this connected component
      const component: Point[] = [];
      const queue: Point[] = [[sx, sy]];
      visited[sy * w + sx] = 1;

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        component.push([cx, cy]);
        for (const [dx, dy] of dirs4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h &&
              binary[ny * w + nx] && !visited[ny * w + nx]) {
            visited[ny * w + nx] = 1;
            queue.push([nx, ny]);
          }
        }
      }

      if (component.length < minLen) continue;

      // Find boundary pixels (pixels that have at least one background 4-neighbour)
      const boundary: Point[] = [];
      for (const [bx, by] of component) {
        let isBoundary = false;
        for (const [dx, dy] of dirs4) {
          if (!get(bx + dx, by + dy)) { isBoundary = true; break; }
        }
        if (isBoundary) boundary.push([bx, by]);
      }

      if (boundary.length < 2) {
        // Tiny filled blob — just use component center as a dot
        if (component.length >= minLen) {
          let cx = 0, cy = 0;
          for (const [px, py] of component) { cx += px; cy += py; }
          cx = Math.round(cx / component.length);
          cy = Math.round(cy / component.length);
          strokes.push([[cx, cy], [cx + 1, cy]]);
        }
        continue;
      }

      // Order boundary pixels into a coherent path using nearest-neighbour walk
      // Start from the topmost-leftmost boundary pixel
      boundary.sort((a, b) => a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]);

      const usedB = new Uint8Array(boundary.length);
      const stroke: Point[] = [];
      let curIdx = 0;
      usedB[0] = 1;
      stroke.push(boundary[0]);

      // Build a spatial index for fast nearest-neighbour lookup
      // Group by row for O(1) local search
      const byRow = new Map<number, number[]>();
      for (let i = 0; i < boundary.length; i++) {
        const row = boundary[i][1];
        if (!byRow.has(row)) byRow.set(row, []);
        byRow.get(row)!.push(i);
      }

      while (stroke.length < MAX_PTS) {
        const [cx, cy] = boundary[curIdx];
        let bestIdx = -1, bestDist = Infinity;

        // Search in nearby rows (±2) for closest unused boundary pixel
        for (let dy = -2; dy <= 2; dy++) {
          const row = cy + dy;
          const rowPts = byRow.get(row);
          if (!rowPts) continue;
          for (const idx of rowPts) {
            if (usedB[idx]) continue;
            const [nx, ny] = boundary[idx];
            const d = (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy);
            if (d < bestDist) { bestDist = d; bestIdx = idx; }
          }
        }

        // If no close neighbour found (gap > 4px), stop this stroke
        if (bestIdx < 0 || bestDist > 16) break;

        usedB[bestIdx] = 1;
        curIdx = bestIdx;
        stroke.push(boundary[bestIdx]);
      }

      if (stroke.length >= minLen) {
        strokes.push(stroke);
      }

      // If there are remaining unused boundary pixels (disconnected parts), add them too
      const remaining: Point[] = [];
      for (let i = 0; i < boundary.length; i++) {
        if (!usedB[i]) remaining.push(boundary[i]);
      }
      if (remaining.length >= minLen) {
        strokes.push(remaining);
      }
    }
  }
  return strokes;
}

// ─── Measure stroke width at each skeleton pixel ─────────────────────────────
// For each skeleton pixel, measures how wide the original binary stroke is
// by casting rays perpendicular to the stroke direction.
// Returns a map of width values (in pixels) for each skeleton pixel.
function measureStrokeWidths(
  skeleton: Uint8Array,
  binary: Uint8Array,
  w: number, h: number
): Float32Array {
  const widths = new Float32Array(w * h);
  const dirs8: Point[] = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      if (!skeleton[y*w+x]) continue;

      // Find local stroke direction by looking at neighbours
      let dx = 0, dy = 0;
      for (const [ddx, ddy] of dirs8) {
        const nx = x+ddx, ny = y+ddy;
        if (nx>=0&&nx<w&&ny>=0&&ny<h&&skeleton[ny*w+nx]) {
          dx += ddx; dy += ddy;
        }
      }
      const len = Math.sqrt(dx*dx+dy*dy);
      if (len < 0.001) { widths[y*w+x] = 1; continue; }
      // Perpendicular direction
      const px = -dy/len, py = dx/len;

      // Cast ray in both perpendicular directions, count binary pixels
      let width = 1;
      for (const sign of [1, -1]) {
        for (let t = 1; t <= 8; t++) {
          const nx = Math.round(x + sign * px * t);
          const ny = Math.round(y + sign * py * t);
          if (nx<0||nx>=w||ny<0||ny>=h) break;
          if (!binary[ny*w+nx]) break;
          width++;
        }
      }
      widths[y*w+x] = width;
    }
  }
  return widths;
}

// ─── Compute local darkness map (0=white, 1=black) ───────────────────────────
// Returns a float map of how dark each region is (averaged over a window)
function computeDarknessMap(gray: Float32Array, w: number, h: number, winR: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -winR; dy <= winR; dy++) {
        for (let dx = -winR; dx <= winR; dx++) {
          const nx = Math.max(0, Math.min(w-1, x+dx));
          const ny = Math.max(0, Math.min(h-1, y+dy));
          sum += gray[ny*w+nx]; cnt++;
        }
      }
      // Invert: 0=white(255), 1=black(0)
      out[y*w+x] = 1 - (sum/cnt) / 255;
    }
  }
  return out;
}

// ─── Trace strokes from skeleton ─────────────────────────────────────────────
function traceStrokes(skel: Uint8Array, w: number, h: number, minLen: number): Stroke[] {
  const visited = new Uint8Array(w * h);
  const strokes: Stroke[] = [];
  const dirs8: Point[] = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const get = (x: number, y: number) => x>=0&&x<w&&y>=0&&y<h ? skel[y*w+x] : 0;

  // Classify each skeleton pixel: count 8-neighbours
  // Endpoint: 0 or 1 neighbour — start tracing from here first
  // Junction: 3+ neighbours — branch point
  const starts: Point[] = [];
  const fallbacks: Point[] = [];
  for (let y=0;y<h;y++) {
    for (let x=0;x<w;x++) {
      if (!skel[y*w+x]) continue;
      let n=0;
      for(const [dx,dy] of dirs8) if(get(x+dx,y+dy)) n++;
      if (n<=1) starts.push([x,y]);       // endpoint — trace from here
      else fallbacks.push([x,y]);          // interior — only trace if not yet visited
    }
  }

  const traceFrom = (sx: number, sy: number) => {
    if (visited[sy*w+sx]) return;
    const stroke: Point[] = [];
    let cx=sx, cy=sy, pdx=0, pdy=0;
    while (true) {
      if (visited[cy*w+cx]) break;
      visited[cy*w+cx]=1;
      stroke.push([cx,cy]);
      // Prefer direction that continues the current heading (momentum)
      let bx=-1,by=-1,bScore=-Infinity;
      for (const [dx,dy] of dirs8) {
        const nx=cx+dx,ny=cy+dy;
        if (!get(nx,ny)||visited[ny*w+nx]) continue;
        // Score = dot product with previous direction (prefer straight lines)
        const score = (pdx===0&&pdy===0) ? 0 : pdx*dx+pdy*dy;
        if (score>bScore){bScore=score;bx=nx;by=ny;}
      }
      if (bx<0) break;
      pdx=bx-cx; pdy=by-cy; cx=bx; cy=by;
    }
    if (stroke.length>=minLen) strokes.push(stroke);
  };

  // First pass: trace from endpoints (gives longest, most coherent strokes)
  for (const [sx,sy] of starts) traceFrom(sx, sy);
  // Second pass: pick up any unvisited interior pixels (isolated loops etc.)
  for (const [sx,sy] of fallbacks) traceFrom(sx, sy);

  return strokes;
}

// ─── Douglas-Peucker simplification ──────────────────────────────────────────
function simplify(pts: Point[], eps: number): Point[] {
  if (pts.length<=2) return pts;
  const [x1,y1]=pts[0],[x2,y2]=pts[pts.length-1];
  const len=Math.sqrt((x2-x1)**2+(y2-y1)**2);
  let maxD=0,maxI=0;
  for (let i=1;i<pts.length-1;i++) {
    const [px,py]=pts[i];
    const d=len<0.001?Math.sqrt((px-x1)**2+(py-y1)**2):Math.abs((y2-y1)*px-(x2-x1)*py+x2*y1-y2*x1)/len;
    if(d>maxD){maxD=d;maxI=i;}
  }
  if (maxD>eps) {
    const L=simplify(pts.slice(0,maxI+1),eps);
    const R=simplify(pts.slice(maxI),eps);
    return [...L.slice(0,-1),...R];
  }
  return [pts[0],pts[pts.length-1]];
}

// ─── Generate parallel offset strokes for line weight ────────────────────────
// Uses ACTUAL measured stroke width to determine number of passes.
// A 1px wide stroke = 1 pass. A 4px wide stroke = 3-4 passes.
// This correctly handles asymmetric features like one thick eyebrow.
function generateWeightedStrokes(
  stroke: Stroke,
  avgWidth: number,  // average stroke width in pixels
  maxPasses: number, // from strokeWeight setting (1-5)
  spacingPx: number  // spacing between parallel passes in pixels
): Stroke[] {
  // Map pixel width to number of passes
  // width 1-2px: 1 pass (thin lines)
  // width 3-4px: 2 passes
  // width 5-6px: 3 passes
  // width 7+px: up to maxPasses
  const naturalPasses = Math.max(1, Math.min(maxPasses, Math.round(avgWidth / 2)));
  const passes = Math.min(naturalPasses, maxPasses);

  if (passes <= 1) return [stroke];

  const result: Stroke[] = [stroke];
  for (let p = 1; p < passes; p++) {
    const offset = (p % 2 === 1 ? 1 : -1) * Math.ceil(p / 2) * spacingPx;
    const offsetStroke: Stroke = [];
    for (let i = 0; i < stroke.length; i++) {
      const [x, y] = stroke[i];
      let nx = 0, ny = 1;
      if (i < stroke.length - 1) {
        const [x2, y2] = stroke[i + 1];
        const ddx = x2-x, ddy = y2-y;
        const l = Math.sqrt(ddx*ddx+ddy*ddy);
        if (l > 0) { nx = -ddy/l; ny = ddx/l; }
      } else if (i > 0) {
        const [x0, y0] = stroke[i - 1];
        const ddx = x-x0, ddy = y-y0;
        const l = Math.sqrt(ddx*ddx+ddy*ddy);
        if (l > 0) { nx = -ddy/l; ny = ddx/l; }
      }
      offsetStroke.push([x + nx * offset, y + ny * offset]);
    }
    result.push(offsetStroke);
  }
  return result;
}

// ─── Detect small filled blobs (bindi, dots, small marks) ───────────────────
// Very strict: only detects genuinely isolated circular blobs (like a bindi dot).
// Will NOT trigger on hair texture, hatching, or any connected strokes.
function detectSmallBlobs(
  binary: Uint8Array, gray: Float32Array, w: number, h: number,
  minSize: number, maxSize: number
): Stroke[] {
  const visited = new Uint8Array(w * h);
  const strokes: Stroke[] = [];
  const dirs4: Point[] = [[1,0],[0,1],[-1,0],[0,-1]];
  const dirs8: Point[] = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  for (let y = 3; y < h-3; y++) {
    for (let x = 3; x < w-3; x++) {
      if (!binary[y*w+x] || visited[y*w+x]) continue;

      // BFS to find connected component
      const blob: Point[] = [];
      const queue: Point[] = [[x, y]];
      visited[y*w+x] = 1;
      while (queue.length) {
        const [cx, cy] = queue.shift()!;
        blob.push([cx, cy]);
        for (const [dx, dy] of dirs4) {
          const nx = cx+dx, ny = cy+dy;
          if (nx>=0&&nx<w&&ny>=0&&ny<h&&binary[ny*w+nx]&&!visited[ny*w+nx]) {
            visited[ny*w+nx] = 1;
            queue.push([nx, ny]);
          }
        }
      }

      // Size filter — only small isolated blobs
      if (blob.length < minSize || blob.length > maxSize) continue;

      // Bounding box
      let minX = w, maxX = 0, minY = h, maxY = 0;
      for (const [bx, by] of blob) {
        minX = Math.min(minX, bx); maxX = Math.max(maxX, bx);
        minY = Math.min(minY, by); maxY = Math.max(maxY, by);
      }
      const bboxW = maxX - minX + 1;
      const bboxH = maxY - minY + 1;

      // Aspect ratio: must be roughly square (not a line fragment)
      const aspectRatio = Math.max(bboxW, bboxH) / Math.max(1, Math.min(bboxW, bboxH));
      if (aspectRatio > 2.5) continue; // too elongated — it's a stroke fragment, not a dot

      // Compactness check: a circle has compactness = 4π*area/perimeter²
      let perimeter = 0;
      for (const [bx, by] of blob) {
        for (const [dx, dy] of dirs8) {
          const nx = bx+dx, ny = by+dy;
          if (nx<0||nx>=w||ny<0||ny>=h||!binary[ny*w+nx]) { perimeter++; break; }
        }
      }
      const compactness = (4 * Math.PI * blob.length) / (perimeter * perimeter);
      // Only accept very circular blobs (compactness > 0.6)
      if (compactness < 0.6) continue;

      // Darkness check: must be genuinely dark ink
      let totalGray = 0;
      for (const [bx, by] of blob) totalGray += gray[by*w+bx];
      const avgGray = totalGray / blob.length;
      if (avgGray > 160) continue; // too light — skip

      // STRICT isolation check: must have a clear white border of 4px around it
      // This prevents hair texture from being detected as blobs
      let surroundingInk = 0;
      const border = 4;
      for (let sy = Math.max(0, minY-border); sy <= Math.min(h-1, maxY+border); sy++) {
        for (let sx = Math.max(0, minX-border); sx <= Math.min(w-1, maxX+border); sx++) {
          if (sy >= minY && sy <= maxY && sx >= minX && sx <= maxX) continue;
          if (binary[sy*w+sx]) surroundingInk++;
        }
      }
      const surroundArea = (bboxW + 2*border) * (bboxH + 2*border) - bboxW * bboxH;
      // Must be at least 85% white space around it — very strict isolation
      if (surroundingInk > surroundArea * 0.15) continue;

      // This is a genuine isolated circular blob — draw it as concentric circles
      let cx = 0, cy = 0;
      for (const [bx, by] of blob) { cx += bx; cy += by; }
      cx = Math.round(cx / blob.length);
      cy = Math.round(cy / blob.length);
      const r = Math.sqrt(blob.length / Math.PI);

      const blobStrokes: Stroke[] = [];
      const numRings = Math.max(1, Math.round(r));
      for (let ring = numRings; ring >= 1; ring--) {
        const ringR = ring * (r / numRings);
        const pts: Point[] = [];
        const steps = Math.max(8, Math.round(2 * Math.PI * ringR));
        for (let i = 0; i <= steps; i++) {
          const angle = (i / steps) * 2 * Math.PI;
          pts.push([cx + ringR * Math.cos(angle), cy + ringR * Math.sin(angle)]);
        }
        blobStrokes.push(pts);
      }
      strokes.push(...blobStrokes);
    }
  }
  return strokes;
}

// ─── Generate contour hatching for shading ───────────────────────────────────
// Scans at 45° and generates line segments ONLY within dark regions.
// Properly breaks strokes when crossing white/light areas.
function generateHatching(
  darknessMap: Float32Array,
  imgW: number, imgH: number,
  strokeWeight: number, // 1-5
  minDarkness: number   // only shade areas darker than this
): Stroke[] {
  const strokes: Stroke[] = [];
  // Base spacing: strokeWeight=1 → 4px apart, strokeWeight=5 → 1px apart
  const baseSpacing = Math.max(1.0, 4.5 - strokeWeight * 0.7);

  // Scan diagonal lines at 45°
  // Each diagonal is parameterized by d = x - y (constant along the diagonal)
  const dMin = -(imgH - 1);
  const dMax = imgW - 1;

  for (let d = dMin; d <= dMax; d += baseSpacing) {
    let currentStroke: Stroke = [];

    // Walk along this diagonal
    const yStart = Math.max(0, Math.ceil(-d));
    const yEnd = Math.min(imgH - 1, Math.floor(imgW - 1 - d));

    for (let y = yStart; y <= yEnd; y++) {
      const x = Math.round(y + d);
      if (x < 0 || x >= imgW) continue;

      const darkness = darknessMap[y*imgW+x];

      if (darkness >= minDarkness) {
        currentStroke.push([x, y]);
      } else {
        // End current stroke segment
        if (currentStroke.length >= 3) {
          strokes.push([...currentStroke]);
        }
        currentStroke = [];
      }
    }
    // Don't forget the last segment
    if (currentStroke.length >= 3) {
      strokes.push([...currentStroke]);
    }
  }

  return strokes;
}

// ─── Sort strokes by nearest-neighbour to minimize pen travel ────────────────
// Uses a spatial grid for O(n log n) performance instead of O(n²).
// Caps at MAX_STROKES to prevent timeout on very complex images.
const MAX_STROKES = 6000;
function sortStrokesByTravel(strokes: Stroke[]): Stroke[] {
  if (strokes.length <= 1) return strokes;
  // Cap stroke count — keep longest strokes (most important features)
  let working = strokes;
  if (working.length > MAX_STROKES) {
    working = [...strokes]
      .sort((a, b) => b.length - a.length)
      .slice(0, MAX_STROKES);
  }

  const used = new Uint8Array(working.length);
  const result: Stroke[] = [];
  let curX = 0, curY = 0;

  for (let i = 0; i < working.length; i++) {
    let bestIdx = -1, bestDist = Infinity, bestReversed = false;
    for (let j = 0; j < working.length; j++) {
      if (used[j]) continue;
      const s = working[j];
      const [sx, sy] = s[0];
      const [ex, ey] = s[s.length - 1];
      const dStart = (sx-curX)**2 + (sy-curY)**2;
      const dEnd   = (ex-curX)**2 + (ey-curY)**2;
      const d = Math.min(dStart, dEnd);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
        bestReversed = dEnd < dStart;
      }
    }
    if (bestIdx < 0) break;
    used[bestIdx] = 1;
    const stroke = bestReversed ? [...working[bestIdx]].reverse() : working[bestIdx];
    result.push(stroke);
    const last = stroke[stroke.length - 1];
    curX = last[0]; curY = last[1];
  }
  return result;
}

// ─── Merge nearby stroke endpoints ───────────────────────────────────────────
// Fast version: only merges strokes whose endpoints are within threshold.
// Skips merge entirely if stroke count is large (prevents O(n²) timeout).
function mergeNearbyStrokes(strokes: Stroke[], threshold: number): Stroke[] {
  if (strokes.length <= 1) return strokes;
  // Skip expensive merge for large stroke sets — not worth the time
  if (strokes.length > 500) return strokes;

  const merged = strokes.map(s => [...s]);
  let changed = true;
  let passes = 0;
  while (changed && passes < 3) { // cap passes to prevent infinite loop
    changed = false;
    passes++;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        if (!a.length || !b.length) continue;
        const aEnd = a[a.length - 1], bStart = b[0];
        const aStart = a[0], bEnd = b[b.length - 1];
        const d1 = (aEnd[0]-bStart[0])**2 + (aEnd[1]-bStart[1])**2;
        const d2 = (aEnd[0]-bEnd[0])**2 + (aEnd[1]-bEnd[1])**2;
        const d3 = (aStart[0]-bStart[0])**2 + (aStart[1]-bStart[1])**2;
        const d4 = (aStart[0]-bEnd[0])**2 + (aStart[1]-bEnd[1])**2;
        const t2 = threshold * threshold;
        const minD2 = Math.min(d1, d2, d3, d4);
        if (minD2 > t2) continue;
        let newStroke: Stroke;
        if (minD2 === d1) newStroke = [...a, ...b];
        else if (minD2 === d2) newStroke = [...a, ...[...b].reverse()];
        else if (minD2 === d3) newStroke = [...[...b].reverse(), ...a];
        else newStroke = [...b, ...a];
        merged[i] = newStroke;
        merged.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return merged.filter(s => s.length >= 2);
}

// ─── Scale strokes to plotter canvas ─────────────────────────────────────────
function scaleStrokes(strokes: Stroke[], imgW: number, imgH: number, s: PlotterSettings): Stroke[] {
  const scale = Math.min(s.canvas_x/imgW, s.canvas_y/imgH);
  const padX = (s.canvas_x - imgW*scale)/2;
  const padY = (s.canvas_y - imgH*scale)/2;
  return strokes.map(stroke =>
    stroke.map(([px,py]) => [
      s.offset_x + padX + px*scale,
      s.offset_y + padY + (imgH-py)*scale,
    ] as Point)
  );
}

// ─── SVG with absolute mm coordinates (for Composer G-code generation) ────────
function buildStrokesSvg(scaledStrokes: Stroke[], s: PlotterSettings): string {
  const paths: string[] = [];
  for (const stroke of scaledStrokes) {
    if (stroke.length < 2) continue;
    let d = `M${stroke[0][0].toFixed(3)},${stroke[0][1].toFixed(3)}`;
    for (let i = 1; i < stroke.length; i++) {
      d += `L${stroke[i][0].toFixed(3)},${stroke[i][1].toFixed(3)}`;
    }
    paths.push(`<path d="${d}" stroke="black" fill="none" stroke-width="0.3"/>`);
  }
  // Y-flip: plotter Y-up → SVG Y-down without touching path coordinates.
  // scale(1,-1) reflect + translate maps plotter top (offset_y+canvas_y) → SVG top (min viewBox Y).
  // Path d-attributes stay in plotter mm space so G-code reads them unchanged.
  const flipY = `scale(1,-1) translate(0,${-(2 * s.offset_y + s.canvas_y)})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${s.offset_x} ${s.offset_y} ${s.canvas_x} ${s.canvas_y}" width="100%" height="100%"><g transform="${flipY}">${paths.join("")}</g></svg>`;
}

// ─── G-code with Z-hop on every travel ───────────────────────────────────────
function buildGcode(strokes: Stroke[], s: PlotterSettings): { gcode: string; totalLen: number } {
  const f = (n: number) => n.toFixed(2);
  const L: string[] = [];
  L.push("; Sovol SV02 Pen Plotter G-code");
  L.push(`; Strokes: ${strokes.length}`);
  L.push(";");
  L.push("G21 ; mm units");
  L.push("G90 ; absolute positioning");
  L.push("G28 X Y ; home X and Y ONLY");
  L.push(`G0 Z${f(s.z_hop)} F${s.feed_travel} ; pen up`);
  L.push("");

  L.push("; === IMAGE STROKES ===");
  let totalLen = 0;
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    const [sx,sy] = stroke[0];
    L.push(`G0 X${f(sx)} Y${f(sy)} F${s.feed_travel}`);
    L.push(`G0 Z${f(s.z_draw)} F${s.feed_travel}`);
    for (let j=1;j<stroke.length;j++) {
      const [px,py]=stroke[j];
      L.push(`G1 X${f(px)} Y${f(py)} F${s.feed_draw}`);
      const [ppx,ppy]=stroke[j-1];
      totalLen+=Math.sqrt((px-ppx)**2+(py-ppy)**2);
    }
    L.push(`G0 Z${f(s.z_hop)} F${s.feed_travel}`);
  }

  L.push("");
  L.push("; === FOOTER ===");
  L.push(`G0 Z${f(s.z_hop+5)} F${s.feed_travel}`);
  L.push(`G0 X${f(s.offset_x)} Y${f(s.offset_y)} F${s.feed_travel}`);
  L.push("M84 ; disable steppers");

  return { gcode: L.join("\n"), totalLen };
}

// ─── SVG preview with variable stroke width ───────────────────────────────────
// Renders strokes in pixel-space coordinates, scaled to fit a 500px preview.
// Computes actual bounding box of all strokes so nothing is ever cropped.
function buildSvg(strokes: Stroke[], imgW: number, imgH: number, darknessMap?: Float32Array): string {
  if (strokes.length === 0) {
    return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" style="background:white"></svg>`).toString("base64")}`;
  }

  // Compute actual bounding box of all stroke points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [px, py] of stroke) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  // Clamp to image bounds with small padding
  minX = Math.max(0, minX - 2);
  minY = Math.max(0, minY - 2);
  maxX = Math.min(imgW, maxX + 2);
  maxY = Math.min(imgH, maxY + 2);

  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  // Scale to fit within 600×600 while preserving aspect ratio
  const sc = Math.min(600 / bboxW, 600 / bboxH);
  const sw = Math.round(bboxW * sc);
  const sh = Math.round(bboxH * sc);

  const paths: string[] = [];
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    // Sample darkness at midpoint for stroke width in preview
    let strokeWidth = "0.8";
    if (darknessMap) {
      const mid = stroke[Math.floor(stroke.length / 2)];
      const ix = Math.max(0, Math.min(imgW-1, Math.round(mid[0])));
      const iy = Math.max(0, Math.min(imgH-1, Math.round(mid[1])));
      const d = darknessMap[iy*imgW+ix];
      strokeWidth = (0.4 + d * 1.2).toFixed(2);
    }
    // Translate so minX/minY becomes 0,0, then scale
    let d = `M${((stroke[0][0]-minX)*sc).toFixed(1)},${((stroke[0][1]-minY)*sc).toFixed(1)}`;
    for (let i = 1; i < stroke.length; i++)
      d += `L${((stroke[i][0]-minX)*sc).toFixed(1)},${((stroke[i][1]-minY)*sc).toFixed(1)}`;
    paths.push(`<path d="${d}" stroke="black" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}" style="background:white">${paths.join("")}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ─── Darkness map preview (orange heatmap) ────────────────────────────────────
function buildDarknessMapSvg(darknessMap: Float32Array, imgW: number, imgH: number): string {
  const sc = Math.min(300/imgW, 300/imgH);
  const sw = Math.round(imgW*sc), sh = Math.round(imgH*sc);
  // Sample every 4px for performance
  const rects: string[] = [];
  const step = 4;
  for (let y=0;y<imgH;y+=step) {
    for (let x=0;x<imgW;x+=step) {
      const d = darknessMap[y*imgW+x];
      if (d < 0.1) continue;
      const alpha = Math.min(1, d * 1.5);
      const rx = (x*sc).toFixed(1), ry = (y*sc).toFixed(1);
      const rs = (step*sc+0.5).toFixed(1);
      rects.push(`<rect x="${rx}" y="${ry}" width="${rs}" height="${rs}" fill="rgba(251,146,60,${alpha.toFixed(2)})"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}" style="background:white">${rects.join("")}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ─── Detect image type: clean line art vs grey-tone sketch ───────────────────
// Returns true if the image is already clean black-on-white line art.
// Line art has a bimodal histogram (mostly white + mostly black, little grey).
function isLineArt(gray: Float32Array): boolean {
  // Count pixels in three zones: dark (<80), mid (80-180), light (>180)
  let dark = 0, mid = 0, light = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    if (v < 80) dark++;
    else if (v < 180) mid++;
    else light++;
  }
  const total = gray.length;
  const midFraction = mid / total;
  // Raised threshold: pencil sketches have up to 30% mid-grey (pencil texture)
  // but are still "line art" in the sense that they should use Otsu threshold.
  // Only use adaptive threshold for true grey-tone photos/renders.
  return midFraction < 0.30;
}

// ─── Otsu threshold for clean line art ───────────────────────────────────────
// Finds the optimal global threshold using Otsu's method.
function otsuThreshold(gray: Float32Array): number {
  const hist = new Float32Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.round(gray[i])]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) ** 2;
    if (varBetween > maxVar) { maxVar = varBetween; threshold = t; }
  }
  return threshold;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File;
    const detailLevel = Math.max(1, Math.min(10, parseInt(formData.get("detail") as string) || 8));
    const drawingMode = (formData.get("drawingMode") as DrawingMode) || "multi";
    const strokeWeight = Math.max(1, Math.min(5, parseInt(formData.get("strokeWeight") as string) || 2));
    const penType = (formData.get("penType") as string) || "2mm";
    const orientation = ((formData.get("orientation") as string) || "portrait") as Orientation;
    const raw = JSON.parse((formData.get("settings") as string) || "{}");

    if (!file) return NextResponse.json({ error: "No image provided" }, { status: 400 });

    // ── Pen-specific parameters ────────────────────────────────────────────
    const is06mm = penType === "0.6mm";

    // Both modes use skeletonization — it's the correct approach for pen plotting.
    // 0.6mm: higher resolution + much lower epsilon = more faithful curves
    // 2mm: standard resolution + moderate epsilon = clean bold strokes
    const maxDim = is06mm ? 1400 : 1200;  // High res for ball pen — 6px/mm at 1200px on 200mm canvas

    // Epsilon for Douglas-Peucker simplification
    // 0.6mm: very low (0.3px base) — preserves fine curves, hair strands, details
    // 2mm: moderate (0.6px base) — clean bold lines
    // Ball pen draws ~0.3mm lines — keep epsilon tight so curves are faithful
    const epsilonBase = is06mm ? 0.2 : 0.3;
    const epsilonStep = is06mm ? 0.01 : 0.015;
    const mergeThreshold = is06mm ? 1.2 : 1.5;

    // ── Canvas dimensions based on orientation ─────────────────────────────
    // Portrait:  200mm wide × 160mm tall  (default, nozzle safe zone)
    // Landscape: 250mm wide × 160mm tall  (rotated paper, more horizontal space)
    // User noted nozzle can't go further left, so landscape gives more X travel
    let canvasX: number, canvasY: number, offsetX: number, offsetY: number;
    if (orientation === "landscape") {
      canvasX = raw.canvasX ?? 250;
      canvasY = raw.canvasY ?? 160;
      offsetX = raw.offsetX ?? 10;
      offsetY = raw.offsetY ?? 20;
    } else {
      canvasX = raw.canvasX ?? 200;
      canvasY = raw.canvasY ?? 160;
      offsetX = raw.offsetX ?? 20;
      offsetY = raw.offsetY ?? 40;
    }

    const s: PlotterSettings = {
      z_draw:      raw.zDraw      ?? 0.0,
      z_hop:       raw.zHop       ?? 3.0,
      feed_draw:   raw.feedDraw   ?? (is06mm ? 1200 : 1500),
      feed_travel: raw.feedTravel ?? 3000,
      canvas_x:    canvasX,
      canvas_y:    canvasY,
      offset_x:    offsetX,
      offset_y:    offsetY,
      detail_level: detailLevel,
    };

    const bytes = Buffer.from(await file.arrayBuffer());
    let img: InstanceType<typeof Jimp>;
    try {
      img = await Jimp.read(bytes);
    } catch {
      return NextResponse.json({ error: "Could not read image. Please upload JPG, PNG, or WEBP." }, { status: 400 });
    }

    if (img.bitmap.width > maxDim || img.bitmap.height > maxDim) {
      img.scaleToFit(maxDim, maxDim);
    }

    const imgW = img.bitmap.width;
    const imgH = img.bitmap.height;

    // ── Extract grayscale ──────────────────────────────────────────────────
    const gray = new Float32Array(imgW * imgH);
    for (let y = 0; y < imgH; y++) {
      for (let x = 0; x < imgW; x++) {
        const pixel = img.getPixelColor(x, y);
        const r = (pixel >>> 24) & 0xff;
        const g = (pixel >>> 16) & 0xff;
        const b = (pixel >>> 8) & 0xff;
        gray[y * imgW + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }

    // ── Darkness map ───────────────────────────────────────────────────────
    const blurred = gaussianBlur5(gaussianBlur3(gray, imgW, imgH), imgW, imgH);
    const darknessMap = computeDarknessMap(blurred, imgW, imgH, 8);

    // ── Detect image type ──────────────────────────────────────────────────
    const lineArt = isLineArt(gray);

    // ── Binarize ───────────────────────────────────────────────────────────
    // For clean line art: Otsu threshold — preserves every thin line exactly.
    // For grey-tone sketches: adaptive local threshold with tighter window for 0.6mm.
    const binary = new Uint8Array(imgW * imgH);

    if (lineArt) {
      // Use Otsu threshold — finds the optimal split between ink and paper
      // 0.6mm: use raw gray (no blur) to preserve the thinnest lines
      // 2mm: use light blur to clean up noise
      const src = is06mm ? gray : gaussianBlur3(gray, imgW, imgH);
      const otsu = otsuThreshold(src);
      // 0.6mm: no offset — keep every pixel that Otsu says is ink
      // 2mm: small offset to clean up noise
      const t = is06mm ? otsu : Math.min(otsu + 8, 210);
      for (let i = 0; i < src.length; i++) {
        binary[i] = src[i] < t ? 1 : 0;
      }
    } else {
      // Adaptive threshold for grey-tone sketches
      // 0.6mm: slightly more sensitive to capture fine details
      // 2mm: standard sensitivity
      const thresholdBase = is06mm ? 170 : 165;
      const thresholdStep = is06mm ? 4 : 5;
      const localDelta = is06mm ? 10 : 12;
      const winR = 15;
      const threshold = thresholdBase + (detailLevel - 1) * thresholdStep;
      const localMean = new Float32Array(imgW * imgH);
      for (let y = 0; y < imgH; y++) {
        for (let x = 0; x < imgW; x++) {
          let sum = 0, cnt = 0;
          for (let dy = -winR; dy <= winR; dy++) {
            for (let dx = -winR; dx <= winR; dx++) {
              const nx = Math.max(0, Math.min(imgW-1, x+dx));
              const ny = Math.max(0, Math.min(imgH-1, y+dy));
              sum += blurred[ny*imgW+nx]; cnt++;
            }
          }
          localMean[y*imgW+x] = sum / cnt;
        }
      }
      for (let i = 0; i < blurred.length; i++) {
        binary[i] = (blurred[i] < threshold || blurred[i] < localMean[i] - localDelta) ? 1 : 0;
      }
    }

    // ── Morphological closing ──────────────────────────────────────────────
    // For line art: skip — closing merges nearby parallel lines
    // For grey-tone: light closing to connect broken strokes
    let workBinary: Uint8Array;
    if (lineArt) {
      workBinary = binary;
    } else {
      const dilated = new Uint8Array(imgW * imgH);
      for (let y = 1; y < imgH-1; y++) {
        for (let x = 1; x < imgW-1; x++) {
          if (binary[y*imgW+x] || binary[(y-1)*imgW+x] || binary[(y+1)*imgW+x] ||
              binary[y*imgW+(x-1)] || binary[y*imgW+(x+1)]) {
            dilated[y*imgW+x] = 1;
          }
        }
      }
      const closed = new Uint8Array(imgW * imgH);
      for (let y = 1; y < imgH-1; y++) {
        for (let x = 1; x < imgW-1; x++) {
          if (dilated[y*imgW+x] && dilated[(y-1)*imgW+x] && dilated[(y+1)*imgW+x] &&
              dilated[y*imgW+(x-1)] && dilated[y*imgW+(x+1)]) {
            closed[y*imgW+x] = 1;
          }
        }
      }
      workBinary = closed;
    }

    // ── Stroke tracing — unified approach for both pen modes ──────────────
    // Both modes: threshold → skeletonize → trace → simplify
    // This is the correct pipeline for pen-plotter line art.
    //
    // The ONLY difference between 0.6mm and 2mm is:
    //   0.6mm: lower epsilon (0.2px) = more points kept = smoother, more faithful curves
    //   0.6mm: shorter minLen (2px)  = captures fine hair strands and thin details
    //   2mm:   higher epsilon (0.5px) = cleaner simplified bold strokes
    //   2mm:   longer minLen (3px)   = avoids noise fragments

    const skeleton = skeletonize(workBinary, imgW, imgH);
    const strokeWidths = measureStrokeWidths(skeleton, binary, imgW, imgH);
    const blobStrokes = detectSmallBlobs(binary, blurred, imgW, imgH, 2, 200);

    // minLen: how short a stroke must be to keep it
    // 0.6mm at detail=10: minLen=2 (keeps very fine details)
    // 0.6mm at detail=1:  minLen=5
    // 2mm at detail=10:   minLen=3
    // 2mm at detail=1:    minLen=10
    const minLenBase = is06mm ? 6 : 14;
    const minLenStep = is06mm ? 0.4 : 1.2;
    const minLen = Math.max(2, Math.round(minLenBase - detailLevel * minLenStep));

    // epsilon: Douglas-Peucker simplification threshold
    // 0.6mm: very low — preserve every curve detail
    // 2mm: moderate — clean bold strokes
    // For line art: multiply by 0.4 (already clean, don't over-simplify)
    const epsilonMultiplier = lineArt ? (is06mm ? 0.3 : 0.4) : 1.0;
    const epsilon = Math.max(0.15, (epsilonBase - detailLevel * epsilonStep) * epsilonMultiplier);

    const rawStrokes = traceStrokes(skeleton, imgW, imgH, minLen);
    const baseStrokes = bridgeStrokeGaps(
      rawStrokes.map(s => simplify(s, epsilon)).filter(s => s.length >= 2),
      lineArt ? 1 : 2  // 1px for line art: bridge skeleton micro-gaps only, no cross-feature merging
    );

    // ── Apply drawing mode ─────────────────────────────────────────────────
    let finalStrokes: Stroke[] = [];
    const pxPerMm = imgW / s.canvas_x;

    if (drawingMode === "single") {
      finalStrokes = [...baseStrokes, ...blobStrokes];

    } else if (drawingMode === "multi") {
      const spacingPx = is06mm ? 0.3 * pxPerMm : 0.5 * pxPerMm;
      for (const stroke of baseStrokes) {
        let totalWidth = 0, count = 0;
        for (const [px, py] of stroke) {
          const ix = Math.max(0, Math.min(imgW-1, Math.round(px)));
          const iy = Math.max(0, Math.min(imgH-1, Math.round(py)));
          const sw = strokeWidths[iy*imgW+ix];
          if (sw > 0) { totalWidth += sw; count++; }
        }
        const avgWidth = count > 0 ? totalWidth / count : 1;
        finalStrokes.push(...generateWeightedStrokes(stroke, avgWidth, strokeWeight, spacingPx));
      }
      finalStrokes.push(...blobStrokes);

    } else if (drawingMode === "shading") {
      const spacingPx = is06mm ? 0.25 * pxPerMm : 0.35 * pxPerMm;
      for (const stroke of baseStrokes) {
        let totalWidth = 0, count = 0;
        for (const [px, py] of stroke) {
          const ix = Math.max(0, Math.min(imgW-1, Math.round(px)));
          const iy = Math.max(0, Math.min(imgH-1, Math.round(py)));
          const sw = strokeWidths[iy*imgW+ix];
          if (sw > 0) { totalWidth += sw; count++; }
        }
        const avgWidth = count > 0 ? totalWidth / count : 1;
        const effectiveWidth = Math.max(avgWidth, 3);
        finalStrokes.push(...generateWeightedStrokes(stroke, effectiveWidth, Math.max(2, strokeWeight), spacingPx));
      }
      finalStrokes.push(...blobStrokes);
      const hatchStrokes = generateHatching(darknessMap, imgW, imgH, strokeWeight, 0.60);
      const simplifiedHatch = hatchStrokes
        .map(s => simplify(s, 1.5))
        .filter(s => s.length >= 3)
        .slice(0, 800);
      finalStrokes.push(...simplifiedHatch);
    }

    // ── Post-process ───────────────────────────────────────────────────────
    const mergedStrokes = mergeNearbyStrokes(finalStrokes, mergeThreshold);
    const sortedStrokes = sortStrokesByTravel(mergedStrokes);

    // ── Scale and generate G-code ──────────────────────────────────────────
    const scaledStrokes = scaleStrokes(sortedStrokes, imgW, imgH, s);
    const { gcode, totalLen } = buildGcode(scaledStrokes, s);
    const sketchDataUrl = buildSvg(sortedStrokes, imgW, imgH, darknessMap);
    const darknessMapUrl = buildDarknessMapSvg(darknessMap, imgW, imgH);
    const strokesSvg = buildStrokesSvg(scaledStrokes, s);

    const drawTimeSec = Math.round(
      (totalLen / s.feed_draw + scaledStrokes.length * 30 / s.feed_travel) * 60
    );

    return NextResponse.json({
      gcode,
      sketchDataUrl,
      darknessMapUrl,
      strokesSvg,
      stats: {
        strokeCount: scaledStrokes.length,
        estimatedTimeSeconds: drawTimeSec,
        pathLengthMm: Math.round(totalLen),
      },
    });

  } catch (err: unknown) {
    console.error("Processing error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Processing failed: ${msg}` },
      { status: 500 }
    );
  }
}
