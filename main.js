import { bookToPlan, planToBook } from "./book.js?v=20261111h";
import { insertPoint, outlinePoints, removePoint, roomArea, scaleRoom, setEdgeArc } from "./geometry.js?v=20261022d";
import { ROOM_TYPES, catalogTemplateCsv, categoryTree, importUserCatalog, loadSharedCatalog, lookupItem } from "./catalog.js?v=20261028d";
import { bindEnv, envPanel } from "./env.js?v=20261111h";
import { readTables, writeWorkbook } from "./excelio.js?v=20261111h";
import { attachLeaf, clampOpenings, hingeForHand, noteRemovedVertex, resizeOpening, splitEdgeOpenings } from "./openings.js?v=20261022f";
import { bindPower, powerPanel } from "./power.js?v=20261028d";
import { createStore, uid } from "./store.js?v=20261111h";
import { seatItems } from "./surface.js?v=20261028d";
import { mountSpecs } from "./specs.js?v=20261104m";
import { createView2d } from "./view2d.js?v=20261111h";

const store = createStore();
const ui = createController();
const sidebar = document.querySelector("#sidebar");
const view2d = createView2d(document.querySelector("#view2d"), store, ui);
const FOLD_KEY = "neosupo-star-beta7-folds";

function readFolds() {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY)) || {};
  } catch {
    return {};
  }
}

function resizeViews() {
  requestAnimationFrame(() => {
    view2d.resize();
    view3d?.resize();
  });
}

function paintFold(kind, folded) {
  if (kind === "menu") {
    document.querySelector(".workspace").classList.toggle("menu-folded", folded);
    const button = document.querySelector("#fold-menu");
    button.setAttribute("aria-expanded", String(!folded));
    button.textContent = folded ? "パネル" : "パネルを閉じる";
  } else if (kind === "specs") {
    document.querySelector(".workspace").classList.toggle("specs-folded", folded);
    const button = document.querySelector("#fold-specs");
    button.setAttribute("aria-expanded", String(!folded));
    button.textContent = folded ? "諸元一覧" : "諸元一覧を閉じる";
  } else {
    document.querySelector("#float-tools").classList.toggle("folded", folded);
    const button = document.querySelector("#fold-tools");
    button.setAttribute("aria-expanded", String(!folded));
    button.textContent = folded ? "操作" : "閉じる";
  }
  resizeViews();
}

function setFold(kind, folded) {
  const saved = readFolds();
  saved[kind] = folded;
  localStorage.setItem(FOLD_KEY, JSON.stringify(saved));
  paintFold(kind, folded);
}

function specsStartsFolded(saved) {
  return !Object.prototype.hasOwnProperty.call(saved, "specs") || !!saved.specs;
}

function applyTabFolds(nextTab) {
  const saved = readFolds();
  if (nextTab === "env") {
    paintFold("menu", false);
    paintFold("specs", true);
    return;
  }
  if (nextTab === "power" || nextTab === "present") {
    paintFold("menu", true);
    paintFold("specs", true);
    return;
  }
  paintFold("menu", !!saved.menu);
  paintFold("specs", specsStartsFolded(saved));
}

const storedFolds = readFolds();
if (storedFolds.tools) paintFold("tools", true);
applyTabFolds("layout");
document.querySelector("#fold-menu").addEventListener("click", () => {
  setFold("menu", !document.querySelector(".workspace").classList.contains("menu-folded"));
});
document.querySelector("#fold-tools").addEventListener("click", () => {
  setFold("tools", !document.querySelector("#float-tools").classList.contains("folded"));
});
document.querySelector("#fold-specs").addEventListener("click", () => {
  setFold("specs", !document.querySelector(".workspace").classList.contains("specs-folded"));
});
mountSpecs({
  store,
  ui,
  showItem: (entry) => view2d.showItem(entry),
  groupSelection,
  ungroupSelection,
});
let view3d = null;
let tab = "layout";
let mode = "2d";

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    tab = button.dataset.tab;
    ui.setTab(tab);
    document.querySelectorAll(".tabs button").forEach((el) => el.classList.toggle("active", el === button));
    if (tab === "items" || tab === "layout" || tab === "power") ui.setTool("select");
    if (tab === "env") ui.setEnvGrade(ui.envGrade || "B");
    document.querySelector("#mode-3d").hidden = tab === "power" || tab === "env";
    if ((tab === "power" || tab === "env") && mode === "3d") setMode("2d");
    applyTabFolds(tab);
    renderSidebar();
    markViewMode(document.querySelector("#walk").classList.contains("active") ? "walk" : "sky");
  });
});

document.querySelector("#mode-2d").addEventListener("click", () => setMode("2d"));
document.querySelector("#mode-3d").addEventListener("click", () => setMode("3d"));
document.querySelector("#fit").addEventListener("click", () => {
  if (mode === "3d") view3d?.fit();
  else view2d.fit();
});
document.querySelector("#zoom-in").addEventListener("click", () => {
  if (mode === "3d") view3d?.zoomBy(1.2);
  else view2d.zoomBy(1.2);
});
document.querySelector("#zoom-out").addEventListener("click", () => {
  if (mode === "3d") view3d?.zoomBy(0.8);
  else view2d.zoomBy(0.8);
});
document.querySelector("#undo").addEventListener("click", () => store.undo());
document.querySelector("#redo").addEventListener("click", () => store.redo());
document.querySelector("#snap").addEventListener("change", (event) => {
  store.update((plan) => {
    plan.settings.snap = event.target.checked;
  });
});
document.querySelector("#sky").addEventListener("click", () => {
  view3d?.setMode("sky");
  markViewMode("sky");
});
document.querySelector("#walk").addEventListener("click", () => {
  view3d?.setMode("walk");
  markViewMode("walk");
});
document.querySelector("#doors").addEventListener("click", () => {
  if (!view3d) return;
  markDoors(view3d.toggleDoors());
});
document.querySelector("#new-plan").addEventListener("click", () => document.querySelector("#dialog-new").showModal());
document.querySelector("#new-cancel").addEventListener("click", () => document.querySelector("#dialog-new").close());
document.querySelector("#form-new").addEventListener("submit", (event) => {
  const data = new FormData(event.currentTarget);
  store.newPlan({
    ceiling: data.get("ceiling"),
    floorHeight: data.get("floorHeight"),
    wall: data.get("wall"),
  });
  view2d.fit();
});
const PLAN_LIST_KEY = "neosupo-star-beta7-plan-list";
const planList = loadPlanListPref();
document.querySelector("#plan-list").addEventListener("click", () => {
  const all = sortedPlans();
  const index = Math.max(0, all.findIndex((plan) => plan.id === store.get()?.id));
  planList.page = Math.floor(index / planList.pageSize);
  renderPlanList();
  document.querySelector("#dialog-list").showModal();
});
document.querySelector("#plan-page-size").addEventListener("change", (event) => {
  const next = Math.round(Number(event.target.value));
  if (!Number.isFinite(next)) {
    event.target.value = String(planList.pageSize);
    return;
  }
  const pageSize = Math.min(60, Math.max(1, next));
  const anchor = planList.page * planList.pageSize;
  planList.pageSize = pageSize;
  planList.page = Math.floor(anchor / pageSize);
  event.target.value = String(pageSize);
  savePlanListPref();
  renderPlanList();
});
document.querySelector("#plan-view-list").addEventListener("click", () => setPlanView("list"));
document.querySelector("#plan-view-thumb").addEventListener("click", () => setPlanView("thumb"));
document.querySelector("#plan-pager").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  const pages = Math.max(1, Math.ceil(sortedPlans().length / planList.pageSize));
  if (button.dataset.page === "prev") planList.page = Math.max(0, planList.page - 1);
  else if (button.dataset.page === "next") planList.page = Math.min(pages - 1, planList.page + 1);
  else planList.page = Number(button.dataset.page) || 0;
  renderPlanList();
});
document.querySelector("#dialog-list form").addEventListener("submit", (event) => {
  if (event.submitter?.id === "plan-list-close") return;
  event.preventDefault();
});
document.querySelector("#detail").addEventListener("click", () => {
  renderDetail();
  document.querySelector("#dialog-detail").showModal();
});
document.querySelector("#detail-columns").addEventListener("click", () => {
  renderDetailColumns();
  document.querySelector("#dialog-detail-columns").showModal();
});
document.querySelector("#detail-column-list").addEventListener("change", (event) => {
  if (!event.target.closest("[data-detail-column]")) return;
  const ids = [...document.querySelectorAll("[data-detail-column]:checked")].map((input) => input.dataset.detailColumn);
  saveDetailColumns(ids);
  renderDetail();
});
document.querySelector("#help").addEventListener("click", () => document.querySelector("#dialog-help").showModal());
document.querySelector("#print").addEventListener("click", () => {
  renderDetail();
  window.print();
});
document.querySelector("#plan-name").addEventListener("change", (event) => store.rename(event.target.value));
document.querySelector("#export-excel").addEventListener("click", exportExcel);
document.querySelector("#import-excel").addEventListener("click", () => document.querySelector("#excel-file").click());
document.querySelector("#excel-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) await importExcel(file);
});
window.addEventListener("keydown", (event) => {
  const typing = event.target.matches("input, textarea, select");
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    store.undo();
  } else if (command && event.key.toLowerCase() === "y") {
    event.preventDefault();
    store.redo();
  } else if (!typing && command && (event.key.toLowerCase() === "d" || event.key.toLowerCase() === "c")) {
    event.preventDefault();
    duplicateSelection();
  } else if (!typing && command && event.key.toLowerCase() === "g") {
    event.preventDefault();
    groupSelection();
  } else if (!typing && event.key === "Escape" && ui.tab === "env") {
    ui.setTool("select");
  } else if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    deleteSelection();
  }
});

