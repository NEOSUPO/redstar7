import { pointInRoom } from "./geometry.js?v=20261022d";
import { openingCenter } from "./openings.js?v=20261022f";

export const GRADES = [
  { id: "A", name: "無菌操作区域", short: "A", color: "#f3b183", pressure: 45 },
  { id: "B", name: "グレードB", short: "B", color: "#f6e27a", pressure: 30 },
  { id: "C", name: "グレードC", short: "C", color: "#d7ecc4", pressure: 15 },
  { id: "D", name: "グレードD", short: "D", color: "#d4e4f6", pressure: 10 },
  { id: "N", name: "一般環境", short: "一般", color: "#f7f7f7", pressure: 0 },
];

export const FLOWS = [
  { id: "enter", name: "入室", color: "#e10600", dash: false },
  { id: "exit", name: "退室", color: "#e10600", dash: true },
  { id: "in", name: "搬入", color: "#2a62c9", dash: false },
  { id: "out", name: "搬出", color: "#2a62c9", dash: true },
  { id: "waste", name: "搬出（廃棄物）", color: "#2e8b57", dash: true },
];

const ROLES = [
  { id: "person", name: "人用エアロック" },
  { id: "material", name: "物用エアロック" },
  { id: "pass", name: "パスボックス" },
];

const RANK = { A: 4, B: 3, C: 2, D: 1, N: 0 };

export const ENV_HEADERS = ["kind", "id", "name", "grade", "pressure", "handwash", "flow", "x1", "y1", "x2", "y2", "role"];

export function gradeById(id) {
  return GRADES.find((entry) => entry.id === id) || null;
}

export function flowById(id) {
  return FLOWS.find((entry) => entry.id === id) || FLOWS[0];
}

export function envVisible(ui) {
  return ui.tab === "env" || (ui.tab === "present" && ui.showEnv);
}

