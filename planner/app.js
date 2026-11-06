/* Wi-Fi Coverage Planner
 *
 * Idea in one line: estimate the signal everywhere on a floor plan
 * (distance + walls in the way), check it against real measurements,
 * and suggest where the next router / mesh node should go.
 *
 * Signal model (log-distance path loss, the usual simple indoor model):
 *   RSSI = P1m - 10 * n * log10(distance in m) - (loss of every wall crossed)
 *   P1m = signal 1 m from the router, n = how fast it fades (2 = open space, 3-4 = house)
 * It is a rough estimate. That's why real measurements can "pull" P1m and n
 * to fit what was actually measured ("Match model to my measurements").
 */
(() => {
  "use strict";

  // ------------------------------------------------------------ constants
  // Rough typical loss per wall in dB. Real numbers vary a lot by build.
  const MATERIALS = {
    glass:    { name: "Glass / window",  color: "#6aa9d6", loss: { "2.4": 2,  "5": 3 } },
    drywall:  { name: "Drywall (knauf)", color: "#9a948a", loss: { "2.4": 3,  "5": 5 } },
    door:     { name: "Wooden door",     color: "#b07a43", loss: { "2.4": 4,  "5": 6 } },
    brick:    { name: "Brick",           color: "#a4442f", loss: { "2.4": 8,  "5": 12 } },
    concrete: { name: "Concrete",        color: "#4b4e52", loss: { "2.4": 12, "5": 18 } },
    metal:    { name: "Metal / fridge",  color: "#1f2a44", loss: { "2.4": 20, "5": 26 } },
  };
  const DEFAULT_P1M = { "2.4": -40, "5": -45 };
  const GREAT = -65;          // above this: great signal
  const HIT = 9;              // px: how close a click must be to grab something

  const HINTS = {
    move:  "Drag routers, pins, labels or wall ends. Scroll the page to see the rest of a big plan.",
    scale: "Click two points whose real distance you know (e.g. ends of a wall), then type the distance in metres.",
    wall:  "Click to start a wall, click again to end it (it continues from there). Esc or right-click = stop. Hold Shift for straight walls.",
    ap:    "Click where an existing router / access point is.",
    area:  "Drag a box over the part that needs Wi-Fi. Without a box, the area = everything inside the walls.",
    pin:   "Pick a measurement in the list on the right, then click where you stood when you measured it.",
    label: "Click to add a text label (room names).",
    erase: "Click a wall, router, pin, label or area box to delete it.",
  };

  // ------------------------------------------------------------ state
  const blank = () => ({
    version: 1,
    image: null, w: 900, h: 600,
    pxPerM: 50,
    walls: [], aps: [], areas: [], labels: [], measurements: [],
    suggested: [],
    settings: { band: "5", threshold: -75, backhaul: -70, mesh: true, maxNew: 3,
                p1m: DEFAULT_P1M["5"], n: 3.0 },
  });

  let P = blank();
  let img = null;                 // HTMLImageElement of the floor plan
  let tool = "move";
  let material = "drywall";
  let draft = null;               // wall/scale/area being drawn
  let drag = null;                // thing being dragged
  let mouse = { x: 0, y: 0, shift: false };
  let selectedMeas = null;
  let heat = null;                // cached heatmap
  let dirty = true;
  const undo = [];

  const $ = (id) => document.getElementById(id);
  const cv = $("cv"), ctx = cv.getContext("2d");

  // ------------------------------------------------------------ geometry
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function cross(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }
  // Do segments AB and CD properly cross?
  function crosses(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = cross(cx, cy, dx, dy, ax, ay), d2 = cross(cx, cy, dx, dy, bx, by);
    const d3 = cross(ax, ay, bx, by, cx, cy), d4 = cross(ax, ay, bx, by, dx, dy);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0;
  }
  function distToSeg(px, py, w) {
    const vx = w.x2 - w.x1, vy = w.y2 - w.y1;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((px - w.x1) * vx + (py - w.y1) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    return dist(px, py, w.x1 + t * vx, w.y1 + t * vy);
  }

  // ------------------------------------------------------------ signal model
  function wallLoss(ax, ay, bx, by) {
    let loss = 0;
    const band = P.settings.band;
    for (const w of P.walls) {
      if (crosses(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2)) loss += MATERIALS[w.mat].loss[band];
    }
    return loss;
  }
  function rssiFrom(src, x, y) {
    const p1m = src.p1m ?? P.settings.p1m;
    const d = Math.max(0.5, dist(src.x, src.y, x, y) / P.pxPerM);
    return p1m - 10 * P.settings.n * Math.log10(d) - wallLoss(src.x, src.y, x, y);
  }
  function bestRssi(nodes, x, y) {
    let best = -Infinity, who = null;
    for (const s of nodes) {
      const r = rssiFrom(s, x, y);
      if (r > best) { best = r; who = s; }
    }
    return { rssi: best, from: who };
  }
  const allNodes = () => P.aps.concat(P.suggested);

  // The area that needs coverage, as a list of rectangles.
  function coverageRects() {
    if (P.areas.length) return P.areas.map(normRect);
    if (P.walls.length) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const w of P.walls) {
        x1 = Math.min(x1, w.x1, w.x2); y1 = Math.min(y1, w.y1, w.y2);
        x2 = Math.max(x2, w.x1, w.x2); y2 = Math.max(y2, w.y1, w.y2);
      }
      return [{ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }];
    }
    return [{ x: 0, y: 0, w: P.w, h: P.h }];
  }
  function normRect(r) {
    return { x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) };
  }
  function cellsIn(rects, stepPx) {
    const cells = [];
    for (const r of rects) {
      for (let y = r.y + stepPx / 2; y < r.y + r.h; y += stepPx)
        for (let x = r.x + stepPx / 2; x < r.x + r.w; x += stepPx) cells.push({ x, y });
    }
    return cells;
  }

  function computeHeat() {
    const step = Math.max(6, Math.round(0.25 * P.pxPerM));
    const rects = coverageRects();
    const nodes = allNodes();
    const cells = cellsIn(rects, step);
    const thr = P.settings.threshold;
    let good = 0;
    for (const c of cells) {
      c.r = nodes.length ? bestRssi(nodes, c.x, c.y).rssi : -Infinity;
      if (c.r >= thr) good++;
    }
    const m2 = (step / P.pxPerM) ** 2;
    heat = { step, cells, good, total: cells.length, m2 };
  }

  function colorFor(r) {
    const thr = P.settings.threshold;
    if (r >= GREAT) return "rgba(34,160,90,0.42)";
    if (r >= thr)   return "rgba(178,196,40,0.42)";
    if (r >= thr - 7) return "rgba(240,140,30,0.45)";
    return "rgba(214,48,39,0.45)";
  }

  // ------------------------------------------------------------ suggestion
  // Greedy: try every candidate spot, keep the one that turns the most
  // "bad" area into "good" area. Repeat. For a mesh node, a spot is only
  // allowed if it still hears an existing device well enough (backhaul),
  // otherwise the new node has nothing to pass on.
  function suggest() {
    const S = P.settings;
    P.suggested = [];
    if (!P.aps.length) { alert("Place at least one existing router first (Router tool)."); return; }
    const rects = coverageRects();
    const areaPx = rects.reduce((a, r) => a + r.w * r.h, 0);
    let step = Math.max(Math.round(0.5 * P.pxPerM), Math.sqrt(areaPx / 2500));
    const cells = cellsIn(rects, step);
    let cstep = Math.max(Math.round(1 * P.pxPerM), Math.sqrt(areaPx / 500));
    // keep candidates off the exact wall lines
    const cands = cellsIn(rects, cstep).filter((c) => !P.walls.some((w) => distToSeg(c.x, c.y, w) < 0.3 * P.pxPerM));
    const thr = S.threshold;

    const cur = cells.map((c) => bestRssi(P.aps, c.x, c.y).rssi);
    const candSig = cands.map((c) => cells.map((cell) => rssiFrom({ x: c.x, y: c.y }, cell.x, cell.y)));
    const nodes = P.aps.slice();

    for (let k = 0; k < S.maxNew; k++) {
      const uncovered = cur.filter((r) => r < thr).length;
      if (uncovered / cells.length < 0.05) break;
      let best = null;
      cands.forEach((c, i) => {
        let link = null;
        if (S.mesh) {
          link = bestRssi(nodes, c.x, c.y);
          if (link.rssi < S.backhaul) return;
        }
        let gain = 0, marginSum = 0;
        const sig = candSig[i];
        for (let j = 0; j < cells.length; j++) {
          if (cur[j] < thr && sig[j] >= thr) gain++;
        }
        if (!gain) return;
        marginSum = link ? link.rssi : 0;
        // more new coverage wins; on a tie, the stronger mesh link wins
        if (!best || gain > best.gain || (gain === best.gain && marginSum > best.margin)) {
          best = { i, c, gain, margin: marginSum, link };
        }
      });
      // not worth a whole device if it fixes less than 5 % of the area
      if (!best || best.gain / cells.length < 0.05) break;
      const node = {
        x: best.c.x, y: best.c.y, name: "New " + (k + 1), suggested: true,
        gainM2: best.gain * (step / P.pxPerM) ** 2,
        link: best.link ? { rssi: best.link.rssi, from: best.link.from.name } : null,
      };
      nodes.push(node);
      P.suggested.push(node);
      const sig = candSig[best.i];
      for (let j = 0; j < cells.length; j++) cur[j] = Math.max(cur[j], sig[j]);
    }
    if (!P.suggested.length) {
      const why = S.mesh
        ? "Either coverage is already fine, or no spot that still hears a router well enough (mesh link) helps. Try lowering the mesh link limit or unticking mesh (cable to the new device)."
        : "Coverage is already fine, or nothing helps.";
      setTimeout(() => alert("No suggestion. " + why), 10);
    }
  }

  // ------------------------------------------------------------ calibration
  // Least squares fit of  (measured + walls) = P1m - n * 10log10(d)
  function calibrate() {
    const pts = P.measurements.filter((m) => m.x != null && m.rssi != null);
    if (!pts.length) { $("calibInfo").textContent = "Pin at least 1 measurement on the plan first (2+ is better)."; return; }
    if (!P.aps.length) { $("calibInfo").textContent = "Place the router you measured from first."; return; }
    const before = rmsError(pts);
    const rows = pts.map((m) => {
      const ap = bestRssi(P.aps, m.x, m.y).from;
      const d = Math.max(0.5, dist(ap.x, ap.y, m.x, m.y) / P.pxPerM);
      return { x: -10 * Math.log10(d), y: m.rssi + wallLoss(ap.x, ap.y, m.x, m.y) };
    });
    const mx = avg(rows.map((r) => r.x)), my = avg(rows.map((r) => r.y));
    const sxx = rows.reduce((a, r) => a + (r.x - mx) ** 2, 0);
    let n = P.settings.n;
    if (rows.length >= 2 && sxx > 4) {
      n = rows.reduce((a, r) => a + (r.x - mx) * (r.y - my), 0) / sxx;
      n = Math.max(1.6, Math.min(5, n));
    }
    const p1m = my - n * mx;
    P.settings.n = Math.round(n * 10) / 10;
    P.settings.p1m = Math.round(Math.max(-60, Math.min(-25, p1m)));
    P.aps.forEach((a) => delete a.p1m);
    const after = rmsError(pts);
    $("calibInfo").textContent =
      `Fitted to ${pts.length} measurement${pts.length > 1 ? "s" : ""}: P1m ${P.settings.p1m} dBm, n ${P.settings.n}. ` +
      `Average miss went from ${before.toFixed(1)} to ${after.toFixed(1)} dB.` +
      (rows.length < 2 || sxx <= 4 ? " (Only the 1 m signal was adjusted: measurements need different distances to fit n.)" : "");
    P.suggested = [];
    changed();
    syncSettings();
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  function rmsError(pts) {
    return Math.sqrt(avg(pts.map((m) => (bestRssi(P.aps, m.x, m.y).rssi - m.rssi) ** 2)));
  }

  // ------------------------------------------------------------ drawing
  function draw() {
    if (dirty) { computeHeat(); dirty = false; renderPanel(); }
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (img) ctx.drawImage(img, 0, 0, P.w, P.h);
    else drawGrid();

    // heatmap
    if (heat && allNodes().length) {
      const s = heat.step;
      for (const c of heat.cells) {
        ctx.fillStyle = colorFor(c.r);
        ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s);
      }
    }
    // areas
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(11,110,105,0.8)";
    ctx.lineWidth = 1.5;
    for (const a of P.areas) { const r = normRect(a); ctx.strokeRect(r.x, r.y, r.w, r.h); }
    ctx.restore();

    // walls
    ctx.lineCap = "round";
    for (const w of P.walls) {
      ctx.strokeStyle = MATERIALS[w.mat].color;
      ctx.lineWidth = w.mat === "concrete" || w.mat === "brick" || w.mat === "metal" ? 6 : 4;
      line(w.x1, w.y1, w.x2, w.y2);
    }
    // labels
    ctx.font = "600 13px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const l of P.labels) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      const tw = ctx.measureText(l.text).width;
      ctx.fillRect(l.x - tw / 2 - 4, l.y - 9, tw + 8, 18);
      ctx.fillStyle = "#33363a";
      ctx.fillText(l.text, l.x, l.y);
    }
    // mesh links of suggested nodes
    for (const s of P.suggested) {
      if (!s.link) continue;
      const from = allNodes().find((n) => n.name === s.link.from);
      if (!from) continue;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(11,110,105,0.9)";
      ctx.lineWidth = 2;
      line(from.x, from.y, s.x, s.y);
      ctx.restore();
      const mx = (from.x + s.x) / 2, my = (from.y + s.y) / 2;
      tag(`${Math.round(s.link.rssi)} dBm`, mx, my, "#0b6e69");
    }
    // measurement pins
    for (const m of P.measurements) {
      if (m.x == null) continue;
      const pred = P.aps.length ? Math.round(bestRssi(P.aps, m.x, m.y).rssi) : null;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = m === selectedMeas ? "#0b6e69" : "#fff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1d1f21";
      ctx.stroke();
      tag(`${m.place}: ${m.rssi} dBm${m.loss ? `, ${m.loss}% lost` : ""}${pred != null ? ` (model ${pred})` : ""}`, m.x, m.y - 16, "#1d1f21");
    }
    // routers
    for (const a of P.aps) node(a, "#1d1f21", "R");
    for (const s of P.suggested) node(s, "#0b6e69", "+");

    // drafts
    if (draft && (draft.type === "wall" || draft.type === "scale")) {
      const end = snapEnd(draft.x, draft.y, mouse.x, mouse.y);
      ctx.save();
      ctx.setLineDash(draft.type === "scale" ? [5, 4] : []);
      ctx.strokeStyle = draft.type === "scale" ? "#0b6e69" : MATERIALS[material].color;
      ctx.lineWidth = draft.type === "scale" ? 2 : 4;
      line(draft.x, draft.y, end.x, end.y);
      ctx.restore();
      const m = dist(draft.x, draft.y, end.x, end.y) / P.pxPerM;
      tag(`${m.toFixed(2)} m`, (draft.x + end.x) / 2, (draft.y + end.y) / 2 - 12, "#0b6e69");
    }
    if (draft && draft.type === "area") {
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#0b6e69";
      ctx.strokeRect(draft.x, draft.y, mouse.x - draft.x, mouse.y - draft.y);
      ctx.restore();
    }
    // live readout under the mouse
    if (allNodes().length && mouse.inside) {
      const b = bestRssi(allNodes(), mouse.x, mouse.y);
      tag(`${Math.round(b.rssi)} dBm from ${b.from.name}`, mouse.x + 14, mouse.y + 18, "#555", "left");
    }
    drawScaleBar();
  }

  function drawGrid() {
    ctx.strokeStyle = "#eeece7";
    ctx.lineWidth = 1;
    for (let x = 0; x < P.w; x += P.pxPerM) line(x, 0, x, P.h);
    for (let y = 0; y < P.h; y += P.pxPerM) line(0, y, P.w, y);
  }
  function drawScaleBar() {
    const x = 14, y = P.h - 16, len = P.pxPerM * (P.pxPerM < 25 ? 5 : 1);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(x - 6, y - 16, len + 50, 26);
    ctx.strokeStyle = "#1d1f21"; ctx.lineWidth = 2;
    line(x, y, x + len, y); line(x, y - 4, x, y + 4); line(x + len, y - 4, x + len, y + 4);
    ctx.fillStyle = "#1d1f21"; ctx.font = "12px Segoe UI, sans-serif"; ctx.textAlign = "left";
    ctx.fillText(P.pxPerM < 25 ? "5 m" : "1 m", x + len + 6, y);
  }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function node(n, color, glyph) {
    ctx.beginPath(); ctx.arc(n.x, n.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "700 12px Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(glyph, n.x, n.y + 0.5);
    tag(n.name, n.x, n.y + 22, color);
  }
  function tag(text, x, y, color, align = "center") {
    ctx.font = "12px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = align; ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width;
    const bx = align === "left" ? x - 4 : x - w / 2 - 4;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(bx, y - 9, w + 8, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // ------------------------------------------------------------ panel
  function renderPanel() {
    const S = P.settings;
    // stats
    if (heat && heat.total && allNodes().length) {
      const pct = Math.round((100 * heat.good) / heat.total);
      const bad = (heat.total - heat.good) * heat.m2;
      $("stats").innerHTML =
        `Good signal (≥ ${S.threshold} dBm): <b>${pct}%</b> of the area<br>` +
        `Weak / dead: <b>${bad.toFixed(1)} m²</b> of ${(heat.total * heat.m2).toFixed(0)} m²`;
    } else {
      $("stats").innerHTML = `<span class="small">Place a router to see coverage.</span>`;
    }
    // suggestions
    $("sugList").innerHTML = P.suggested.map((s) =>
      `<li><b>${s.name}</b> — covers about ${s.gainM2.toFixed(1)} m² that was weak.` +
      (s.link ? `<div class="why">Hears ${s.link.from} at ${Math.round(s.link.rssi)} dBm, so it can pass the signal on (limit ${S.backhaul} dBm).</div>`
              : `<div class="why">Needs a cable (mesh off).</div>`) + `</li>`).join("");

    // legend
    $("legend").innerHTML =
      `<span><i style="background:rgba(34,160,90,.7)"></i>great (≥ ${GREAT})</span>` +
      `<span><i style="background:rgba(178,196,40,.8)"></i>good (≥ ${S.threshold})</span>` +
      `<span><i style="background:rgba(240,140,30,.8)"></i>edge, plan next device (≥ ${S.threshold - 7})</span>` +
      `<span><i style="background:rgba(214,48,39,.7)"></i>dead zone</span>` +
      `<span>Scale: ${P.pxPerM.toFixed(1)} px = 1 m</span>`;

    // measurements table
    const ms = P.measurements;
    $("measHint").style.display = ms.length ? "none" : "";
    if (ms.length) {
      $("measTable").innerHTML = `<tr><th>Spot</th><th>dBm</th><th>lost</th><th>model</th></tr>` +
        ms.map((m, i) => {
          const pred = m.x != null && P.aps.length ? Math.round(bestRssi(P.aps, m.x, m.y).rssi) : null;
          const warn = m.rssi < S.threshold || m.loss > 5;
          return `<tr data-i="${i}" class="${m === selectedMeas ? "sel" : ""} ${warn ? "warn" : ""}">` +
            `<td>${esc(m.place)}</td><td>${m.rssi}</td><td>${m.loss ?? ""}%</td>` +
            `<td>${pred != null ? pred : '<span class="unpinned">not pinned</span>'}</td></tr>`;
        }).join("");
    } else $("measTable").innerHTML = "";
    drawChart();
  }

  // Signal along the walk (order measured). The first spot that is below the
  // threshold or loses > 5 % is where the next device goes.
  function drawChart() {
    const c = $("chart"), g = c.getContext("2d");
    const ms = P.measurements;
    c.style.display = ms.length ? "" : "none";
    if (!ms.length) return;
    const W = c.width, H = c.height, pad = { l: 34, r: 8, t: 10, b: 22 };
    g.clearRect(0, 0, W, H);
    const lo = -95, hi = -30;
    const y = (r) => pad.t + ((hi - r) / (hi - lo)) * (H - pad.t - pad.b);
    const x = (i) => pad.l + (ms.length === 1 ? 0 : (i / (ms.length - 1)) * (W - pad.l - pad.r));
    g.font = "10px Segoe UI, sans-serif"; g.fillStyle = "#6b6f73"; g.textAlign = "right"; g.textBaseline = "middle";
    for (const r of [-40, -60, -80]) {
      g.strokeStyle = "#eeece7"; g.beginPath(); g.moveTo(pad.l, y(r)); g.lineTo(W - pad.r, y(r)); g.stroke();
      g.fillText(r, pad.l - 4, y(r));
    }
    const thr = P.settings.threshold;
    g.strokeStyle = "#c2410c"; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(pad.l, y(thr)); g.lineTo(W - pad.r, y(thr)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = "#0b6e69"; g.lineWidth = 2; g.beginPath();
    ms.forEach((m, i) => (i ? g.lineTo(x(i), y(m.rssi)) : g.moveTo(x(i), y(m.rssi))));
    g.stroke(); g.lineWidth = 1;
    const firstBad = ms.findIndex((m) => m.rssi < thr || m.loss > 5);
    ms.forEach((m, i) => {
      g.beginPath(); g.arc(x(i), y(m.rssi), 3.5, 0, Math.PI * 2);
      g.fillStyle = i === firstBad ? "#c2410c" : "#0b6e69"; g.fill();
    });
    g.textAlign = "center"; g.textBaseline = "top"; g.fillStyle = "#6b6f73";
    ms.forEach((m, i) => { if (ms.length <= 8 || i % 2 === 0) g.fillText(m.place.slice(0, 9), x(i), H - pad.b + 6); });
    if (firstBad >= 0) {
      g.fillStyle = "#c2410c"; g.textAlign = "left"; g.textBaseline = "bottom";
      const tx = Math.min(x(firstBad) + 6, W - 110);
      g.fillText("next device here", tx, y(ms[firstBad].rssi) - 4);
    }
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ------------------------------------------------------------ changes, undo, autosave
  function snapshot() {
    const { image, ...rest } = P;
    undo.push(JSON.stringify(rest));
    if (undo.length > 60) undo.shift();
  }
  function changed() {
    dirty = true;
    requestAnimationFrame(draw);
    clearTimeout(changed.t);
    changed.t = setTimeout(() => {
      try { localStorage.setItem("wcp-project", JSON.stringify(P)); }
      catch { try { const { image, ...rest } = P; localStorage.setItem("wcp-project", JSON.stringify(rest)); } catch {} }
    }, 400);
  }
  function doUndo() {
    if (!undo.length) return;
    const prev = JSON.parse(undo.pop());
    P = { ...prev, image: P.image };
    selectedMeas = null;
    syncSettings(); changed();
  }

  // ------------------------------------------------------------ input
  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
  }
  function snapEnd(x0, y0, x, y) {
    // snap to an existing wall end
    for (const w of P.walls) {
      for (const [ex, ey] of [[w.x1, w.y1], [w.x2, w.y2]]) if (dist(ex, ey, x, y) < HIT) return { x: ex, y: ey };
    }
    if (mouse.shift) return Math.abs(x - x0) > Math.abs(y - y0) ? { x, y: y0 } : { x: x0, y };
    return { x, y };
  }
  function snapStart(x, y) {
    for (const w of P.walls) for (const [ex, ey] of [[w.x1, w.y1], [w.x2, w.y2]]) if (dist(ex, ey, x, y) < HIT) return { x: ex, y: ey };
    return { x, y };
  }

  function hitTest(x, y) {
    for (const n of P.suggested) if (dist(n.x, n.y, x, y) < 13) return { kind: "sug", obj: n };
    for (const n of P.aps) if (dist(n.x, n.y, x, y) < 13) return { kind: "ap", obj: n };
    for (const m of P.measurements) if (m.x != null && dist(m.x, m.y, x, y) < HIT) return { kind: "meas", obj: m };
    for (const l of P.labels) if (Math.abs(l.x - x) < 40 && Math.abs(l.y - y) < 10) return { kind: "label", obj: l };
    for (const w of P.walls) {
      if (dist(w.x1, w.y1, x, y) < HIT) return { kind: "wallEnd", obj: w, end: 1 };
      if (dist(w.x2, w.y2, x, y) < HIT) return { kind: "wallEnd", obj: w, end: 2 };
    }
    for (const w of P.walls) if (distToSeg(x, y, w) < HIT / 1.5) return { kind: "wall", obj: w };
    for (const a of P.areas) {
      const r = normRect(a);
      const onEdge = x > r.x - HIT && x < r.x + r.w + HIT && y > r.y - HIT && y < r.y + r.h + HIT &&
        (Math.abs(x - r.x) < HIT || Math.abs(x - r.x - r.w) < HIT || Math.abs(y - r.y) < HIT || Math.abs(y - r.y - r.h) < HIT);
      if (onEdge) return { kind: "area", obj: a };
    }
    return null;
  }

  cv.addEventListener("contextmenu", (e) => { e.preventDefault(); draft = null; requestAnimationFrame(draw); });

  cv.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const { x, y } = toCanvas(e);
    mouse.shift = e.shiftKey;
    switch (tool) {
      case "move": {
        const h = hitTest(x, y);
        if (h && h.kind !== "wall" && h.kind !== "area") { snapshot(); drag = h; }
        break;
      }
      case "wall": {
        if (!draft) { const s = snapStart(x, y); draft = { type: "wall", x: s.x, y: s.y }; }
        else {
          const end = snapEnd(draft.x, draft.y, x, y);
          if (dist(draft.x, draft.y, end.x, end.y) > 3) {
            snapshot();
            P.walls.push({ x1: draft.x, y1: draft.y, x2: end.x, y2: end.y, mat: material });
            P.suggested = [];
            draft = { type: "wall", x: end.x, y: end.y };
            changed();
          }
        }
        break;
      }
      case "scale": {
        if (!draft) draft = { type: "scale", x, y };
        else {
          const end = snapEnd(draft.x, draft.y, x, y);
          const px = dist(draft.x, draft.y, end.x, end.y);
          draft = null;
          const ans = prompt("Real distance between the two points, in metres:", (px / P.pxPerM).toFixed(2));
          const m = parseFloat(String(ans || "").replace(",", "."));
          if (m > 0 && px > 5) { snapshot(); P.pxPerM = px / m; P.suggested = []; changed(); }
        }
        break;
      }
      case "ap": {
        snapshot();
        P.aps.push({ x, y, name: "Router " + (P.aps.length + 1) });
        P.suggested = [];
        changed();
        break;
      }
      case "area": draft = { type: "area", x, y }; break;
      case "pin": {
        if (!selectedMeas) {
          const next = P.measurements.find((m) => m.x == null);
          if (!next) { alert("Import measurements first, then pick one in the list on the right."); break; }
          selectedMeas = next;
        }
        snapshot();
        selectedMeas.x = x; selectedMeas.y = y;
        selectedMeas = P.measurements.find((m) => m.x == null) || null;  // move on to the next unpinned
        changed();
        break;
      }
      case "label": {
        const t = prompt("Label text (e.g. Kitchen):");
        if (t) { snapshot(); P.labels.push({ x, y, text: t }); changed(); }
        break;
      }
      case "erase": {
        const h = hitTest(x, y);
        if (!h) break;
        snapshot();
        if (h.kind === "ap") P.aps = P.aps.filter((a) => a !== h.obj);
        if (h.kind === "sug") P.suggested = P.suggested.filter((a) => a !== h.obj);
        if (h.kind === "wall" || h.kind === "wallEnd") P.walls = P.walls.filter((w) => w !== h.obj);
        if (h.kind === "label") P.labels = P.labels.filter((l) => l !== h.obj);
        if (h.kind === "area") P.areas = P.areas.filter((a) => a !== h.obj);
        if (h.kind === "meas") { h.obj.x = null; h.obj.y = null; }
        if (h.kind !== "sug") P.suggested = [];
        changed();
        break;
      }
    }
    requestAnimationFrame(draw);
  });

  cv.addEventListener("mousemove", (e) => {
    const p = toCanvas(e);
    mouse = { ...p, shift: e.shiftKey, inside: true };
    if (drag) {
      const o = drag.obj;
      if (drag.kind === "wallEnd") { if (drag.end === 1) { o.x1 = p.x; o.y1 = p.y; } else { o.x2 = p.x; o.y2 = p.y; } }
      else { o.x = p.x; o.y = p.y; }
      if (drag.kind === "sug" && o.link) {
        const others = allNodes().filter((n) => n !== o);
        const b = bestRssi(others, o.x, o.y);
        o.link = { rssi: b.rssi, from: b.from.name };
      }
      if (drag.kind !== "meas" && drag.kind !== "label" && drag.kind !== "sug") P.suggested = [];
      dirty = true;
    }
    requestAnimationFrame(draw);
  });
  cv.addEventListener("mouseleave", () => { mouse.inside = false; requestAnimationFrame(draw); });

  window.addEventListener("mouseup", () => {
    if (drag) { drag = null; changed(); }
    if (draft && draft.type === "area") {
      const r = { x: draft.x, y: draft.y, w: mouse.x - draft.x, h: mouse.y - draft.y };
      draft = null;
      if (Math.abs(r.w) > 10 && Math.abs(r.h) > 10) { snapshot(); P.areas.push(r); P.suggested = []; changed(); }
      requestAnimationFrame(draw);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.matches?.("input, select, textarea")) return;
    if (e.key === "Escape") { draft = null; requestAnimationFrame(draw); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
    const map = { m: "move", s: "scale", w: "wall", r: "ap", a: "area", p: "pin", t: "label", e: "erase" };
    const t = map[e.key.toLowerCase()];
    if (t && !e.ctrlKey && !e.metaKey) setTool(t);
  });
  window.addEventListener("keyup", (e) => { mouse.shift = e.shiftKey; });

  function setTool(t) {
    tool = t; draft = null;
    document.querySelectorAll("#tools [data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    $("materialBox").style.visibility = t === "wall" ? "visible" : "hidden";
    $("hint").textContent = HINTS[t];
    cv.style.cursor = t === "move" ? "default" : "crosshair";
    requestAnimationFrame(draw);
  }
  document.querySelectorAll("#tools [data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));

  // measurements table: click a row to select it for pinning
  $("measTable").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-i]");
    if (!tr) return;
    selectedMeas = P.measurements[+tr.dataset.i];
    setTool("pin");
    $("hint").textContent = `Click where you stood for "${selectedMeas.place}".`;
    dirty = true; requestAnimationFrame(draw);
  });

  // ------------------------------------------------------------ settings UI
  const MAT_SELECT = $("material");
  for (const [k, m] of Object.entries(MATERIALS)) MAT_SELECT.add(new Option(`${m.name}`, k));
  MAT_SELECT.value = material;
  MAT_SELECT.addEventListener("change", () => (material = MAT_SELECT.value));
  function refreshMaterialLabels() {
    for (const o of MAT_SELECT.options) o.textContent = `${MATERIALS[o.value].name} (−${MATERIALS[o.value].loss[P.settings.band]} dB)`;
  }

  function syncSettings() {
    const S = P.settings;
    $("band").value = S.band;
    $("threshold").value = S.threshold; $("thrVal").textContent = S.threshold + " dBm";
    $("backhaul").value = S.backhaul; $("bhVal").textContent = S.backhaul + " dBm";
    $("mesh").checked = S.mesh;
    $("backhaul").disabled = !S.mesh;
    $("maxNew").value = S.maxNew;
    $("p1m").value = S.p1m; $("p1mVal").textContent = S.p1m + " dBm";
    $("nExp").value = S.n; $("nVal").textContent = S.n.toFixed(1);
    refreshMaterialLabels();
  }
  function bindSetting(id, key, parse, resetSug = true) {
    $(id).addEventListener("input", () => {
      P.settings[key] = parse($(id));
      if (resetSug) P.suggested = [];
      syncSettings(); changed();
    });
  }
  bindSetting("threshold", "threshold", (el) => +el.value);
  bindSetting("backhaul", "backhaul", (el) => +el.value);
  bindSetting("mesh", "mesh", (el) => el.checked);
  bindSetting("maxNew", "maxNew", (el) => Math.max(1, Math.min(6, +el.value || 1)));
  bindSetting("p1m", "p1m", (el) => +el.value);
  bindSetting("nExp", "n", (el) => +el.value);
  $("band").addEventListener("change", () => {
    const old = P.settings.band;
    P.settings.band = $("band").value;
    // keep any calibration offset, just move to the new band's default
    P.settings.p1m += DEFAULT_P1M[P.settings.band] - DEFAULT_P1M[old];
    P.suggested = []; syncSettings(); changed();
  });

  $("btnSuggest").addEventListener("click", () => {
    const b = $("btnSuggest");
    b.disabled = true; b.textContent = "Thinking…";
    setTimeout(() => {
      snapshot();
      suggest();
      b.disabled = false; b.textContent = "Suggest next device";
      changed();
    }, 20);
  });
  $("btnClearSug").addEventListener("click", () => { P.suggested = []; changed(); });
  $("btnCalib").addEventListener("click", () => { snapshot(); calibrate(); });

  // ------------------------------------------------------------ files
  $("fileImage").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        snapshot();
        // keep big scans manageable
        const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
        P.image = rd.result; P.w = Math.round(im.naturalWidth * k); P.h = Math.round(im.naturalHeight * k);
        img = im; resize(); setTool("scale"); changed();
        $("hint").textContent = "Floor plan loaded. First set the scale: " + HINTS.scale;
      };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
    e.target.value = "";
  });

  $("fileCsv").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      const rows = parseCsv(txt);
      const got = rows.map((r) => ({
        place: r.place || r.spot || r.name,
        rssi: num(r.rssi_median ?? r.rssi),
        loss: num(r.loss_pct ?? r.loss) ?? 0,
        x: null, y: null,
      })).filter((m) => m.place && m.rssi != null);
      if (!got.length) { alert("No measurements found. Expected columns: place, rssi_median, loss_pct (from measure.py)."); return; }
      snapshot();
      P.measurements = P.measurements.concat(got);
      selectedMeas = got[0];
      setTool("pin");
      $("hint").textContent = `Imported ${got.length} spots. Click where you stood for "${got[0].place}" (then the next one, and so on).`;
      changed();
    });
    e.target.value = "";
  });
  const num = (v) => (v === undefined || v === "" || v === null || isNaN(+v) ? null : +v);
  function parseCsv(txt) {
    const lines = txt.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const split = (l) => {
      const out = []; let cur = "", q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === "," && !q) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur); return out.map((s) => s.trim());
    };
    const head = split(lines[0]).map((h) => h.toLowerCase());
    return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
  }

  $("btnSave").addEventListener("click", () => {
    download(new Blob([JSON.stringify(P, null, 1)], { type: "application/json" }), "wifi-plan.json");
  });
  $("fileProject").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((t) => { try { snapshot(); load(JSON.parse(t)); } catch { alert("That file is not a project saved by this planner."); } });
    e.target.value = "";
  });
  $("btnPng").addEventListener("click", () => cv.toBlob((b) => download(b, "wifi-coverage.png")));
  $("btnDemo").addEventListener("click", () => { if (window.DEMO_PROJECT) { snapshot(); load(structuredClone(window.DEMO_PROJECT)); } });
  $("btnNew").addEventListener("click", () => { if (confirm("Start a new empty plan? (Ctrl+Z brings the old one back)")) { snapshot(); load(blank()); } });

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function load(p) {
    const b = blank();
    P = { ...b, ...p, settings: { ...b.settings, ...(p.settings || {}) } };
    selectedMeas = null;
    img = null;
    if (P.image) {
      const im = new Image();
      im.onload = () => { img = im; requestAnimationFrame(draw); };
      im.src = P.image;
    }
    resize(); syncSettings(); changed();
  }
  function resize() { cv.width = P.w; cv.height = P.h; }

  // ------------------------------------------------------------ start
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("wcp-project") || "null"); } catch {}
  load(saved || structuredClone(window.DEMO_PROJECT || blank()));
  setTool("move");

  // for tests in the browser console
  window.WCP = { get project() { return P; }, suggest: () => { suggest(); changed(); }, calibrate, load, rssiFrom };
})();