sidebar.addEventListener("click", (event) => {
  const roomBtn = event.target.closest("[data-room]");
  if (roomBtn) {
    const type = ROOM_TYPES.find((room) => room.name === roomBtn.dataset.room);
    if (type) ui.setRoom(type.name, type.color);
  }
  const openingBtn = event.target.closest("[data-opening]");
  if (openingBtn) ui.setOpening(openingBtn.dataset.opening);
  const catBtn = event.target.closest("[data-cat]");
  if (catBtn) ui.setCatalog(catBtn.dataset.cat);
});
ui.subscribe(() => {
  renderSidebar();
  view3d?.setSelection(ui.selection);
});
store.subscribe(syncChrome);
await loadSharedCatalog();
renderSidebar();
syncChrome(store.get());
requestAnimationFrame(() => view2d.fit());

async function setMode(next) {
  mode = next;
  document.querySelector("#view2d").hidden = next !== "2d";
  document.querySelector("#view3d").hidden = next !== "3d";
  document.querySelector("#mode-2d").classList.toggle("active", next === "2d");
  document.querySelector("#mode-3d").classList.toggle("active", next === "3d");
  document.querySelector("#view-toggle").hidden = next !== "3d";
  if (next === "3d" && !view3d) {
    const mod = await import("./view3d.js?v=20261111h");
    view3d = mod.createView3d(document.querySelector("#view3d"), store, ui);
    view3d.setSelection(ui.selection);
  }
  if (next === "2d") requestAnimationFrame(() => view2d.resize());
  else {
    requestAnimationFrame(() => view3d?.resize());
    markViewMode(document.querySelector("#walk").classList.contains("active") ? "walk" : "sky");
  }
}

function markViewMode(next) {
  const walking = next === "walk";
  document.querySelector("#sky").classList.toggle("active", !walking);
  document.querySelector("#walk").classList.toggle("active", walking);
  const help = document.querySelector("#view-help");
  if (!help) return;
  help.textContent = walking
    ? "カーソルで移動（Ctrl押しながら左右で視点移動）Shiftで早く移動"
    : ui.tab === "present"
      ? "ドラッグで見下ろします。キャラクターは矢印キーかWASDで歩き、進む方向を向きます。マウスで選んで移動できます。壁と配置した器具を越えません。Ctrlを押しながら左右で向きを変えます。Hで表示と非表示です。"
      : "ドラッグで見下ろします。右ドラッグで図面を移動し、ホイールと拡大・縮小で寄り引きします。";
}

function markDoors(open) {
  const button = document.querySelector("#doors");
  if (!button) return;
  button.textContent = open ? "ドアを閉じる" : "ドアを開く";
  button.setAttribute("aria-pressed", open ? "true" : "false");
}

function syncChrome(plan) {
  const name = document.querySelector("#plan-name");
  if (document.activeElement !== name) name.value = plan.name;
  document.querySelector("#snap").checked = plan.settings.snap;
}

function renderSidebar() {
  if (tab === "layout") sidebar.innerHTML = layoutPanel();
  else if (tab === "items") sidebar.innerHTML = itemPanel();
  else if (tab === "power") sidebar.innerHTML = powerPanel(store.get(), ui);
  else if (tab === "env") sidebar.innerHTML = envPanel(store.get(), ui);
  else if (tab === "present") sidebar.innerHTML = presentPanel();
  bindSidebar();
}

function bindSidebar() {
  bindPower(sidebar, store, ui, renderSidebar);
  bindEnv(sidebar, store, ui);
  sidebar.querySelector("#show-env")?.addEventListener("change", (event) => ui.setShowEnv(event.target.checked));
  sidebar.querySelector("#module")?.addEventListener("change", (event) => {
    const value = event.target.value;
    store.update((plan) => {
      plan.settings.module = value === "custom" ? Number(sidebar.querySelector("#custom-module").value) || 1000 : Number(value);
    });
  });
  sidebar.querySelector("#custom-module")?.addEventListener("change", (event) => {
    store.update((plan) => {
      plan.settings.module = clamp(Number(event.target.value) || 1000, 100, 2000);
    });
  });
  sidebar.querySelector("#division")?.addEventListener("change", (event) => {
    store.update((plan) => {
      plan.settings.division = Number(event.target.value);
    });
  });
  sidebar.querySelector("#measure")?.addEventListener("click", () => ui.setTool("measure"));
  sidebar.querySelector("#select-tool")?.addEventListener("click", () => ui.setTool("select"));
  sidebar.querySelector("#placed-visible")?.addEventListener("click", () => ui.setShowPlaced(!ui.showPlaced));
  sidebar.querySelector("#underlay-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const shrunk = await shrinkImage(file);
      store.update((plan) => {
        plan.underlay = {
          name: file.name,
          href: shrunk.href,
          x: 0,
          y: 0,
          w: 8000,
          h: Math.max(100, Math.round(8000 / shrunk.aspect)),
        };
      });
      ui.setTool("select");
      ui.select({ kind: "underlay", ids: ["underlay"] });
    } catch {
      /* ignore unreadable images */
    }
  });
  sidebar.querySelectorAll("[data-underlay]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.underlay;
      store.update((plan) => {
        if (!plan.underlay) return;
        plan.underlay[key] = Number(input.value);
      });
    });
  });
  sidebar.querySelector("#underlay-clear")?.addEventListener("click", () => {
    store.update((plan) => {
      plan.underlay = null;
    });
    if (ui.selection?.kind === "underlay") ui.select(null);
    else renderSidebar();
  });
  sidebar.querySelector("#add-custom")?.addEventListener("click", addCustomItem);
  sidebar.querySelector("#catalog-template")?.addEventListener("click", (event) => {
    event.preventDefault();
    downloadText(catalogTemplateCsv(), "catalog-template.csv");
  });
  sidebar.querySelector("#import-catalog")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = importUserCatalog(await file.text());
    renderSidebar();
    const resultNote = sidebar.querySelector("#catalog-result");
    if (resultNote) resultNote.textContent = result.added
      ? `${result.added}件をこのブラウザに追加しました。記入例の行は読み込んでいません。`
      : "追加できる行がありません。記入例の行と、共通カタログと同じidは読み込みません。";
  });
  sidebar.querySelector("#brightness")?.addEventListener("change", (event) => {
    store.update((plan) => {
      plan.settings.brightness = Number(event.target.value);
    });
  });
  sidebar.querySelector("#walker-toggle")?.addEventListener("click", () => ui.setShowWalker(!ui.showWalker));
  sidebar.querySelector("#shot")?.addEventListener("click", exportImage);
  sidebar.querySelector("#add-view")?.addEventListener("click", saveView);
  sidebar.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => restoreView(button.dataset.view));
  });
  sidebar.querySelectorAll("[data-view-del]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.viewDel;
      store.update((plan) => {
        plan.views = plan.views.filter((view) => view.id !== id);
      });
      renderSidebar();
    });
  });
  bindProps();
}