export function envPrompt(ui) {
  if (ui.tool === "env-flow") {
    const flow = flowById(ui.envFlow);
    return `${flow.name}：始点を押したまま、終点までドラッグ`;
  }
  if (ui.tool === "select") return "部屋か線をクリックして選ぶ。Deleteで線を消します";
  const grade = gradeById(ui.envGrade);
  return grade ? `${grade.name}：部屋をクリックして塗る` : "部屋をクリックすると清浄度を消します";
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeEnv(plan) {
  for (const room of plan.rooms || []) {
    room.grade = gradeById(room.grade) ? room.grade : "";
    const pressure = Number(room.pressure);
    room.pressure = room.pressure == null || room.pressure === "" || !Number.isFinite(pressure) ? null : pressure;
    room.handwash = !!room.handwash;
  }
  for (const opening of plan.openings || []) {
    opening.envRole = ROLES.some((role) => role.id === opening.envRole) ? opening.envRole : "";
  }
  plan.flows = (Array.isArray(plan.flows) ? plan.flows : []).map((flow) => ({
    id: flow.id || uid(),
    kind: FLOWS.some((entry) => entry.id === flow.kind) ? flow.kind : "enter",
    x1: num(flow.x1),
    y1: num(flow.y1),
    x2: num(flow.x2),
    y2: num(flow.y2),
  })).filter((flow) => Math.hypot(flow.x2 - flow.x1, flow.y2 - flow.y1) > 40);
}

export function paintRoom(room, gradeId) {
  const grade = gradeById(gradeId);
  room.grade = grade ? grade.id : "";
  room.pressure = grade ? grade.pressure : null;
}

export function addFlow(plan, kind, a, b) {
  const flow = {
    id: uid(),
    kind: FLOWS.some((entry) => entry.id === kind) ? kind : "enter",
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
  };
  plan.flows.push(flow);
  return flow;
}

export function envToRows(plan) {
  const rows = [];
  for (const room of plan.rooms || []) {
    if (!room.grade && room.pressure == null && !room.handwash) continue;
    rows.push({
      kind: "room",
      id: room.id,
      name: room.name || "",
      grade: room.grade || "",
      pressure: room.pressure == null ? "" : room.pressure,
      handwash: room.handwash ? "1" : "",
    });
  }
  for (const flow of plan.flows || []) {
    rows.push({
      kind: "flow",
      id: flow.id,
      flow: flow.kind,
      x1: Math.round(flow.x1),
      y1: Math.round(flow.y1),
      x2: Math.round(flow.x2),
      y2: Math.round(flow.y2),
    });
  }
  for (const opening of plan.openings || []) {
    if (!opening.envRole) continue;
    rows.push({ kind: "opening", id: opening.id, role: opening.envRole });
  }
  return rows;
}

export function applyEnvRows(plan, rows) {
  plan.flows = [];
  for (const row of rows || []) {
    if (row.kind === "room") {
      const room = plan.rooms.find((entry) => entry.id === String(row.id));
      if (!room) continue;
      room.grade = gradeById(row.grade) ? row.grade : "";
      const pressure = Number(row.pressure);
      room.pressure = row.pressure === "" || row.pressure == null || !Number.isFinite(pressure) ? null : pressure;
      room.handwash = String(row.handwash) === "1";
    } else if (row.kind === "flow") {
      plan.flows.push({
        id: String(row.id || uid()),
        kind: row.flow,
        x1: num(row.x1),
        y1: num(row.y1),
        x2: num(row.x2),
        y2: num(row.y2),
      });
    } else if (row.kind === "opening") {
      const opening = plan.openings.find((entry) => entry.id === String(row.id));
      if (opening && ROLES.some((role) => role.id === row.role)) opening.envRole = row.role;
    }
  }
}

function roomAt(plan, x, y) {
  return (plan.rooms || []).find((room) => pointInRoom(room, x, y)) || null;
}

export function openingSides(plan, opening) {
  const room = plan.rooms.find((entry) => entry.id === opening.roomId);
  if (!room) return null;
  const center = openingCenter(room, opening);
  const n = center.wall.inwardAt(center.along);
  const deep = 280;
  return {
    center: { x: center.x, y: center.y },
    normal: n,
    a: roomAt(plan, center.x + n.x * deep, center.y + n.y * deep),
    b: roomAt(plan, center.x - n.x * deep, center.y - n.y * deep),
  };
}

export function pressureMarks(plan) {
  const marks = [];
  for (const opening of plan.openings || []) {
    const sides = openingSides(plan, opening);
    if (!sides?.a || !sides?.b || sides.a.id === sides.b.id) continue;
    if (sides.a.pressure == null || sides.b.pressure == null) continue;
    if (Math.abs(sides.a.pressure - sides.b.pressure) < 0.5) continue;
    const inwardHigh = sides.a.pressure >= sides.b.pressure;
    const n = sides.normal;
    const reach = 340;
    marks.push({
      id: opening.id,
      x1: sides.center.x + (inwardHigh ? n.x : -n.x) * reach,
      y1: sides.center.y + (inwardHigh ? n.y : -n.y) * reach,
      x2: sides.center.x + (inwardHigh ? -n.x : n.x) * reach,
      y2: sides.center.y + (inwardHigh ? -n.y : n.y) * reach,
    });
  }
  return marks;
}

function distToSeg(x, y, flow) {
  const dx = flow.x2 - flow.x1;
  const dy = flow.y2 - flow.y1;
  const len = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((x - flow.x1) * dx + (y - flow.y1) * dy) / len));
  return Math.hypot(x - (flow.x1 + dx * t), y - (flow.y1 + dy * t));
}

export function hitFlow(plan, x, y, scale) {
  const bodyTol = 14 / Math.max(scale, 0.01);
  const endTol = 22 / Math.max(scale, 0.01);
  let best = null;
  for (const flow of plan.flows || []) {
    const hits = [
      { handle: "start", dist: Math.hypot(x - flow.x1, y - flow.y1), limit: endTol },
      { handle: "end", dist: Math.hypot(x - flow.x2, y - flow.y2), limit: endTol },
      { handle: "body", dist: distToSeg(x, y, flow), limit: bodyTol },
    ];
    for (const hit of hits) {
      if (hit.dist > hit.limit) continue;
      if (!best || hit.dist < best.dist) best = { id: flow.id, dist: hit.dist, handle: hit.handle };
    }
  }
  return best;
}

