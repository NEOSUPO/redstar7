import { pointInRoom } from "./geometry.js?v=20261022d";

const PREF_KEY = "neosupo-star-beta7-specs";
const EXTRAS = [
  ["maker", "メーカー"],
  ["model", "型式"],
  ["weight", "重量"],
  ["price", "単価"],
  ["power", "電気"],
  ["water", "給水+排水"],
  ["air", "給気+排気"],
  ["gas", "特ガス"],
  ["note", "備考"],
];

export function mountSpecs({ store, ui, showItem, groupSelection, ungroupSelection }) {
  const body = document.querySelector("#specs-body");
  const prefs = loadPrefs();
  const state = {
    search: "",
    sort: prefs.sort,
    hideOpenings: prefs.hideOpenings,
    missingOnly: prefs.missingOnly,
    room: prefs.room,
    group: prefs.group,
    columns: prefs.columns,
  };
  let flatIds = [];
  let anchorId = null;
  let fromTable = false;
  let lastSig = "";
  let lastKey = "";

  body.innerHTML = `
    <div class="specs-tools">
      <input id="specs-search" type="search" placeholder="名称・メーカー・型式" aria-label="諸元一覧を検索" />
      <div class="specs-pair">
        <select id="specs-room" aria-label="部屋で絞る"></select>
        <select id="specs-group-filter" aria-label="グループで絞る"></select>
      </div>
      <select id="specs-sort" aria-label="並び順">
        <option value="name">名称順</option>
        <option value="room">部屋順</option>
        <option value="size">寸法順</option>
      </select>
      <div class="specs-checks">
        <label><input id="specs-hide-openings" type="checkbox" /> ドアと窓を除く</label>
        <label><input id="specs-missing" type="checkbox" /> 単価か重量が空</label>
      </div>
      <details id="specs-columns">
        <summary>列</summary>
        <div class="specs-checks">
          ${EXTRAS.map(([key, label]) => `<label><input type="checkbox" data-column="${key}" /> ${label}</label>`).join("")}
        </div>
      </details>
      <div class="specs-actions">
        <button type="button" id="specs-group-btn">グループ</button>
        <button type="button" id="specs-ungroup">グループ解除</button>
      </div>
      <p class="note">行で選択します。Shiftで範囲、Ctrlで追加です。ダブルクリックで図面のその位置へ寄ります。</p>
    </div>
  `;
  const tableHost = document.createElement("div");
  tableHost.id = "specs-table";
  const foot = document.createElement("p");
  foot.className = "note specs-foot";
  body.append(tableHost, foot);

  const search = body.querySelector("#specs-search");
  const roomSelect = body.querySelector("#specs-room");
  const groupSelect = body.querySelector("#specs-group-filter");
  const sortSelect = body.querySelector("#specs-sort");
  const hideOpenings = body.querySelector("#specs-hide-openings");
  const missingOnly = body.querySelector("#specs-missing");
  const groupButton = body.querySelector("#specs-group-btn");
  const ungroupButton = body.querySelector("#specs-ungroup");
  sortSelect.value = state.sort;
  hideOpenings.checked = state.hideOpenings;
  missingOnly.checked = state.missingOnly;
  for (const input of body.querySelectorAll("[data-column]")) input.checked = !!state.columns[input.dataset.column];

  search.addEventListener("input", () => {
    state.search = search.value;
    render();
  });
  roomSelect.addEventListener("change", () => {
    state.room = roomSelect.value;
    savePrefs(state);
    render();
  });
  groupSelect.addEventListener("change", () => {
    state.group = groupSelect.value;
    savePrefs(state);
    render();
  });
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    savePrefs(state);
    render();
  });
  hideOpenings.addEventListener("change", () => {
    state.hideOpenings = hideOpenings.checked;
    savePrefs(state);
    render();
  });
  missingOnly.addEventListener("change", () => {
    state.missingOnly = missingOnly.checked;
    savePrefs(state);
    render();
  });
  body.querySelector("#specs-columns").addEventListener("change", (event) => {
    const input = event.target.closest("[data-column]");
    if (!input) return;
    state.columns[input.dataset.column] = input.checked;
    savePrefs(state);
    render();
  });
  groupButton.addEventListener("click", () => groupSelection());
  ungroupButton.addEventListener("click", () => ungroupSelection());

  tableHost.addEventListener("mousedown", (event) => {
    if (event.shiftKey) event.preventDefault();
  });
  tableHost.addEventListener("click", (event) => {
    const solo = event.target.closest("[data-solo]");
    if (solo) {
      event.stopPropagation();
      fromTable = true;
      anchorId = solo.dataset.solo;
      ui.select({ kind: "item", ids: [solo.dataset.solo] });
      return;
    }
    if (event.target.closest("[data-lock]")) {
      event.stopPropagation();
      return;
    }
    const row = event.target.closest("tr[data-id]");
    if (row) {
      applyClick(event, memberIdsOf(store.get(), row.dataset.id), row.dataset.id);
      return;
    }
    const header = event.target.closest("tr[data-group]");
    if (!header) return;
    const plan = store.get();
    const ids = plan.items.filter((entry) => entry.groupId === header.dataset.group).map((entry) => entry.id);
    const anchor = flatIds.find((id) => ids.includes(id)) || ids[0];
    applyClick(event, ids, anchor);
  });
  tableHost.addEventListener("change", (event) => {
    const lock = event.target.closest("[data-lock]");
    if (!lock) return;
    const id = lock.dataset.lock;
    const checked = lock.checked;
    store.update((plan) => {
      const entry = plan.items.find((item) => item.id === id);
      if (entry) entry.locked = checked;
    });
    if (ui.selection) ui.select(ui.selection);
  });
  tableHost.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, input")) return;
    const row = event.target.closest("tr[data-id], tr[data-group]");
    if (!row) return;
    const plan = store.get();
    const id = row.dataset.id || plan.items.find((entry) => entry.groupId === row.dataset.group)?.id;
    const entry = plan.items.find((item) => item.id === id);
    if (entry) showItem(entry);
  });

  function applyClick(event, ids, anchor) {
    fromTable = true;
    if (event.shiftKey && anchorId && flatIds.includes(anchorId) && flatIds.includes(anchor)) {
      const start = flatIds.indexOf(anchorId);
      const end = flatIds.indexOf(anchor);
      const slice = flatIds.slice(Math.min(start, end), Math.max(start, end) + 1);
      const plan = store.get();
      const next = [...new Set(slice.flatMap((id) => memberIdsOf(plan, id)))];
      ui.select({ kind: "item", ids: next });
      return;
    }
    anchorId = anchor;
    if (event.ctrlKey || event.metaKey) {
      const current = new Set(ui.selection?.kind === "item" ? ui.selection.ids : []);
      const allOn = ids.every((id) => current.has(id));
      if (allOn) ids.forEach((id) => current.delete(id));
      else ids.forEach((id) => current.add(id));
      ui.select({ kind: "item", ids: [...current] });
      return;
    }
    ui.select({ kind: "item", ids });
  }

  function render() {
    const plan = store.get();
    syncOptions(plan, state);
    const selected = new Set(ui.selection?.kind === "item" ? ui.selection.ids : []);
    groupButton.disabled = selected.size < 2;
    ungroupButton.disabled = ![...selected].some((id) => plan.items.find((entry) => entry.id === id)?.groupId);
    const view = buildView(plan, state, selected);
    const key = [...selected].sort().join(",");
    const sig = `${view.html}\n${view.foot}\n${key}`;
    if (sig === lastSig) {
      fromTable = false;
      return;
    }
    const selectionChanged = key !== lastKey;
    lastSig = sig;
    lastKey = key;
    tableHost.innerHTML = view.html;
    foot.textContent = view.foot;
    flatIds = view.flatIds;
    if (selectionChanged) {
      if (!fromTable) anchorId = flatIds.find((id) => selected.has(id)) || null;
      tableHost.querySelector("tr.on")?.scrollIntoView({ block: "nearest" });
    }
    fromTable = false;
  }

  store.subscribe(render);
  ui.subscribe(render);
}