function layoutPanel() {
  const plan = store.get();
  const rooms = ROOM_TYPES.map((room) => {
    const active = ui.tool === "room" && ui.roomType === room.name ? "active" : "";
    return `<button type="button" data-room="${room.name}" class="${active}">${room.name}</button>`;
  }).join("");
  const custom = ![910, 1000, 1218].includes(plan.settings.module);
  const underlay = plan.underlay;
  return `
    <div class="side-block">
      <div class="tool-row">
        <button type="button" id="select-tool" class="${ui.tool === "select" ? "active" : ""}">選択 / 移動</button>
        <button type="button" id="placed-visible" class="${ui.showPlaced ? "active" : ""}" aria-pressed="${ui.showPlaced}">${ui.showPlaced ? "配置を隠す" : "配置を表示"}</button>
      </div>
      <h2>部屋</h2>
      ${rooms}
    </div>
    <div class="side-block">
      <h2>開口</h2>
      <p class="note">壁をクリックして穴を作ります。同じ線上で重なる隣室の壁も一緒に開きます。複製はできません。</p>
      <button type="button" data-opening="full" class="${ui.tool === "opening" && ui.openingPreset === "full" ? "active" : ""}">壁抜き</button>
      <button type="button" data-opening="hole" class="${ui.tool === "opening" && ui.openingPreset === "hole" ? "active" : ""}">開口部</button>
      <button type="button" data-opening="waist" class="${ui.tool === "opening" && ui.openingPreset === "waist" ? "active" : ""}">腰壁</button>
      <button type="button" id="measure" class="${ui.tool === "measure" ? "active" : ""}">計測</button>
    </div>
    <div class="side-block">
      <h2>グリッド</h2>
      <label>モジュール
        <select id="module">
          <option value="910" ${plan.settings.module === 910 ? "selected" : ""}>尺 910mm</option>
          <option value="1000" ${plan.settings.module === 1000 ? "selected" : ""}>メーター 1000mm</option>
          <option value="1218" ${plan.settings.module === 1218 ? "selected" : ""}>インチ 1218mm</option>
          <option value="custom" ${custom ? "selected" : ""}>任意間隔</option>
        </select>
      </label>
      <label>任意間隔 mm<input id="custom-module" type="number" min="100" max="2000" value="${plan.settings.module}" /></label>
      <label>分割
        <select id="division">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${plan.settings.division === n ? "selected" : ""}>1/${n}</option>`).join("")}
        </select>
      </label>
      <p class="note">スナップは壁厚の半分（${(Number(plan.settings.wall) || 150) / 2}mm）です。マス目の線にも止まります。</p>
    </div>
    <div class="side-block">
      <h2>下絵</h2>
      <label>画像<input id="underlay-file" type="file" accept="image/*" /></label>
      ${underlay ? `
        <p class="note">${escapeHtml(underlay.name || "下絵")}。図面でクリックして選び、角をドラッグすると縦横比を保って大きさが変わります。</p>
        <label>X mm<input data-underlay="x" type="number" value="${Math.round(underlay.x)}" /></label>
        <label>Y mm<input data-underlay="y" type="number" value="${Math.round(underlay.y)}" /></label>
        <label>幅 mm<input data-underlay="w" type="number" min="100" value="${Math.round(underlay.w)}" /></label>
        <label>高さ mm<input data-underlay="h" type="number" min="100" value="${Math.round(underlay.h)}" /></label>
        <button type="button" id="underlay-clear">下絵を外す</button>
      ` : `<p class="note">画像を選ぶと、図面の上で大きさを合わせられます。</p>`}
    </div>
    ${propsPanel()}
  `;
}

function itemPanel() {
  const plan = store.get();
  return `
    <div class="side-block">
      <div class="tool-row">
        <button type="button" id="select-tool" class="${ui.tool === "select" ? "active" : ""}">選択 / 移動</button>
      </div>
      <h2>アイテム</h2>
      <div class="tree">${renderTree(categoryTree(plan.customItems))}</div>
    </div>
    <div class="side-block">
      <h2>器具を追加</h2>
      <label>名前<input id="custom-name" type="text" /></label>
      <label>幅 mm<input id="custom-w" type="number" value="900" /></label>
      <label>奥行 mm<input id="custom-d" type="number" value="600" /></label>
      <label>高さ mm<input id="custom-h" type="number" value="800" /></label>
      <label>配置
        <select id="custom-place">
          <option value="floor">床</option>
          <option value="wall">壁</option>
          <option value="ceiling">天井</option>
          <option value="free">自由</option>
        </select>
      </label>
      <label>色<input id="custom-color" type="color" value="#d9d3c5" /></label>
      <label>単価<input id="custom-price" type="number" min="0" placeholder="未設定" /></label>
      <label class="check"><input id="custom-light" type="checkbox" /> 照明</label>
      <label class="check"><input id="custom-home" type="checkbox" /> 設備</label>
      <button type="button" id="add-custom">カタログに追加</button>
      <label>記入例を読み込む<input id="import-catalog" type="file" accept=".csv,text/csv" /></label>
      <p id="catalog-note" class="note"><span id="catalog-result"></span>記入例の読み込みはこのブラウザだけに追加します。記入例の行は読み込みません。ファイルはUTF-8のCSVです。<a href="#" id="catalog-template">記入例をダウンロード</a></p>
    </div>
    ${propsPanel()}
  `;
}

function renderTree(nodes) {
  return nodes.map((node) => {
    const leaves = node.items.map((entry) => {
      const active = ui.catalogId === entry.id ? "active" : "";
      return `<button type="button" data-cat="${entry.id}" class="${active}">${escapeHtml(entry.name)}</button>`;
    }).join("");
    const children = node.children.length ? renderTree(node.children) : "";
    return `<details open><summary>${escapeHtml(node.name)}</summary>${leaves}${children}</details>`;
  }).join("");
}

function presentPanel() {
  const plan = store.get();
  const views = plan.views.map((view) => `
    <div class="plan-row">
      <button type="button" data-view="${view.id}">${escapeHtml(view.name)}</button>
      <button type="button" data-view-del="${view.id}">削除</button>
    </div>
  `).join("");
  const level = Number(plan.settings.brightness);
  return `
    <div class="side-block">
      <h2>視点リスト</h2>
      <p class="note">3D のカメラ位置を保存します。明るさはプラン全体で 3 段階です。</p>
      <label>明るさ
        <select id="brightness">
          <option value="0" ${level === 0 ? "selected" : ""}>暗い</option>
          <option value="1" ${level === 1 ? "selected" : ""}>標準</option>
          <option value="2" ${level === 2 ? "selected" : ""}>明るい</option>
        </select>
      </label>
      <p class="note">このタブの3Dは高画質です。間取、配置、配電の3Dは従来の表示です。</p>
      <button type="button" id="walker-toggle" class="${ui.showWalker !== false ? "active" : ""}" aria-pressed="${ui.showWalker !== false ? "true" : "false"}">${ui.showWalker !== false ? "キャラクターを隠す" : "キャラクターを表示"}</button>
      <label class="check"><input id="show-env" type="checkbox" ${ui.showEnv ? "checked" : ""} /> 環境の色と矢印を表示</label>
      <p class="note">身長163cmです。Skyで表示し、矢印キーかWASDで歩きます。進む方向を向きます。マウスで選んで移動できます。Ctrlを押しながら左右で向きを変えます。Hで表示と非表示です。Walkでは出ません。壁と配置した器具は、少し余裕を残して越えません。</p>
      <button type="button" id="add-view">視点を追加</button>
      <button type="button" id="shot">画像を書き出す</button>
      ${plan.settings.exported ? `<p class="note">書き出し済み。編集はそのまま続けられます。</p>` : ""}
      ${views || `<p class="note">まだ視点がありません。</p>`}
    </div>
  `;
}

function propsPanel() {
  const sel = selectionState();
  if (!sel) return `<div class="props"><p class="note">選択するとサイズ、仕上げ、単価を変更できます。</p></div>`;
  if (sel.objs.length > 1) {
    const group = sel.kind === "item" ? `
      <button type="button" id="group-sel">グループ</button>
      <button type="button" id="ungroup-sel">グループ解除</button>
      <button type="button" id="rotate">回転</button>
      <button type="button" id="lock-sel">ロック</button>
      <button type="button" id="unlock-sel">ロック解除</button>
    ` : "";
    return `<div class="props"><h2>${sel.objs.length} 件を選択</h2>${group}<button type="button" id="dup">複製</button><button type="button" id="delete-sel">削除</button></div>`;
  }
  if (sel.kind === "room") return roomProps(sel.objs[0]);
  if (sel.kind === "opening") return openingProps(sel.objs[0]);
  if (sel.kind === "underlay") return `<div class="props"><h2>下絵</h2><p class="note">角をドラッグすると大きさが変わります。中をドラッグすると位置が動きます。</p><button type="button" id="delete-sel">削除</button></div>`;
  return itemProps(sel.objs[0]);
}

function shownDoorId(opening, leaf) {
  if (!leaf) return "";
  if (leaf.catalogId === "door" || leaf.catalogId === "door-right") {
    return hingeForHand(opening.wallSide, "right") === leaf.hinge ? "door-right" : "door";
  }
  return leaf.catalogId || "";
}

function openingProps(opening) {
  const plan = store.get();
  const leaf = plan.items.find((entry) => entry.openingId === opening.id);
  const cat = leaf ? lookupItem(leaf.catalogId, plan.customItems) : null;
  const swing = cat?.swing || (leaf?.leaf === "window" ? "window" : "");
  const names = { full: "壁抜き", hole: "開口部", waist: "腰壁" };
  const selectedId = shownDoorId(opening, leaf);
  const options = [
    ["", "建具なし"],
    ["door", "左開き"],
    ["door-right", "右開き"],
    ["door-double", "両開き"],
    ["door-push", "押し戸"],
    ["door-slide", "引き戸"],
    ["window", "窓"],
  ].map(([id, name]) => `<option value="${id}" ${selectedId === id ? "selected" : ""}>${name}</option>`).join("");
  const hinge = leaf?.leaf === "door" && swing !== "double" && swing !== "window"
    ? `<button type="button" id="leaf-hinge">${swing === "slide" ? "引き方向を反対にする" : "吊元を反対にする"}</button>`
    : "";
  const color = leaf
    ? `<label>色<input id="leaf-color" type="color" value="${leaf.color || "#c9a27a"}" /></label>`
    : "";
  return `<div class="props">
    <h2>${names[opening.preset] || "開口"}</h2>
    <label>幅 mm<input data-field="w" type="number" min="200" value="${Math.round(opening.w)}" /></label>
    <label>高さ mm<input data-field="h" type="number" min="200" value="${Math.round(opening.h)}" /></label>
    <label>床からの高さ mm<input data-field="sill" type="number" min="0" value="${Math.round(opening.sill)}" /></label>
    <label>建具<select id="leaf-type">${options}</select></label>
    ${color}
    ${hinge}
    <p class="note">ドアを選ぶと床まで開きます。左開き・右開きは部屋の内側から見た吊元です。押し戸は外側へ開きます。開口は複製できません。</p>
    <button type="button" id="delete-sel">削除</button>
  </div>`;
}