function segmentsCross(a, b) {
  const rx = a.x2 - a.x1;
  const ry = a.y2 - a.y1;
  const sx = b.x2 - b.x1;
  const sy = b.y2 - b.y1;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-6) return false;
  const t = ((b.x1 - a.x1) * sy - (b.y1 - a.y1) * sx) / den;
  const u = ((b.x1 - a.x1) * ry - (b.y1 - a.y1) * rx) / den;
  return t > 0.08 && t < 0.92 && u > 0.08 && u < 0.92;
}

function roleName(id) {
  return ROLES.find((role) => role.id === id)?.name || "";
}

export function envChecks(plan) {
  const notes = [];
  for (const opening of plan.openings || []) {
    const sides = openingSides(plan, opening);
    if (!sides?.a || !sides?.b || sides.a.id === sides.b.id) continue;
    const ra = RANK[sides.a.grade];
    const rb = RANK[sides.b.grade];
    if (ra == null || rb == null) continue;
    const cleaner = ra >= rb ? sides.a : sides.b;
    const other = cleaner === sides.a ? sides.b : sides.a;
    if (Math.abs(ra - rb) >= 2 && !opening.envRole) {
      notes.push({
        kind: "opening",
        id: opening.id,
        text: `${cleaner.name}と${other.name}は清浄度が離れています。開口にエアロックかパスボックスを指定してください`,
      });
    }
    if (cleaner.pressure != null && other.pressure != null && cleaner.pressure < other.pressure) {
      notes.push({
        kind: "room",
        id: cleaner.id,
        text: `${cleaner.name}の室圧が、清浄度の低い${other.name}より低くなっています`,
      });
    }
    if (ra !== rb && cleaner.pressure != null && other.pressure != null && cleaner.pressure === other.pressure) {
      notes.push({
        kind: "room",
        id: cleaner.id,
        text: `${cleaner.name}と${other.name}は清浄度が違うのに、室圧が同じです`,
      });
    }
    if ((cleaner.grade === "A" || cleaner.grade === "B") && other.handwash) {
      notes.push({
        kind: "room",
        id: other.id,
        text: `${other.name}の手洗いは、${cleaner.name}へ直接入る更衣室には置きません`,
      });
    }
  }
  for (const flow of plan.flows || []) {
    if (flow.kind !== "waste") continue;
    const from = roomAt(plan, flow.x1, flow.y1);
    const to = roomAt(plan, flow.x2, flow.y2);
    if (!from || !to || RANK[from.grade] == null || RANK[to.grade] == null) continue;
    if (RANK[to.grade] > RANK[from.grade]) {
      notes.push({
        kind: "flow",
        id: flow.id,
        text: `廃棄物の矢印が、${from.name}からより清浄な${to.name}へ向いています`,
      });
    }
  }
  const guarded = (plan.rooms || []).filter((room) => room.grade === "A" || room.grade === "B");
  for (const room of guarded) {
    const enters = (plan.flows || []).some((flow) => flow.kind === "enter" && roomAt(plan, flow.x2, flow.y2)?.id === room.id);
    const exits = (plan.flows || []).some((flow) => flow.kind === "exit" && (roomAt(plan, flow.x1, flow.y1)?.id === room.id || roomAt(plan, flow.x2, flow.y2)?.id === room.id));
    if (enters && !exits) {
      notes.push({ kind: "room", id: room.id, text: `${room.name}に入室の矢印があります。退室の矢印も引いてください` });
    }
  }
  const people = (plan.flows || []).filter((flow) => flow.kind !== "waste");
  const waste = (plan.flows || []).filter((flow) => flow.kind === "waste");
  for (const flow of people) {
    const hit = waste.find((other) => segmentsCross(flow, other));
    if (!hit) continue;
    notes.push({
      kind: "flow",
      id: flow.id,
      text: `${flowById(flow.kind).name}の動線が、廃棄物の動線と交差しています`,
    });
    break;
  }
  for (const opening of plan.openings || []) {
    const sides = openingSides(plan, opening);
    if (!sides) continue;
    const high = [sides.a, sides.b].some((room) => room && (room.grade === "A" || room.grade === "B"));
    if (!high) continue;
    const near = (kind) => (plan.flows || []).some((flow) => flow.kind === kind && distToSeg(sides.center.x, sides.center.y, flow) < 500);
    if (near("enter") && near("exit")) {
      notes.push({
        kind: "opening",
        id: opening.id,
        text: "入室と退室が同じ開口の近くを通っています。グレードBでは入口と出口を分けてください",
      });
    }
  }
  return notes;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function swatch(color, label, extra = "") {
  return `<span class="env-swatch" style="background:${color}"></span><span>${escapeHtml(label)}</span>${extra}`;
}

export function envPanel(plan, ui) {
  const room = ui.selection?.kind === "room"
    ? plan.rooms.find((entry) => entry.id === ui.selection.ids[0])
    : null;
  const opening = ui.selection?.kind === "opening"
    ? plan.openings.find((entry) => entry.id === ui.selection.ids[0])
    : null;
  const flow = ui.selection?.kind === "flow"
    ? (plan.flows || []).find((entry) => entry.id === ui.selection.ids[0])
    : null;
  const grades = GRADES.map((grade) => `
    <button type="button" data-grade="${grade.id}" class="${ui.tool === "env-grade" && ui.envGrade === grade.id ? "active" : ""}">${swatch(grade.color, grade.name)}</button>
  `).join("");
  const flows = FLOWS.map((entry) => `
    <button type="button" data-flow="${entry.id}" class="${ui.tool === "env-flow" && ui.envFlow === entry.id ? "active" : ""}">${swatch(entry.color, entry.name, entry.dash ? `<span class="env-dash"></span>` : `<span class="env-solid"></span>`)}</button>
  `).join("");
  const pressure = room ? `
    <p class="note">${escapeHtml(room.name)} の室圧です。一般環境を 0 とした目安で、あとから変えられます。</p>
    <label>室圧 Pa
      <input id="env-pa" type="number" step="1" value="${room.pressure == null ? "" : room.pressure}" />
    </label>
    <div class="env-choices env-pa">
      <button type="button" data-pa="30">B +30</button>
      <button type="button" data-pa="15">C +15</button>
      <button type="button" data-pa="10">D +10</button>
      <button type="button" data-pa="0">一般 0</button>
      <button type="button" data-pa="-10">廃棄 -10</button>
    </div>
    <label class="check"><input id="env-wash" type="checkbox" ${room.handwash ? "checked" : ""} /> この部屋に手洗いがある</label>
  ` : `<p class="note">部屋を選ぶと、室圧と手洗いを入れられます。</p>`;
  const airlock = opening ? `
    <p class="note">選んだ開口の役割です。清浄度が離れる境目に付けます。</p>
    <div class="env-choices">
      ${ROLES.map((role) => `<button type="button" data-role="${role.id}" class="${opening.envRole === role.id ? "active" : ""}">${escapeHtml(role.name)}</button>`).join("")}
      <button type="button" data-role="" class="${opening.envRole ? "" : "active"}">指定しない</button>
    </div>
  ` : "";
  const picked = flow ? `
    <p class="note">選んだ線は${escapeHtml(flowById(flow.kind).name)}です。線をドラッグで移動、端点をドラッグで向きと長さを変えられます。</p>
    <div class="env-flow-tools">
      <button type="button" id="env-flow-flip">向きを反転</button>
      <button type="button" id="env-flow-del">この線を削除</button>
    </div>
  ` : "";
  const notes = envChecks(plan);
  const checks = notes.length
    ? notes.map((note) => `<button type="button" class="env-warn" data-focus-kind="${note.kind}" data-focus-id="${escapeHtml(note.id)}">${escapeHtml(note.text)}</button>`).join("")
    : `<p class="note">いまの図に、動線や室圧の矛盾はありません。</p>`;
  return `
    <div class="side-block env-steps">
      <h2>環境</h2>
      <p class="env-now">${escapeHtml(envPrompt(ui))}</p>
      <label class="check"><input id="show-env-legend" type="checkbox" ${ui.showEnvLegend !== false ? "checked" : ""} /> 凡例を表示</label>
      <section class="env-step">
        <h3>1. 清浄度を塗る</h3>
        <p class="note">部屋を1つ塗ると選択に戻ります。続けて塗るときは、もう一度色を選んでください。</p>
        <div class="env-choices">${grades}</div>
        <button type="button" data-grade="" class="${ui.tool === "env-grade" && !ui.envGrade ? "active" : ""}">塗った色を消す</button>
      </section>
      <section class="env-step">
        <h3>2. 室圧を入れる</h3>
        <button type="button" id="env-pick" class="${ui.tool === "select" ? "active" : ""}">部屋・開口・線を選ぶ</button>
        ${pressure}
        ${airlock}
        ${picked}
      </section>
      <section class="env-step">
        <h3>3. 動線を引く</h3>
        <p class="note">赤は人、青は物、緑の破線は廃棄物です。始点から終点までドラッグします。1本引くと選択に戻ります。あとから線や端点をドラッグして移動・向きを変えられます。</p>
        <div class="env-choices">${flows}</div>
      </section>
      <section class="env-step">
        <h3>確認</h3>
        ${checks}
      </section>
    </div>
  `;
}

export function bindEnv(sidebar, store, ui) {
  const refresh = () => ui.select(ui.selection);
  sidebar.querySelectorAll("[data-grade]").forEach((button) => {
    button.addEventListener("click", () => ui.setEnvGrade(button.dataset.grade || ""));
  });
  sidebar.querySelectorAll("[data-flow]").forEach((button) => {
    button.addEventListener("click", () => ui.setEnvFlow(button.dataset.flow));
  });
  sidebar.querySelector("#env-pick")?.addEventListener("click", () => ui.setTool("select"));
  sidebar.querySelector("#show-env-legend")?.addEventListener("change", (event) => {
    ui.setShowEnvLegend(event.target.checked);
  });
  sidebar.querySelector("#env-pa")?.addEventListener("change", (event) => {
    const roomId = ui.selection?.kind === "room" ? ui.selection.ids[0] : null;
    if (!roomId) return;
    const raw = event.target.value.trim();
    store.update((plan) => {
      const room = plan.rooms.find((entry) => entry.id === roomId);
      if (!room) return;
      room.pressure = raw === "" ? null : Number(raw);
    });
    refresh();
  });
  sidebar.querySelector("#env-wash")?.addEventListener("change", (event) => {
    const roomId = ui.selection?.kind === "room" ? ui.selection.ids[0] : null;
    if (!roomId) return;
    store.update((plan) => {
      const room = plan.rooms.find((entry) => entry.id === roomId);
      if (room) room.handwash = event.target.checked;
    });
    refresh();
  });
  sidebar.querySelectorAll("[data-pa]").forEach((button) => {
    button.addEventListener("click", () => {
      const roomId = ui.selection?.kind === "room" ? ui.selection.ids[0] : null;
      if (!roomId) return;
      store.update((plan) => {
        const room = plan.rooms.find((entry) => entry.id === roomId);
        if (room) room.pressure = Number(button.dataset.pa);
      });
      refresh();
    });
  });
  sidebar.querySelectorAll("[data-role]").forEach((button) => {
    button.addEventListener("click", () => {
      const openingId = ui.selection?.kind === "opening" ? ui.selection.ids[0] : null;
      if (!openingId) return;
      store.update((plan) => {
        const opening = plan.openings.find((entry) => entry.id === openingId);
        if (opening) opening.envRole = button.dataset.role || "";
      });
      refresh();
    });
  });
  sidebar.querySelectorAll("[data-focus-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.setTool("select");
      ui.select({ kind: button.dataset.focusKind, ids: [button.dataset.focusId] });
    });
  });
  sidebar.querySelector("#env-flow-flip")?.addEventListener("click", () => {
    const flowId = ui.selection?.kind === "flow" ? ui.selection.ids[0] : null;
    if (!flowId) return;
    store.update((plan) => {
      const flow = plan.flows.find((entry) => entry.id === flowId);
      if (!flow) return;
      const x1 = flow.x1;
      const y1 = flow.y1;
      flow.x1 = flow.x2;
      flow.y1 = flow.y2;
      flow.x2 = x1;
      flow.y2 = y1;
    });
    refresh();
  });
  sidebar.querySelector("#env-flow-del")?.addEventListener("click", () => {
    const flowId = ui.selection?.kind === "flow" ? ui.selection.ids[0] : null;
    if (!flowId) return;
    store.update((plan) => {
      plan.flows = (plan.flows || []).filter((entry) => entry.id !== flowId);
    });
    ui.select(null);
  });
}

