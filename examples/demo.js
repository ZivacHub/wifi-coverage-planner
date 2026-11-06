// Demo house so the planner shows something on first open.
// The measurements here are MADE-UP example numbers (marked "demo"),
// not real readings. Replace them with your own CSV from measure.py.
(() => {
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
  window.DEMO_PROJECT = {
    version: 1, image: null, w: O * 2 + 14 * S, h: O * 2 + 9 * S, pxPerM: S,
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
    settings: { band: "5", threshold: -75, backhaul: -70, mesh: true, maxNew: 3, p1m: -45, n: 3.0 },
  };
})();