function roomProps(room) {
  const pick = ui.wallPick?.roomId === room.id ? ui.wallPick : null;
  const edge = pick?.edgeIndex != null ? room.edges?.[pick.edgeIndex] : null;
  return `<div class="props">
    <h2>${escapeHtml(room.name)}</h2>
    <p class="note">床面積 ${(roomArea(room) / 1e6).toFixed(2)} ㎡。頂点をドラッグすると斜めになります。辺を選んで頂点や円弧を足します。Excelの部屋はマスなので、斜めと円弧は段差になります。</p>
    <label>幅 mm<input data-field="w" type="number" value="${Math.round(room.w)}" /></label>
    <label>奥行 mm<input data-field="h" type="number" value="${Math.round(room.h)}" /></label>
    <label>床材<input data-field="floorFinish" data-kind="text" type="text" value="${escapeHtml(room.floorFinish || "床")}" /></label>
    <label>床の色<input data-field="floorColor" data-kind="color" type="color" value="${room.floorColor || room.color}" /></label>
    <label>壁材<input data-field="wallFinish" data-kind="text" type="text" value="${escapeHtml(room.wallFinish || "壁")}" /></label>
    <label>壁の色<input data-field="wallColor" data-kind="color" type="color" value="${room.wallColor || "#8e98a3"}" /></label>
    <label>下がり天井 mm<input data-field="dropCeiling" type="number" min="0" value="${Math.round(room.dropCeiling || 0)}" /></label>
    <label>上げ床 mm<input data-field="raisedFloor" type="number" min="0" value="${Math.round(room.raisedFloor || 0)}" /></label>
    <button type="button" id="add-vertex">頂点を追加</button>
    <button type="button" id="remove-vertex">頂点を削除</button>
    <label>円弧の半径 mm<input id="arc-radius" type="number" min="100" value="${edge?.radius ? Math.round(edge.radius) : 2000}" /></label>
    <button type="button" id="arc-edge">この辺を円弧にする</button>
    <button type="button" id="arc-flip">円弧の向きを反対</button>
    <button type="button" id="straight-edge">この辺を直線に戻す</button>
    <button type="button" id="dup">複製</button>
    <button type="button" id="delete-sel">削除</button>
  </div>`;
}

function selectedRoom() {
  const sel = ui.selection;
  if (sel?.kind !== "room" || sel.ids.length !== 1) return null;
  return store.get().rooms.find((room) => room.id === sel.ids[0]) || null;
}

function addVertex() {
  const room = selectedRoom();
  const edgeIndex = ui.wallPick?.roomId === room?.id ? ui.wallPick.edgeIndex : null;
  if (!room || edgeIndex == null) return;
  store.update((plan) => {
    const target = plan.rooms.find((entry) => entry.id === room.id);
    if (!target) return;
    const info = insertPoint(target, edgeIndex);
    splitEdgeOpenings(plan, target, info.edgeIndex, info.splitAt);
    clampOpenings(plan, target);
  });
  ui.pickWall({ roomId: room.id, vertexIndex: null, edgeIndex });
}

function removeVertex() {
  const room = selectedRoom();
  const index = ui.wallPick?.roomId === room?.id ? ui.wallPick.vertexIndex : null;
  if (!room || index == null) return;
  store.update((plan) => {
    const target = plan.rooms.find((entry) => entry.id === room.id);
    if (!target || target.points.length <= 3) return;
    noteRemovedVertex(plan, target.id, index, target.points.length);
    removePoint(target, index);
    clampOpenings(plan, target);
  });
  ui.pickWall(null);
}

function curveEdge(mode) {
  const room = selectedRoom();
  const edgeIndex = ui.wallPick?.roomId === room?.id ? ui.wallPick.edgeIndex : null;
  if (!room || edgeIndex == null) return;
  store.update((plan) => {
    const target = plan.rooms.find((entry) => entry.id === room.id);
    if (!target) return;
    if (mode < 0) setEdgeArc(target, edgeIndex, 0, 1);
    else if (mode === 0) {
      const arc = target.edges?.[edgeIndex];
      if (arc?.radius) setEdgeArc(target, edgeIndex, arc.radius, -arc.bow);
    } else {
      const radius = Number(document.querySelector("#arc-radius")?.value) || 2000;
      const bow = target.edges?.[edgeIndex]?.bow ?? 1;
      setEdgeArc(target, edgeIndex, radius, bow);
    }
    clampOpenings(plan, target);
  });
  ui.pickWall({ roomId: room.id, vertexIndex: null, edgeIndex });
}

function hostLine(entry) {
  if (!entry.hostId) return "";
  const host = store.get().items.find((row) => row.id === entry.hostId);
  if (!host) return "";
  return `<p class="note">載っている台: ${escapeHtml(host.name)}</p><button type="button" id="drop-floor">床に下ろす</button>`;
}

function settleAround(plan, id) {
  const guests = plan.items.filter((entry) => entry.hostId === id).map((entry) => entry.id);
  seatItems(plan, [id, ...guests]);
}