function syncOptions(plan, state) {
  const roomSelect = document.querySelector("#specs-room");
  const groupSelect = document.querySelector("#specs-group-filter");
  const numbers = groupNumbers(plan.items);
  const roomOptions = [`<option value="all">すべての部屋</option>`]
    .concat(plan.rooms.map((room) => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name)}</option>`))
    .concat(`<option value="outside">部屋の外</option>`);
  const roomSig = roomOptions.join("");
  if (roomSelect.dataset.sig !== roomSig) {
    roomSelect.dataset.sig = roomSig;
    roomSelect.innerHTML = roomOptions.join("");
  }
  const groupOptions = [`<option value="all">すべてのグループ</option>`, `<option value="none">グループなし</option>`]
    .concat([...numbers.entries()].map(([id, number]) => `<option value="${escapeHtml(id)}">グループ ${number}</option>`));
  const groupSig = groupOptions.join("");
  if (groupSelect.dataset.sig !== groupSig) {
    groupSelect.dataset.sig = groupSig;
    groupSelect.innerHTML = groupOptions.join("");
  }
  let corrected = false;
  if (![...roomSelect.options].some((option) => option.value === state.room)) {
    state.room = "all";
    corrected = true;
  }
  if (![...groupSelect.options].some((option) => option.value === state.group)) {
    state.group = "all";
    corrected = true;
  }
  if (roomSelect.value !== state.room) roomSelect.value = state.room;
  if (groupSelect.value !== state.group) groupSelect.value = state.group;
  if (corrected) savePrefs(state);
}

function buildView(plan, state, selected) {
  const numbers = groupNumbers(plan.items);
  const rooms = new Map(plan.items.map((entry) => [entry.id, roomOf(plan, entry)]));
  const query = state.search.trim().toLowerCase();
  const visible = plan.items.filter((entry) => {
    if (state.hideOpenings && isDoorOrWindow(entry)) return false;
    if (state.missingOnly && priceOf(entry) != null && weightOf(entry) != null) return false;
    const room = rooms.get(entry.id);
    if (state.room === "outside" && room) return false;
    if (state.room !== "all" && state.room !== "outside" && room?.id !== state.room) return false;
    if (state.group === "none" && entry.groupId) return false;
    if (state.group !== "all" && state.group !== "none" && entry.groupId !== state.group) return false;
    if (!query) return true;
    const blob = `${entry.name || ""} ${entry.maker || ""} ${entry.model || ""}`.toLowerCase();
    return blob.includes(query);
  });
  const columns = EXTRAS.filter(([key]) => state.columns[key]);
  const blocks = blocksOf(visible, state, rooms);
  const flatIds = [];
  const body = [];
  for (const block of blocks) {
    if (block.groupId) {
      const members = plan.items.filter((entry) => entry.groupId === block.groupId);
      const shown = members.filter((entry) => selected.has(entry.id)).length;
      const cls = shown && shown === members.length ? "group on" : shown ? "group part" : "group";
      const countLabel = block.rows.length === members.length ? `${members.length}件` : `${block.rows.length}/${members.length}件`;
      body.push(`<tr class="${cls}" data-group="${escapeHtml(block.groupId)}"><td colspan="${6 + columns.length}">グループ ${numbers.get(block.groupId)} · ${countLabel}</td></tr>`);
    }
    for (const row of block.rows) {
      flatIds.push(row.entry.id);
      body.push(rowHtml(row, rooms.get(row.entry.id), numbers, columns, selected.has(row.entry.id)));
    }
  }
  const selectedCount = [...selected].filter((id) => plan.items.some((entry) => entry.id === id)).length;
  const groupCount = new Set(visible.filter((entry) => entry.groupId).map((entry) => entry.groupId)).size;
  const empty = !plan.items.length
    ? `<tr><td colspan="${6 + columns.length}">器具はまだありません。</td></tr>`
    : !visible.length
      ? `<tr><td colspan="${6 + columns.length}">条件に合う器具はありません。</td></tr>`
      : "";
  const heads = ["名称", "部屋", "寸法", "グループ", ...columns.map(([, label]) => label), "ロック", "個別"];
  const html = `
    <table>
      <thead><tr>${heads.map((label, index) => `<th${index === 2 ? ` class="num" title="幅×奥行×高さ mm"` : index === 1 ? ` title="置いてある部屋"` : ""}>${label}</th>`).join("")}</tr></thead>
      <tbody>${empty || body.join("")}</tbody>
    </table>
  `;
  return {
    html,
    flatIds,
    foot: `表示 ${visible.length}件 / 選択 ${selectedCount}件 / グループ ${groupCount}`,
  };
}

function blocksOf(visible, state, rooms) {
  const byGroup = new Map();
  const loose = [];
  for (const entry of visible) {
    if (!entry.groupId) loose.push(entry);
    else {
      if (!byGroup.has(entry.groupId)) byGroup.set(entry.groupId, []);
      byGroup.get(entry.groupId).push(entry);
    }
  }
  const blocks = [...byGroup.entries()].map(([groupId, items]) => ({ groupId, items }));
  for (const entry of loose) blocks.push({ groupId: null, items: [entry] });
  blocks.sort((a, b) => compareEntries(rankOf(a.items, state, rooms), rankOf(b.items, state, rooms), state, rooms));
  return blocks.map((block) => ({ groupId: block.groupId, rows: nest(block.items, state, rooms) }));
}

function nest(items, state, rooms) {
  const ids = new Set(items.map((entry) => entry.id));
  const hosts = items.filter((entry) => !entry.hostId || !ids.has(entry.hostId)).sort((a, b) => compareEntries(a, b, state, rooms));
  const rows = [];
  for (const host of hosts) {
    rows.push({ entry: host, depth: 0 });
    const guests = items.filter((entry) => entry.hostId === host.id).sort((a, b) => compareEntries(a, b, state, rooms));
    for (const guest of guests) rows.push({ entry: guest, depth: 1 });
  }
  return rows;
}

function rankOf(items, state, rooms) {
  return items.slice().sort((a, b) => compareEntries(a, b, state, rooms))[0];
}

function compareEntries(a, b, state, rooms) {
  if (state.sort === "size") return (a.w || 0) - (b.w || 0) || (a.d || 0) - (b.d || 0) || (a.h || 0) - (b.h || 0) || nameOf(a).localeCompare(nameOf(b), "ja");
  if (state.sort === "room") {
    const room = roomLabel(rooms.get(a.id)).localeCompare(roomLabel(rooms.get(b.id)), "ja");
    return room || nameOf(a).localeCompare(nameOf(b), "ja");
  }
  return nameOf(a).localeCompare(nameOf(b), "ja");
}

function rowHtml(row, room, numbers, columns, on) {
  const entry = row.entry;
  const name = escapeHtml(nameOf(entry));
  const cells = [
    `<td class="${row.depth ? "guest" : ""}">${row.depth ? "↳ " : ""}${name}</td>`,
    `<td>${escapeHtml(roomLabel(room))}</td>`,
    `<td class="num">${Math.round(entry.w)}×${Math.round(entry.d)}×${Math.round(entry.h)}</td>`,
    `<td>${entry.groupId ? `グループ ${numbers.get(entry.groupId)}` : "—"}</td>`,
    ...columns.map(([key]) => `<td>${escapeHtml(columnText(entry, key))}</td>`),
    `<td><input type="checkbox" data-lock="${escapeHtml(entry.id)}" ${entry.locked ? "checked" : ""} aria-label="${name}をロック" /></td>`,
    `<td>${entry.groupId ? `<button type="button" class="linkish" data-solo="${escapeHtml(entry.id)}">個別</button>` : ""}</td>`,
  ];
  return `<tr class="${on ? "on" : ""}" data-id="${escapeHtml(entry.id)}">${cells.join("")}</tr>`;
}

function columnText(entry, key) {
  if (key === "weight") return weightOf(entry) == null ? "未設定" : formatKg(weightOf(entry));
  if (key === "price") return priceOf(entry) == null ? "未設定" : `¥${priceOf(entry).toLocaleString()}`;
  if (key === "water") return joinFields(entry, ["water", "drain"]);
  if (key === "air") return joinFields(entry, ["supplyAir", "exhaust"]);
  if (key === "power") return String(entry.power || "");
  if (key === "gas") return String(entry.gas || "");
  if (key === "note") return String(entry.note || "");
  return String(entry[key] || "");
}

function roomOf(plan, entry) {
  for (let i = plan.rooms.length - 1; i >= 0; i -= 1) {
    const room = plan.rooms[i];
    if (pointInRoom(room, entry.x, entry.y)) return room;
  }
  return null;
}

function roomLabel(room) {
  return room?.name || "部屋の外";
}

function nameOf(entry) {
  return entry.name || "（名称なし）";
}

function memberIdsOf(plan, id) {
  const entry = plan.items.find((item) => item.id === id);
  if (!entry?.groupId) return [id];
  return plan.items.filter((item) => item.groupId === entry.groupId).map((item) => item.id);
}

function groupNumbers(items) {
  const map = new Map();
  let number = 1;
  for (const entry of items) {
    if (entry.groupId && !map.has(entry.groupId)) map.set(entry.groupId, number++);
  }
  return map;
}

function isDoorOrWindow(entry) {
  const id = entry.catalogId || "";
  return !!(entry.openingId || entry.leaf === "door" || entry.leaf === "window" || id === "window" || id.startsWith("door"));
}

function priceOf(entry) {
  if (entry.price == null || entry.price === "" || Number.isNaN(Number(entry.price))) return null;
  return Number(entry.price);
}

function weightOf(entry) {
  if (entry.weightKg == null || entry.weightKg === "" || Number.isNaN(Number(entry.weightKg))) return null;
  return Number(entry.weightKg);
}

function formatKg(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function joinFields(entry, keys) {
  return keys.map((key) => String(entry[key] || "").trim()).filter(Boolean).join(" / ");
}

function loadPrefs() {
  const columns = Object.fromEntries(EXTRAS.map(([key]) => [key, false]));
  const base = { sort: "name", hideOpenings: false, missingOnly: false, room: "all", group: "all", columns };
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY)) || {};
    const sort = ["name", "room", "size"].includes(saved.sort) ? saved.sort : "name";
    return {
      sort,
      hideOpenings: !!saved.hideOpenings,
      missingOnly: !!saved.missingOnly,
      room: typeof saved.room === "string" ? saved.room : "all",
      group: typeof saved.group === "string" ? saved.group : "all",
      columns: { ...columns, ...(saved.columns || {}) },
    };
  } catch {
    return base;
  }
}

function savePrefs(state) {
  localStorage.setItem(PREF_KEY, JSON.stringify({
    sort: state.sort,
    hideOpenings: state.hideOpenings,
    missingOnly: state.missingOnly,
    room: state.room,
    group: state.group,
    columns: state.columns,
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