function arrow(ctx, screen, flow, color, dashed, width, head = true) {
  const a = screen(flow.x1, flow.y1);
  const b = screen(flow.x2, flow.y2);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const size = head ? 12 : 0;
  const tipX = b.x - Math.cos(ang) * size * 0.72;
  const tipY = b.y - Math.sin(ang) * size * 0.72;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dashed ? [10, 7] : []);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(head ? tipX : b.x, head ? tipY : b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (head) {
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - size * Math.cos(ang - 0.45), b.y - size * Math.sin(ang - 0.45));
    ctx.lineTo(b.x - size * Math.cos(ang + 0.45), b.y - size * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function legend(ctx, rect) {
  const rows = [
    ...GRADES.map((grade) => ({ color: grade.color, dash: false, label: grade.id === "N" ? "一般環境" : grade.id === "A" ? "無菌操作区域" : `清浄度区域 ${grade.name}` })),
    ...FLOWS.map((flow) => ({ color: flow.color, dash: flow.dash, label: flow.name })),
  ];
  const width = 168;
  const height = 16 + rows.length * 16;
  const x = 12;
  const y = Math.max(12, rect.height - height - 12);
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.strokeStyle = "rgba(36,48,64,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.font = "11px sans-serif";
  ctx.textBaseline = "middle";
  rows.forEach((row, index) => {
    const yy = y + 14 + index * 16;
    ctx.strokeStyle = row.color;
    ctx.fillStyle = row.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(row.dash ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(x + 10, yy);
    ctx.lineTo(x + 28, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#243040";
    ctx.textAlign = "left";
    ctx.fillText(row.label, x + 36, yy);
  });
  ctx.restore();
}

export function drawEnv(ctx, plan, ui, screen, scale, rect) {
  if (!envVisible(ui)) return;
  for (const flow of plan.flows || []) {
    const spec = flowById(flow.kind);
    const selected = ui.selection?.kind === "flow" && ui.selection.ids.includes(flow.id);
    if (selected) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      arrow(ctx, screen, flow, "#0060b0", spec.dash, 6, false);
      ctx.restore();
    }
    arrow(ctx, screen, flow, spec.color, spec.dash, 2.5);
    if (selected) {
      for (const point of [{ x: flow.x1, y: flow.y1 }, { x: flow.x2, y: flow.y2 }]) {
        const at = screen(point.x, point.y);
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#0060b0";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  for (const mark of pressureMarks(plan)) {
    arrow(ctx, screen, mark, "#243040", false, 1.5);
  }
  ctx.save();
  ctx.fillStyle = "#243040";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  for (const opening of plan.openings || []) {
    if (!opening.envRole) continue;
    const sides = openingSides(plan, opening);
    if (!sides) continue;
    const at = screen(sides.center.x, sides.center.y);
    ctx.fillText(roleName(opening.envRole), at.x, at.y - 10);
  }
  ctx.restore();
  if (ui.tab === "env") {
    const text = envPrompt(ui);
    ctx.save();
    ctx.font = "13px sans-serif";
    const width = ctx.measureText(text).width + 24;
    const x = Math.max(12, (rect.width - width) / 2);
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.strokeStyle = "rgba(36,48,64,0.16)";
    ctx.beginPath();
    ctx.roundRect(x, 12, width, 30, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1d3410";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 12, 27);
    ctx.restore();
  }
  if (ui.showEnvLegend !== false) legend(ctx, rect);
}

export function gradeFill(room) {
  return gradeById(room.grade)?.color || "";
}