function itemProps(entry) {
  const locked = !!entry.locked;
  const read = locked ? "readonly" : "";
  const wall = entry.place === "wall";
  const light = entry.light ? `
    <label class="check"><input id="light-on" type="checkbox" ${entry.lightOn ? "checked" : ""} /> 点灯</label>
    <label>明るさ 1-10<input id="light-level" type="range" min="1" max="10" value="${entry.lightLevel || 10}" /></label>
    <label>光の色<input data-field="lightColor" data-kind="color" type="color" value="${entry.lightColor || "#fff4d6"}" /></label>
  ` : "";
  const home = entry.residential ? `<label>デザイン<input data-field="design" data-kind="text" type="text" value="${escapeHtml(entry.design || "")}" /></label>` : "";
  return `<div class="props">
    <h2>${escapeHtml(entry.name)}</h2>
    <label class="check"><input id="item-lock" type="checkbox" ${locked ? "checked" : ""} /> ロック</label>
    <p class="note">${locked ? "ロック中です。解除すると移動、回転、削除、寸法の変更ができます。" : "幅・奥行・高さはここで変えます。平面図と3Dでは、周りの円をドラッグすると1度ずつ回ります。回転ボタンは15度です。"}</p>
    <label>幅 mm<input data-field="w" type="number" min="50" value="${Math.round(entry.w)}" ${read} /></label>
    <label>奥行 mm<input data-field="d" type="number" min="50" value="${Math.round(entry.d)}" ${read} /></label>
    <label>高さ mm<input data-field="h" type="number" min="50" value="${Math.round(entry.h)}" ${read} /></label>
    ${wall ? `<label>取付高さ mm<input data-field="z" type="number" value="${Math.round(entry.z || 0)}" ${read} /></label>` : `<label>角度<input data-field="rot" type="number" step="1" value="${entry.rot}" ${read} /></label>`}
    ${hostLine(entry)}
    <label>色<input data-field="color" data-kind="color" type="color" value="${entry.color || "#cccccc"}" /></label>
    <label>単価<input data-field="price" data-kind="price" type="number" min="0" placeholder="未設定" value="${entry.price ?? ""}" /></label>
    <details>
      <summary>設備</summary>
      <label>メーカー<input data-field="maker" data-kind="text" type="text" value="${escapeHtml(entry.maker || "")}" /></label>
      <label>型式<input data-field="model" data-kind="text" type="text" value="${escapeHtml(entry.model || "")}" /></label>
      <label>重量 kg<input data-field="weightKg" type="number" min="0" value="${entry.weightKg ?? ""}" /></label>
      <label>CO2排出量 kt<input data-field="co2Kt" type="number" min="0" step="any" value="${entry.co2Kt ?? ""}" /></label>
      <label>電気<input data-field="power" data-kind="text" type="text" value="${escapeHtml(entry.power || "")}" /></label>
      <label>給水<input data-field="water" data-kind="text" type="text" value="${escapeHtml(entry.water || "")}" /></label>
      <label>排水<input data-field="drain" data-kind="text" type="text" value="${escapeHtml(entry.drain || "")}" /></label>
      <label>給気<input data-field="supplyAir" data-kind="text" type="text" value="${escapeHtml(entry.supplyAir || "")}" /></label>
      <label>排気<input data-field="exhaust" data-kind="text" type="text" value="${escapeHtml(entry.exhaust || "")}" /></label>
      <label>特ガス<input data-field="gas" data-kind="text" type="text" value="${escapeHtml(entry.gas || "")}" /></label>
      <label>備考<input data-field="note" data-kind="text" type="text" value="${escapeHtml(entry.note || "")}" /></label>
    </details>
    ${home}
    ${light}
    ${wall || locked ? "" : `<button type="button" id="rotate">回転</button>`}
    <button type="button" id="dup">複製</button>
    <button type="button" id="delete-sel">削除</button>
  </div>`;
}

function bindProps() {
  sidebar.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const sel = ui.selection;
      if (!sel || sel.ids.length !== 1) return;
      if (sel.kind === "opening") {
        store.update((plan) => {
          const opening = plan.openings.find((row) => row.id === sel.ids[0]);
          if (!opening) return;
          resizeOpening(plan, opening, { [input.dataset.field]: input.value });
        });
        return;
      }
      store.update((plan) => {
        const list = sel.kind === "room" ? plan.rooms : plan.items;
        const obj = list.find((row) => row.id === sel.ids[0]);
        if (!obj) return;
        const field = input.dataset.field;
        if (sel.kind === "item" && obj.locked && ["w", "d", "h", "rot", "z"].includes(field)) return;
        if (sel.kind === "item" && ["w", "d", "h"].includes(field)) {
          const max = field === "h" ? 12000 : 20000;
          obj[field] = clamp(Number(input.value) || 50, 50, max);
        } else writeField(obj, input);
        if (sel.kind === "room" && (input.dataset.field === "w" || input.dataset.field === "h")) {
          scaleRoom(obj, obj.w, obj.h);
          clampOpenings(plan, obj);
        }
        if (sel.kind === "item") settleAround(plan, obj.id);
      });
    });
  });
  sidebar.querySelector("#leaf-type")?.addEventListener("change", (event) => {
    const sel = ui.selection;
    if (sel?.kind !== "opening" || sel.ids.length !== 1) return;
    const catalogId = event.target.value;
    store.update((plan) => {
      const opening = plan.openings.find((row) => row.id === sel.ids[0]);
      if (!opening) return;
      if (!catalogId) {
        plan.items = plan.items.filter((entry) => entry.openingId !== opening.id);
        return;
      }
      const cat = lookupItem(catalogId, plan.customItems);
      if (!cat) return;
      attachLeaf(plan, opening, cat, uid());
    });
    renderSidebar();
  });
  sidebar.querySelector("#leaf-hinge")?.addEventListener("click", () => {
    const sel = ui.selection;
    if (sel?.kind !== "opening") return;
    store.update((plan) => {
      const opening = plan.openings.find((row) => row.id === sel.ids[0]);
      const leaf = plan.items.find((entry) => entry.openingId === sel.ids[0]);
      if (!leaf || !opening) return;
      leaf.hinge = leaf.hinge === "end" ? "start" : "end";
      if (leaf.catalogId === "door" || leaf.catalogId === "door-right") {
        const right = hingeForHand(opening.wallSide, "right") === leaf.hinge;
        leaf.catalogId = right ? "door-right" : "door";
        leaf.name = right ? "右開き" : "左開き";
      }
    });
    renderSidebar();
  });
  sidebar.querySelector("#leaf-color")?.addEventListener("change", (event) => {
    const sel = ui.selection;
    if (sel?.kind !== "opening") return;
    store.update((plan) => {
      const leaf = plan.items.find((entry) => entry.openingId === sel.ids[0]);
      if (leaf) leaf.color = event.target.value;
    });
  });
  sidebar.querySelector("#light-on")?.addEventListener("change", (event) => {
    updateSelectedItem((entry) => {
      entry.lightOn = event.target.checked;
    });
  });
  sidebar.querySelector("#light-level")?.addEventListener("change", (event) => {
    updateSelectedItem((entry) => {
      entry.lightLevel = Number(event.target.value);
    });
  });
  sidebar.querySelector("#delete-sel")?.addEventListener("click", deleteSelection);
  sidebar.querySelector("#dup")?.addEventListener("click", duplicateSelection);
  sidebar.querySelector("#rotate")?.addEventListener("click", rotateSelection);
  sidebar.querySelector("#add-vertex")?.addEventListener("click", addVertex);
  sidebar.querySelector("#remove-vertex")?.addEventListener("click", removeVertex);
  sidebar.querySelector("#arc-edge")?.addEventListener("click", () => curveEdge(1));
  sidebar.querySelector("#arc-flip")?.addEventListener("click", () => curveEdge(0));
  sidebar.querySelector("#straight-edge")?.addEventListener("click", () => curveEdge(-1));
  sidebar.querySelector("#item-lock")?.addEventListener("change", (event) => {
    updateSelectedItem((entry) => {
      entry.locked = event.target.checked;
    });
    ui.select(ui.selection);
  });
  sidebar.querySelector("#lock-sel")?.addEventListener("click", () => setLocked(true));
  sidebar.querySelector("#unlock-sel")?.addEventListener("click", () => setLocked(false));
  sidebar.querySelector("#drop-floor")?.addEventListener("click", () => {
    updateSelectedItem((entry) => {
      if (entry.locked) return;
      entry.hostId = null;
      entry.z = 0;
    });
    renderSidebar();
  });
  sidebar.querySelector("#group-sel")?.addEventListener("click", groupSelection);
  sidebar.querySelector("#ungroup-sel")?.addEventListener("click", ungroupSelection);
}

function writeField(obj, input) {
  const field = input.dataset.field;
  if (input.dataset.kind === "text" || input.dataset.kind === "color") obj[field] = input.value;
  else if (input.dataset.kind === "price") obj.price = input.value === "" ? null : Number(input.value);
  else if (input.value === "") obj[field] = "";
  else obj[field] = Number(input.value);
}

