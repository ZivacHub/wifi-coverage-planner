// Demo places so the planner shows something on first open.
// Everything here is MADE UP: the plans and the measurements (marked "demo")
// are example numbers, not real readings. Replace them with your own floor
// plan and the CSV from measure.py.
(() => {
  const DEMOS = {};

  // ------------------------------------------------------------ 1. House
  {
    const S = 55, O = 50;                 // 55 px = 1 m, 50 px margin
    const p = (m) => O + m * S;
    const W = (x1, y1, x2, y2, mat) => ({ x1: p(x1), y1: p(y1), x2: p(x2), y2: p(y2), mat });
    const walls = [
      // outside walls (brick)
      W(0, 0, 14, 0, "brick"), W(14, 0, 14, 9, "brick"), W(14, 9, 0, 9, "brick"), W(0, 9, 0, 0, "brick"),
      // middle load-bearing wall with doors
      W(0, 5, 2, 5, "brick"), W(2, 5, 3, 5, "door"), W(3, 5, 7, 5, "brick"), W(7, 5, 8, 5, "door"), W(8, 5, 14, 5, "brick"),
      // living | kitchen
      W(6, 0, 6, 3, "drywall"), W(6, 3, 6, 4, "door"), W(6, 4, 6, 5, "drywall"),
      // kitchen | bedroom, fridge
      W(10, 0, 10, 3.5, "drywall"), W(10, 3.5, 10, 4.5, "door"), W(10, 4.5, 10, 5, "drywall"),
      W(9.2, 0.2, 9.8, 0.2, "metal"),
      // bathroom (tiles + concrete) and stairs to the basement
      W(3, 5, 3, 9, "concrete"), W(6, 5, 6, 9, "brick"),
    ];
    DEMOS.house = {
      name: "House (one floor)",
      hint: "Demo house, made-up numbers. Press \"Suggest next device\" to see where a mesh node would go.",
      project: {
        version: 1, demo: true, image: null, w: O * 2 + 14 * S, h: O * 2 + 9 * S, pxPerM: S,
        walls,
        aps: [{ x: p(1), y: p(1), name: "Router 1" }],
        areas: [],
        labels: [
          { x: p(3), y: p(2.5), text: "Living room" }, { x: p(8), y: p(2.5), text: "Kitchen" },
          { x: p(12), y: p(2.5), text: "Bedroom" }, { x: p(1.5), y: p(7), text: "Bathroom" },
          { x: p(4.5), y: p(7), text: "Stairs" }, { x: p(10), y: p(7), text: "Bedroom 2" },
        ],
        measurements: [
          { place: "living (demo)",  rssi: -55, loss: 0,  x: p(3),    y: p(3.5) },
          { place: "kitchen (demo)", rssi: -72, loss: 3,  x: p(8),    y: p(3.8) },
          { place: "stairs (demo)",  rssi: -77, loss: 6,  x: p(4.5),  y: p(6) },
          { place: "bedroom (demo)", rssi: -84, loss: 18, x: p(12.5), y: p(3.5) },
          { place: "bed 2 (demo)",   rssi: -91, loss: 55, x: p(9),    y: p(7.5) },
        ],
        suggested: [],
        settings: { band: "5", threshold: -75, backhaul: -70, mesh: true, maxNew: 3, p1m: -45, n: 3.0, look: "normal", fade: 0.25 },
      },
    };
  }

  // ------------------------------------------------------------ 2. Office floor on a blue blueprint
  // The blueprint picture is drawn right here (no image file needed), white
  // lines on blue like a real one. The planner shows it as dark lines on white
  // ("Blueprint" look), and the walls are traced on top of it.
  {
    const S = 22, O = 40, WM = 40, HM = 20;   // 40 x 20 m floor, 22 px = 1 m
    const p = (m) => O + m * S;
    const W = (x1, y1, x2, y2, mat) => ({ x1: p(x1), y1: p(y1), x2: p(x2), y2: p(y2), mat });
    const box = (x, y, w, h, mat) => [W(x, y, x + w, y, mat), W(x + w, y, x + w, y + h, mat), W(x + w, y + h, x, y + h, mat), W(x, y + h, x, y, mat)];
    const walls = [
      // outside: concrete, the south side is a glass facade
      W(0, 0, 40, 0, "concrete"), W(40, 0, 40, 20, "concrete"), W(40, 20, 0, 20, "glass"), W(0, 20, 0, 0, "concrete"),
      // meeting rooms with glass fronts
      W(8, 0, 8, 6, "drywall"), W(0, 6, 6.5, 6, "glass"), W(6.5, 6, 7.5, 6, "door"), W(7.5, 6, 8, 6, "glass"),
      W(14, 0, 14, 6, "drywall"), W(8, 6, 12.5, 6, "glass"), W(12.5, 6, 13.5, 6, "door"), W(13.5, 6, 14, 6, "glass"),
      // kitchen: open front, a fridge
      W(18.8, 0.3, 19.8, 0.3, "metal"),
      // server room: concrete, metal door, metal racks
      W(30, 0, 30, 6, "concrete"), W(34, 0, 34, 6, "concrete"),
      W(30, 6, 31, 6, "concrete"), W(31, 6, 32, 6, "metal"), W(32, 6, 34, 6, "concrete"),
      W(30.6, 1.2, 33.4, 1.2, "metal"),
      // manager's office
      W(34, 6, 38, 6, "drywall"), W(38, 6, 39, 6, "door"), W(39, 6, 40, 6, "drywall"),
      // lifts + stairs: concrete core in the middle
      ...box(17, 8, 6, 5, "concrete"),
      // toilets
      W(5, 14, 5, 20, "brick"), W(0, 14, 3.5, 14, "brick"), W(3.5, 14, 4.5, 14, "door"), W(4.5, 14, 5, 14, "brick"),
    ];
    const labels = [
      { x: p(4), y: p(3), text: "Meeting A" }, { x: p(11), y: p(3), text: "Meeting B" },
      { x: p(17), y: p(3), text: "Kitchen" }, { x: p(32), y: p(3.6), text: "Server room" },
      { x: p(37), y: p(3), text: "Office" }, { x: p(20), y: p(10.5), text: "Lifts + stairs" },
      { x: p(2.5), y: p(17), text: "Toilets" }, { x: p(10), y: p(16.5), text: "Reception" },
      { x: p(30), y: p(14), text: "Open office" },
    ];
    const w = O * 2 + WM * S, h = O * 2 + HM * S;

    function blueprint() {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#1c4c8f"; g.fillRect(0, 0, w, h);
      // grid: thin every metre, stronger every 5 m
      for (let m = 0; m * S <= Math.max(w, h); m++) {
        g.strokeStyle = m % 5 ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.16)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(m * S + 0.5, 0); g.lineTo(m * S + 0.5, h); g.stroke();
        g.beginPath(); g.moveTo(0, m * S + 0.5); g.lineTo(w, m * S + 0.5); g.stroke();
      }
      g.strokeStyle = "#f2f6ff"; g.fillStyle = "#f2f6ff"; g.lineCap = "square";
      for (const wl of walls) {
        if (wl.mat === "door") {
          // door: a gap with the swing arc
          const r = Math.hypot(wl.x2 - wl.x1, wl.y2 - wl.y1), a = Math.atan2(wl.y2 - wl.y1, wl.x2 - wl.x1);
          g.lineWidth = 1;
          g.beginPath(); g.moveTo(wl.x1, wl.y1); g.arc(wl.x1, wl.y1, r, a, a + Math.PI / 2); g.stroke();
          continue;
        }
        if (wl.mat === "glass") {
          const nx = -(wl.y2 - wl.y1), ny = wl.x2 - wl.x1, L = Math.hypot(nx, ny) || 1;
          g.lineWidth = 1;
          for (const s of [-2, 2]) {
            g.beginPath(); g.moveTo(wl.x1 + (nx / L) * s, wl.y1 + (ny / L) * s); g.lineTo(wl.x2 + (nx / L) * s, wl.y2 + (ny / L) * s); g.stroke();
          }
          continue;
        }
        g.lineWidth = { concrete: 7, brick: 5, metal: 4 }[wl.mat] || 2.5;
        g.beginPath(); g.moveTo(wl.x1, wl.y1); g.lineTo(wl.x2, wl.y2); g.stroke();
      }
      // stairs hatching in the core
      g.lineWidth = 1;
      for (let i = 0; i <= 10; i++) { g.beginPath(); g.moveTo(p(17.4 + i * 0.25), p(8.6)); g.lineTo(p(17.4 + i * 0.25), p(10.4)); g.stroke(); }
      // room names
      g.font = "600 11px Consolas, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
      for (const l of labels) g.fillText(l.text.toUpperCase(), l.x, l.y);
      // dimension line along the top
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(p(0), O / 2); g.lineTo(p(WM), O / 2); g.stroke();
      for (const m of [0, WM]) { g.beginPath(); g.moveTo(p(m), O / 2 - 5); g.lineTo(p(m), O / 2 + 5); g.stroke(); }
      g.fillStyle = "#1c4c8f"; g.fillRect(p(WM / 2) - 34, O / 2 - 8, 68, 16);
      g.fillStyle = "#f2f6ff"; g.fillText("40.00 m", p(WM / 2), O / 2);
      // title block
      g.textAlign = "right"; g.font = "11px Consolas, monospace";
      g.fillText("DEMO OFFICE · FLOOR 2 · MADE-UP PLAN", w - 12, h - 12);
      return c.toDataURL("image/png");
    }

    DEMOS.office = {
      name: "Office floor (blue blueprint)",
      hint: "Demo office on a blue blueprint picture (made up). Under Settings › Floor plan image you can switch between the original blue and dark lines on white.",
      project: {
        version: 1, demo: true, image: blueprint(), w, h, pxPerM: S,
        walls,
        aps: [{ x: p(11), y: p(12), name: "AP 1" }],
        areas: [],
        labels: [],          // the room names are already in the blueprint picture
        measurements: [
          { place: "reception (demo)", rssi: -55, loss: 0,  x: p(10), y: p(15) },
          { place: "meeting A (demo)", rssi: -73, loss: 2,  x: p(4),  y: p(4) },
          { place: "kitchen (demo)",   rssi: -69, loss: 1,  x: p(16), y: p(4) },
          { place: "open S (demo)",    rssi: -76, loss: 6,  x: p(26), y: p(17) },
          { place: "open E (demo)",    rssi: -92, loss: 60, x: p(30), y: p(12) },
        ],
        suggested: [],
        settings: { band: "5", threshold: -75, backhaul: -70, mesh: true, maxNew: 3, p1m: -45, n: 2.8, look: "blueprint", fade: 0 },
      },
    };
  }

  // ------------------------------------------------------------ 3. Small town, outdoor mesh
  // Mesh nodes on rooftops covering streets and a square, e.g. after a storm
  // when the normal network is down. Buildings are boxes of wall: the signal
  // loses a lot going through them.
  {
    const S = 4, O = 30, WM = 220, HM = 140;   // 220 x 140 m, 4 px = 1 m
    const p = (m) => O + m * S;
    const walls = [], labels = [];
    const bld = (x, y, bw, bh, mat, name) => {
      walls.push(
        { x1: p(x), y1: p(y), x2: p(x + bw), y2: p(y), mat }, { x1: p(x + bw), y1: p(y), x2: p(x + bw), y2: p(y + bh), mat },
        { x1: p(x + bw), y1: p(y + bh), x2: p(x), y2: p(y + bh), mat }, { x1: p(x), y1: p(y + bh), x2: p(x), y2: p(y), mat });
      if (name) labels.push({ x: p(x + bw / 2), y: p(y + bh / 2), text: name });
    };
    bld(15, 12, 40, 24, "concrete", "Town hall");
    bld(70, 14, 13, 12, "brick"); bld(88, 14, 13, 12, "brick"); bld(106, 14, 13, 12, "brick", "Houses");
    bld(150, 10, 55, 28, "concrete", "School");
    bld(15, 60, 22, 30, "brick", "Church");
    bld(60, 62, 30, 20, "concrete", "Fire station");
    bld(108, 58, 50, 22, "concrete", "Flats");
    bld(176, 60, 30, 22, "brick", "Shop");
    bld(15, 108, 13, 12, "brick"); bld(34, 108, 13, 12, "brick"); bld(53, 108, 13, 12, "brick", "Houses");
    bld(92, 102, 28, 22, "concrete", "Health centre");
    bld(134, 106, 13, 12, "brick"); bld(152, 106, 13, 12, "brick");
    bld(178, 100, 30, 28, "metal", "Warehouse");
    labels.push(
      { x: p(110), y: p(46), text: "Main street" }, { x: p(110), y: p(93), text: "River road" },
      { x: p(46), y: p(102), text: "Square" });

    DEMOS.town = {
      name: "Small town (outdoor mesh)",
      hint: "Demo town, made up: mesh nodes on rooftops covering the streets (e.g. after a storm). Press \"Suggest next device\".",
      project: {
        version: 1, demo: true, image: null, w: O * 2 + WM * S, h: O * 2 + HM * S, pxPerM: S,
        walls,
        aps: [{ x: p(40), y: p(42), name: "Node 1 (town hall)" }, { x: p(75), y: p(58), name: "Node 2 (fire station)" }],
        areas: [{ x: p(0), y: p(0), w: WM * S, h: HM * S }],
        labels,
        measurements: [
          { place: "square (demo)",   rssi: -71, loss: 0,  x: p(46),  y: p(96) },
          { place: "main st. (demo)", rssi: -64, loss: 0,  x: p(100), y: p(46) },
          { place: "school (demo)",   rssi: -79, loss: 6,  x: p(140), y: p(44) },
          { place: "yard E (demo)",   rssi: -88, loss: 25, x: p(200), y: p(50) },
          { place: "shop (demo)",     rssi: -93, loss: 45, x: p(170), y: p(92) },
        ],
        suggested: [],
        settings: { band: "2.4", threshold: -75, backhaul: -72, mesh: true, maxNew: 4, p1m: -30, n: 2.6, look: "normal", fade: 0.25 },
      },
    };
  }

  window.DEMOS = DEMOS;
  window.DEMO_PROJECT = DEMOS.house.project;   // older name, still used by tests
})();