function updateSelectedItem(mutator) {
  const sel = ui.selection;
  if (sel?.kind !== "item" || sel.ids.length !== 1) return;
  store.update((plan) => {
    const entry = plan.items.find((row) => row.id === sel.ids[0]);
    if (entry) mutator(entry);
  });
}

function addCustomItem() {
  const name = sidebar.querySelector("#custom-name").value.trim();
  if (!name) return;
  const light = sidebar.querySelector("#custom-light").checked;
  const priceRaw = sidebar.querySelector("#custom-price").value;
  const id = `c${uid()}`;
  const entry = {
    id,
    name,
    category: ["追加器具"],
    w: clamp(Number(sidebar.querySelector("#custom-w").value) || 900, 10, 20000),
    d: clamp(Number(sidebar.querySelector("#custom-d").value) || 600, 10, 20000),
    h: clamp(Number(sidebar.querySelector("#custom-h").value) || 800, 10, 8000),
    place: light ? "ceiling" : sidebar.querySelector("#custom-place").value,
    color: sidebar.querySelector("#custom-color").value,
    price: priceRaw === "" ? null : Number(priceRaw),
    scalable: true,
    light,
    residential: sidebar.querySelector("#custom-home").checked,
    opening: false,
    mountHeight: 1200,
  };
  store.update((plan) => {
    plan.customItems.push(entry);
  });
  ui.setCatalog(id);
}

function selectionState() {
  const sel = ui.selection;
  if (!sel) return null;
  const plan = store.get();
  if (sel.kind === "underlay") return plan.underlay ? { kind: "underlay", objs: [plan.underlay] } : null;
  const list = sel.kind === "room" ? plan.rooms : sel.kind === "opening" ? plan.openings : plan.items;
  const objs = sel.ids.map((id) => list.find((row) => row.id === id)).filter(Boolean);
  return objs.length ? { kind: sel.kind, objs } : null;
}

function deleteSelection() {
  const sel = ui.selection;
  if (!sel) return;
  store.update((plan) => {
    if (sel.kind === "room") {
      const openingIds = plan.openings.filter((opening) => sel.ids.includes(opening.roomId)).map((opening) => opening.id);
      plan.rooms = plan.rooms.filter((room) => !sel.ids.includes(room.id));
      plan.openings = plan.openings.filter((opening) => !sel.ids.includes(opening.roomId));
      plan.items = plan.items.filter((entry) => !openingIds.includes(entry.openingId));
    }
    if (sel.kind === "opening") {
      plan.openings = plan.openings.filter((opening) => !sel.ids.includes(opening.id));
      plan.items = plan.items.filter((entry) => !sel.ids.includes(entry.openingId));
    }
    if (sel.kind === "flow") plan.flows = (plan.flows || []).filter((flow) => !sel.ids.includes(flow.id));
    if (sel.kind === "underlay") plan.underlay = null;
    if (sel.kind === "item") {
      const remove = new Set(sel.ids.filter((id) => !plan.items.find((entry) => entry.id === id)?.locked));
      for (const entry of plan.items) {
        if (entry.hostId && remove.has(entry.hostId) && !remove.has(entry.id)) {
          entry.hostId = null;
          entry.z = 0;
        }
      }
      plan.items = plan.items.filter((entry) => !remove.has(entry.id));
      for (const breaker of plan.breakers || []) {
        if (remove.has(breaker.itemId)) breaker.itemId = null;
      }
    }
    if (sel.kind === "panel") {
      const ids = new Set(sel.ids);
      const breakerIds = new Set((plan.breakers || []).filter((row) => ids.has(row.panelId)).map((row) => row.id));
      plan.panels = plan.panels.filter((row) => !ids.has(row.id));
      plan.breakers = plan.breakers.filter((row) => !ids.has(row.panelId));
      for (const outlet of plan.outlets || []) {
        if (breakerIds.has(outlet.breakerId)) outlet.breakerId = null;
      }
    }
    if (sel.kind === "breaker") {
      const ids = new Set(sel.ids);
      plan.breakers = plan.breakers.filter((row) => !ids.has(row.id));
      for (const outlet of plan.outlets || []) {
        if (ids.has(outlet.breakerId)) outlet.breakerId = null;
      }
    }
    if (sel.kind === "outlet") {
      const ids = new Set(sel.ids);
      plan.outlets = plan.outlets.filter((row) => !ids.has(row.id));
    }
  });
  if (sel.kind === "item") {
    const kept = sel.ids.filter((id) => store.get().items.some((entry) => entry.id === id && entry.locked));
    ui.select(kept.length ? { kind: "item", ids: kept } : null);
    return;
  }
  ui.select(null);
}

function duplicateSelection() {
  const sel = ui.selection;
  if (!sel || sel.kind === "underlay" || sel.kind === "panel" || sel.kind === "breaker" || sel.kind === "flow") return;
  if (sel.kind === "outlet") {
    const created = [];
    store.update((plan) => {
      for (const id of sel.ids) {
        const source = plan.outlets.find((row) => row.id === id);
        if (!source) continue;
        const copy = { ...source, id: uid(), x: source.x + 400, y: source.y + 400 };
        plan.outlets.push(copy);
        created.push(copy.id);
      }
    });
    if (created.length) ui.select({ kind: "outlet", ids: created });
    return;
  }
  if (sel.kind === "opening" || (sel.kind === "item" && sel.ids.some((id) => store.get().items.find((entry) => entry.id === id)?.openingId))) {
    return;
  }
  const created = [];
  const groups = new Map();
  store.update((plan) => {
    const list = sel.kind === "room" ? plan.rooms : plan.items;
    for (const id of sel.ids) {
      const obj = list.find((row) => row.id === id);
      if (!obj) continue;
      const copy = { ...structuredClone(obj), id: uid(), x: obj.x + 500, y: obj.y + 500, locked: false };
      if (obj.groupId) {
        if (!groups.has(obj.groupId)) groups.set(obj.groupId, uid());
        copy.groupId = groups.get(obj.groupId);
      }
      list.push(copy);
      created.push(copy.id);
    }
    if (sel.kind === "item") seatItems(plan, created);
  });
  if (created.length) ui.select({ kind: sel.kind, ids: created });
}

function rotateSelection() {
  const sel = ui.selection;
  if (sel?.kind !== "item") return;
  const targets = store.get().items.filter((entry) => sel.ids.includes(entry.id) && entry.place !== "wall" && !entry.openingId && !entry.locked);
  if (!targets.length) return;
  store.update((plan) => {
    for (const entry of plan.items) {
      if (targets.some((row) => row.id === entry.id)) entry.rot = (entry.rot + plan.settings.rotationStep) % 360;
    }
    const guests = plan.items.filter((entry) => targets.some((row) => row.id === entry.hostId)).map((entry) => entry.id);
    seatItems(plan, [...targets.map((row) => row.id), ...guests]);
  });
}

function setLocked(value) {
  const sel = ui.selection;
  if (sel?.kind !== "item") return;
  store.update((plan) => {
    for (const entry of plan.items) {
      if (sel.ids.includes(entry.id)) entry.locked = value;
    }
  });
  ui.select(sel);
}

function groupSelection() {
  const sel = ui.selection;
  if (sel?.kind !== "item" || sel.ids.length < 2) return;
  const groupId = uid();
  store.update((plan) => {
    for (const entry of plan.items) {
      if (sel.ids.includes(entry.id)) entry.groupId = groupId;
    }
  });
}

function ungroupSelection() {
  const sel = ui.selection;
  if (sel?.kind !== "item") return;
  store.update((plan) => {
    for (const entry of plan.items) {
      if (sel.ids.includes(entry.id)) entry.groupId = null;
    }
  });
}

function loadPlanListPref() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAN_LIST_KEY)) || {};
    const pageSize = Math.min(60, Math.max(1, Math.round(Number(saved.pageSize)) || 10));
    return { page: 0, pageSize, view: saved.view === "list" ? "list" : "thumb" };
  } catch {
    return { page: 0, pageSize: 10, view: "thumb" };
  }
}

function savePlanListPref() {
  localStorage.setItem(PLAN_LIST_KEY, JSON.stringify({ pageSize: planList.pageSize, view: planList.view }));
}

function setPlanView(view) {
  planList.view = view === "thumb" ? "thumb" : "list";
  savePlanListPref();
  renderPlanList();
}

function sortedPlans() {
  return store.list().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function renderPlanList() {
  const all = sortedPlans();
  const pages = Math.max(1, Math.ceil(all.length / planList.pageSize));
  planList.page = Math.min(pages - 1, Math.max(0, planList.page));
  const start = planList.page * planList.pageSize;
  const shown = all.slice(start, start + planList.pageSize);
  const activeId = store.get()?.id;
  const dialog = document.querySelector("#dialog-list");
  dialog.classList.toggle("thumbs", planList.view === "thumb");
  const sizeInput = document.querySelector("#plan-page-size");
  sizeInput.value = String(planList.pageSize);
  for (const [id, view] of [["#plan-view-list", "list"], ["#plan-view-thumb", "thumb"]]) {
    const button = document.querySelector(id);
    const on = planList.view === view;
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", String(on));
  }
  const host = document.querySelector("#plan-rows");
  host.innerHTML = shown.map((plan) => planCard(plan, plan.id === activeId)).join("");
  document.querySelector("#plan-pager").innerHTML = planPager(planList.page, pages, start, shown.length, all.length);
  host.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      store.open(button.dataset.open);
      dialog.close();
      renderSidebar();
      view2d.fit();
    });
  });
  host.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      store.open(button.dataset.copy);
      store.duplicate();
      planList.page = 0;
      renderPlanList();
      view2d.fit();
    });
  });
  host.querySelectorAll("[data-del]").forEach((button) => {
    button.addEventListener("click", () => {
      store.remove(button.dataset.del);
      renderPlanList();
      renderSidebar();
    });
  });
}

function planCard(plan, current) {
  const meta = `${formatPlanTime(plan.updatedAt)}　部屋 ${plan.preview.rooms.length}　器具 ${plan.preview.items.length}${current ? "　開いています" : ""}`;
  const actions = `
    <button type="button" data-copy="${plan.id}">複製</button>
    <button type="button" data-del="${plan.id}">削除</button>
  `;
  if (planList.view === "thumb") {
    return `
      <article class="plan-card${current ? " is-current" : ""}">
        <button type="button" class="plan-thumb" data-open="${plan.id}">
          ${planThumb(plan.preview)}
          <span class="plan-card-name">${escapeHtml(plan.name)}</span>
          <small>${escapeHtml(meta)}</small>
        </button>
        <div class="plan-card-actions">${actions}</div>
      </article>
    `;
  }
  return `
    <div class="plan-row${current ? " is-current" : ""}">
      <button type="button" data-open="${plan.id}">
        <span>${escapeHtml(plan.name)}</span>
        <small>${escapeHtml(meta)}</small>
      </button>
      ${actions}
    </div>
  `;
}

function planPager(page, pages, start, count, total) {
  const marks = pageWindow(page, pages).map((entry) => {
    if (entry === "gap") return `<span class="plan-page-gap">…</span>`;
    return `<button type="button" data-page="${entry}"${entry === page ? ` class="active" aria-current="page"` : ""}>${entry + 1}</button>`;
  }).join("");
  const range = total ? `${start + 1}–${start + count} / ${total}件` : "0件";
  return `
    <button type="button" data-page="prev"${page === 0 ? " disabled" : ""}>前へ</button>
    ${marks}
    <button type="button" data-page="next"${page >= pages - 1 ? " disabled" : ""}>次へ</button>
    <span class="plan-page-range">${range}</span>
  `;
}

function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index);
  const items = [0];
  const start = Math.max(1, page - 1);
  const end = Math.min(pages - 2, page + 1);
  if (start > 1) items.push("gap");
  for (let index = start; index <= end; index += 1) items.push(index);
  if (end < pages - 2) items.push("gap");
  items.push(pages - 1);
  return items;
}

function formatPlanTime(value) {
  if (!value) return "更新なし";
  const date = new Date(value);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}/${month}/${day} ${hours}:${minutes}`;
}

function planThumb(preview) {
  const rooms = (preview?.rooms || []).map((room) => ({
    color: svgColor(room.color, "#d5e4f2"),
    wall: svgColor(room.wall, "#8e98a3"),
    outline: room.points?.length >= 3 ? outlinePoints(room, 160) : [],
  })).filter((room) => room.outline.length >= 3);
  const items = (preview?.items || []).filter((item) => item.w > 0 && item.d > 0);
  const bounds = [];
  for (const room of rooms) bounds.push(...room.outline);
  for (const item of items) bounds.push(...itemCorners(item));
  if (!bounds.length) {
    return `<svg class="plan-thumb-svg" viewBox="0 0 160 100" aria-hidden="true"><rect width="160" height="100" fill="#eef4f2"/><text x="80" y="54" text-anchor="middle" fill="#7b8c89" font-size="13">図面なし</text></svg>`;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of bounds) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = span * 0.08;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  const floors = rooms.map((room) => {
    const points = room.outline.map((point) => `${point.x},${point.y}`).join(" ");
    return `<polygon points="${points}" fill="${room.color}" stroke="${room.wall}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  }).join("");
  const furniture = items.map((item) => `
    <rect x="${-item.w / 2}" y="${-item.d / 2}" width="${item.w}" height="${item.d}" fill="${svgColor(item.color, "#b7b1a4")}" stroke="rgba(0,0,0,0.4)" stroke-width="1" vector-effect="non-scaling-stroke" transform="translate(${item.x} ${item.y}) rotate(${item.rot})"/>
  `).join("");
  return `<svg class="plan-thumb-svg" viewBox="${viewBox}" aria-hidden="true">${floors}${furniture}</svg>`;
}

function itemCorners(item) {
  const rad = (item.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = item.w / 2;
  const halfD = item.d / 2;
  return [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]].map(([x, y]) => ({
    x: item.x + x * cos - y * sin,
    y: item.y + x * sin + y * cos,
  }));
}

function svgColor(value, fallback) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "")) ? value : fallback;
}

const DETAIL_COLUMNS = [
  ["name", "名称"],
  ["count", "数量"],
  ["size", "幅×奥行×高さ mm"],
  ["weight", "重量 kg"],
  ["co2", "CO2排出量 kt"],
  ["price", "単価"],
  ["amount", "金額"],
];
const DETAIL_DEFAULT = ["name", "count", "size"];
const DETAIL_KEY = "neosupo-star-beta7-detail-columns";

function loadDetailColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(DETAIL_KEY));
    if (!Array.isArray(saved)) return DETAIL_DEFAULT.slice();
    const known = new Set(DETAIL_COLUMNS.map(([id]) => id));
    return saved.filter((id) => known.has(id));
  } catch {
    return DETAIL_DEFAULT.slice();
  }
}

function saveDetailColumns(ids) {
  localStorage.setItem(DETAIL_KEY, JSON.stringify(ids));
}

function renderDetailColumns() {
  const on = new Set(loadDetailColumns());
  document.querySelector("#detail-column-list").innerHTML = DETAIL_COLUMNS.map(([id, label]) => `
    <label class="check"><input type="checkbox" data-detail-column="${id}" ${on.has(id) ? "checked" : ""} /> ${escapeHtml(label)}</label>
  `).join("");
}

function renderDetail() {
  const html = detailHtml(store.get());
  document.querySelector("#detail-body").innerHTML = html;
  document.querySelector("#print-sheet").innerHTML = html;
}

function detailHtml(plan) {
  const columns = loadDetailColumns();
  const lines = quoteLines(plan);
  const head = columns.map((id) => `<th>${escapeHtml(DETAIL_COLUMNS.find(([key]) => key === id)[1])}</th>`).join("");
  const rows = lines.map((line) => `<tr>${detailCells(line, columns).map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  const summary = detailSummary(plan, columns);
  const empty = columns.length ? `<tr><td colspan="${columns.length}">器具はまだありません。</td></tr>` : "";
  return `
    <p>${escapeHtml(plan.name)} / 天井高 ${plan.settings.ceiling}mm / 壁厚 ${plan.settings.wall}mm</p>
    ${summary ? `<p>${summary}</p>` : ""}
    ${columns.length ? `<table><thead><tr>${head}</tr></thead><tbody>${rows || empty}</tbody></table>` : `<p class="note">表示する項目がありません。表示設定から選んでください。</p>`}
  `;
}

function detailCells(line, columns) {
  return columns.map((id) => {
    if (id === "name") return escapeHtml(line.name);
    if (id === "count") return String(line.count);
    if (id === "size") return `${line.w}×${line.d}×${line.h}`;
    if (id === "weight") return line.weight == null ? "未設定" : formatKg(line.weight);
    if (id === "co2") return line.co2 == null ? "未設定" : formatKg(line.co2);
    if (id === "price") return line.price == null ? "未設定" : `¥${line.price.toLocaleString()}`;
    return line.price == null ? "未設定" : `¥${(line.price * line.count).toLocaleString()}`;
  });
}

function detailSummary(plan, columns) {
  const parts = [];
  if (columns.includes("price") || columns.includes("amount")) parts.push(totalLabel(plan));
  if (columns.includes("weight")) parts.push(weightLabel(plan));
  if (columns.includes("co2")) parts.push(co2Label(plan));
  return parts.join(" / ");
}

function quoteLines(plan) {
  const groups = new Map();
  for (const entry of plan.items) {
    const price = priceOf(entry);
    const weight = weightOf(entry);
    const co2 = co2Of(entry);
    const name = entry.design ? `${entry.name}（${entry.design}）` : entry.name;
    const key = [name, entry.w, entry.d, entry.h, price, weight, co2].join("|");
    const found = groups.get(key) || { name, count: 0, w: entry.w, d: entry.d, h: entry.h, price, weight, co2 };
    found.count += 1;
    groups.set(key, found);
  }
  return [...groups.values()];
}

function priceOf(entry) {
  if (entry.price == null || entry.price === "" || Number.isNaN(Number(entry.price))) return null;
  return Number(entry.price);
}

function weightOf(entry) {
  if (entry.weightKg == null || entry.weightKg === "" || Number.isNaN(Number(entry.weightKg))) return null;
  return Number(entry.weightKg);
}

function co2Of(entry) {
  if (entry.co2Kt == null || entry.co2Kt === "" || Number.isNaN(Number(entry.co2Kt))) return null;
  return Number(entry.co2Kt);
}

function formatKg(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function totalLabel(plan) {
  const lines = quoteLines(plan);
  const priced = lines.filter((line) => line.price != null);
  if (!priced.length) return "合計 未設定";
  const sum = priced.reduce((acc, line) => acc + line.price * line.count, 0);
  const missing = priced.length !== lines.length;
  return `合計 ¥${sum.toLocaleString()}${missing ? "（未設定あり）" : ""}`;
}

function weightLabel(plan) {
  const lines = quoteLines(plan);
  const weighed = lines.filter((line) => line.weight != null);
  if (!weighed.length) return "重量合計 未設定";
  const sum = weighed.reduce((acc, line) => acc + line.weight * line.count, 0);
  const missing = weighed.length !== lines.length;
  return `重量合計 ${formatKg(sum)} kg${missing ? "（未設定あり）" : ""}`;
}

function co2Label(plan) {
  const lines = quoteLines(plan);
  const known = lines.filter((line) => line.co2 != null);
  if (!known.length) return "CO2合計 未設定";
  const sum = known.reduce((acc, line) => acc + line.co2 * line.count, 0);
  const missing = known.length !== lines.length;
  return `CO2合計 ${formatKg(sum)} kt${missing ? "（未設定あり）" : ""}`;
}

async function saveView() {
  if (mode !== "3d") await setMode("3d");
  const pose = view3d?.getPose();
  if (!pose) return;
  const id = uid();
  const index = store.get().views.length + 1;
  store.update((plan) => {
    plan.views.push({ id, name: `視点 ${index}`, pose });
  });
  renderSidebar();
}

async function restoreView(id) {
  const view = store.get().views.find((entry) => entry.id === id);
  if (!view) return;
  await setMode("3d");
  view3d?.setPose(view.pose);
  markViewMode(view.pose?.mode || "sky");
}

async function exportImage() {
  await setMode("3d");
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  const url = view3d?.capture();
  if (!url) return;
  downloadUrl(url, `${store.get().name || "plan"}.png`);
  store.update((plan) => {
    plan.settings.exported = true;
  });
  renderSidebar();
}

async function exportExcel() {
  const plan = store.get();
  const buffer = await writeWorkbook(planToBook(plan));
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, `${safeName(plan.name)}.xlsx`);
  URL.revokeObjectURL(url);
}

async function importExcel(file) {
  try {
    const tables = await readTables(await file.arrayBuffer());
    store.importPlans(bookToPlan(tables));
    renderSidebar();
    view2d.fit();
  } catch (error) {
    console.error(error);
  }
}

function safeName(name) {
  return String(name || "plan").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 40) || "plan";
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  downloadUrl(url, filename);
  URL.revokeObjectURL(url);
}

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const max = 1400;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const board = document.createElement("canvas");
      board.width = Math.max(1, Math.round(image.width * scale));
      board.height = Math.max(1, Math.round(image.height * scale));
      board.getContext("2d").drawImage(image, 0, 0, board.width, board.height);
      URL.revokeObjectURL(url);
      resolve({ href: board.toDataURL("image/jpeg", 0.72), aspect: board.width / board.height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    image.src = url;
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createController() {
  const listeners = new Set();
  const state = { tab: "layout", tool: "select", showPlaced: localStorage.getItem("neosupo-star-beta7-layout-items") !== "0", showWalker: localStorage.getItem("neosupo-star-beta7-walker") !== "0", showEnv: false, showEnvLegend: localStorage.getItem("neosupo-star-beta7-env-legend") !== "0", envGrade: "B", envFlow: "enter", catalogId: null, roomType: "実験室", roomColor: "#d5e4f2", selection: null, wallPick: null, powerSymbol: null, powerPrompt: null };
  function emit() {
    listeners.forEach((fn) => fn());
  }
  return {
    get tool() { return state.tool; },
    get showPlaced() { return state.showPlaced; },
    get showWalker() { return state.showWalker; },
    get showEnv() { return state.showEnv; },
    get showEnvLegend() { return state.showEnvLegend; },
    get envGrade() { return state.envGrade; },
    get envFlow() { return state.envFlow; },
    get tab() { return state.tab; },
    get powerSymbol() { return state.powerSymbol; },
    get powerPrompt() { return state.powerPrompt; },
    get catalogId() { return state.catalogId; },
    get roomType() { return state.roomType; },
    get roomColor() { return state.roomColor; },
    get selection() { return state.selection; },
    get wallPick() { return state.wallPick; },
    pickWall(pick) {
      state.wallPick = pick;
      emit();
    },
    setTab(tab) {
      state.tab = tab;
      state.powerPrompt = null;
      emit();
    },
    setPowerSymbol(id) {
      state.powerSymbol = id;
      state.tool = "power";
      state.powerPrompt = null;
      emit();
    },
    setPowerPrompt(id) {
      state.powerPrompt = id;
      emit();
    },
    setShowPlaced(shown) {
      state.showPlaced = !!shown;
      localStorage.setItem("neosupo-star-beta7-layout-items", state.showPlaced ? "1" : "0");
      if (!state.showPlaced && state.tab === "layout" && state.selection?.kind === "item") state.selection = null;
      emit();
    },
    setShowWalker(shown) {
      state.showWalker = !!shown;
      localStorage.setItem("neosupo-star-beta7-walker", state.showWalker ? "1" : "0");
      emit();
    },
    setShowEnv(shown) {
      state.showEnv = !!shown;
      emit();
    },
    setShowEnvLegend(shown) {
      state.showEnvLegend = !!shown;
      localStorage.setItem("neosupo-star-beta7-env-legend", state.showEnvLegend ? "1" : "0");
      emit();
    },
    setEnvGrade(id) {
      state.envGrade = id || "";
      state.tool = "env-grade";
      emit();
    },
    setEnvFlow(id) {
      state.envFlow = id || "enter";
      state.tool = "env-flow";
      emit();
    },
    setTool(tool) {
      state.tool = tool;
      if (tool !== "item") state.catalogId = null;
      emit();
    },
    setCatalog(id) {
      state.catalogId = id;
      state.tool = "item";
      emit();
    },
    setRoom(name, color) {
      state.roomType = name;
      state.roomColor = color;
      state.tool = "room";
      emit();
    },
    get openingPreset() { return state.openingPreset; },
    setOpening(preset) {
      state.openingPreset = preset;
      state.tool = "opening";
      state.catalogId = null;
      emit();
    },
    select(selection) {
      if (!selection?.ids?.length) state.selection = null;
      else state.selection = { kind: selection.kind, ids: [...selection.ids] };
      state.wallPick = null;
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
