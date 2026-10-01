const DEFAULT_FIELDS = [
  "Full name", "First name", "Last name", "Email", "Phone",
  "Address line 1", "Address line 2", "City", "State / Region",
  "Postal code", "Country", "Date of birth", "Student ID",
  "University / School"
].map((label, i) => ({ id: "d" + i, label, value: "" }));

const $ = (id) => document.getElementById(id);
let fields = [];
let draft = [];
let editing = false;
let todos = [];
let savedNote = "";

/* ---------- storage ---------- */
async function load() {
  const data = await chrome.storage.local.get(["fields", "schedule", "todos", "note", "lastTab"]);
  fields = data.fields || DEFAULT_FIELDS;
  todos = data.todos || [];
  savedNote = data.note || "";
  $("note").value = savedNote;
  renderList();
  renderSchedule(data.schedule || null);
  renderTodos();
  showTab(data.lastTab || "details");
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1500);
}

/* ---------- tabs ---------- */
function showTab(name) {
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
  });
  chrome.storage.local.set({ lastTab: name });
  if (name === "todo") $("todo-input").focus();
  if (name === "notes") $("note").focus();
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

/* ---------- details ---------- */
function renderList() {
  const list = $("list");
  list.innerHTML = "";
  $("toolbar-view").hidden = editing;
  $("toolbar-edit").hidden = !editing;
  $("hint").hidden = editing;

  if (editing) {
    draft.forEach((f, i) => {
      const li = document.createElement("li");
      li.className = "edit-row";
      li.innerHTML = `
        <div class="top-line">
          <input type="text" class="lbl" aria-label="Field name" placeholder="Field name">
          <button class="btn danger del" aria-label="Delete field">Delete</button>
        </div>
        <textarea class="val" rows="1" aria-label="Value" placeholder="Value"></textarea>`;
      const lbl = li.querySelector(".lbl");
      const val = li.querySelector(".val");
      lbl.value = f.label;
      val.value = f.value;
      lbl.oninput = () => (draft[i].label = lbl.value);
      val.oninput = () => (draft[i].value = val.value);
      li.querySelector(".del").onclick = () => { draft.splice(i, 1); renderList(); };
      list.appendChild(li);
    });
    return;
  }

  const q = $("search").value.trim().toLowerCase();
  const shown = fields.filter(
    (f) => !q || f.label.toLowerCase().includes(q) || f.value.toLowerCase().includes(q)
  );
  if (!shown.length) {
    list.innerHTML = `<li class="empty">No matching details.</li>`;
    return;
  }
  shown.forEach((f) => {
    const li = document.createElement("li");
    li.className = "row";
    li.tabIndex = 0;
    li.innerHTML = `
      <div class="text"><div class="label"></div><div class="value"></div></div>
      <button class="btn insert" title="Fill the form field you last clicked on the page">Insert</button>`;
    li.querySelector(".label").textContent = f.label;
    const v = li.querySelector(".value");
    v.textContent = f.value || "Not set – click to add";
    v.classList.toggle("unset", !f.value);
    const ins = li.querySelector(".insert");
    ins.disabled = !f.value;
    const act = () => (f.value ? copyText(f.value) : startEdit());
    li.onclick = act;
    li.onkeydown = (e) => { if (e.key === "Enter" && e.target === li) act(); };
    ins.onclick = (e) => { e.stopPropagation(); insertText(f.value); };
    list.appendChild(li);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Copy failed");
  }
}

async function insertText(text) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      args: [text],
      func: (value) => {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
        if (!el) return false;
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
        } else if (el.isContentEditable) {
          el.textContent = value;
        } else {
          return false;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    });
    if (results.some((r) => r.result)) toast("Inserted");
    else { await copyText(text); toast("No field selected – copied instead"); }
  } catch {
    await copyText(text);
    toast("Can't fill this page – copied instead");
  }
}

function startEdit() {
  editing = true;
  draft = fields.map((f) => ({ ...f }));
  renderList();
}
$("btn-edit").onclick = startEdit;
$("btn-cancel").onclick = () => { editing = false; renderList(); };
$("btn-add").onclick = () => {
  draft.push({ id: "c" + Date.now(), label: "", value: "" });
  renderList();
  const rows = $("list").querySelectorAll(".lbl");
  rows[rows.length - 1].focus();
};
$("btn-save").onclick = async () => {
  fields = draft.filter((f) => f.label.trim() || f.value.trim())
                .map((f) => ({ ...f, label: f.label.trim() || "Untitled" }));
  await chrome.storage.local.set({ fields });
  editing = false;
  renderList();
  toast("Saved");
};
$("search").oninput = renderList;

/* ---------- schedule image ---------- */
function renderSchedule(dataUrl) {
  $("schedule-empty").hidden = !!dataUrl;
  $("schedule-view").hidden = !dataUrl;
  if (dataUrl) $("schedule-img").src = dataUrl;
}

function fileToDataUrl(file, maxDim = 2400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale === 1) return resolve(reader.result);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.92));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    await chrome.storage.local.set({ schedule: dataUrl });
    renderSchedule(dataUrl);
    toast("Schedule saved");
  } catch {
    toast("Couldn't read that image");
  }
  e.target.value = "";
}
$("file").onchange = onFile;
$("file2").onchange = onFile;

const openFull = () => chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
$("btn-full").onclick = openFull;
$("schedule-img").onclick = openFull;
$("btn-remove").onclick = async () => {
  if (!confirm("Remove the saved schedule image?")) return;
  await chrome.storage.local.remove("schedule");
  renderSchedule(null);
};

/* ---------- todo ---------- */
const saveTodos = () => chrome.storage.local.set({ todos });

function renderTodos() {
  const list = $("todo-list");
  list.innerHTML = "";
  todos.forEach((t) => {
    const li = document.createElement("li");
    li.className = "todo-row" + (t.done ? " done" : "");
    li.innerHTML = `
      <input type="checkbox" aria-label="Mark done">
      <span class="t"></span>
      <button class="x" aria-label="Delete todo" title="Delete">×</button>`;
    li.querySelector(".t").textContent = t.text;
    const cb = li.querySelector("input");
    cb.checked = t.done;
    cb.onchange = () => { t.done = cb.checked; saveTodos(); renderTodos(); };
    li.querySelector(".x").onclick = () => { todos = todos.filter((x) => x.id !== t.id); saveTodos(); renderTodos(); };
    list.appendChild(li);
  });
  const left = todos.filter((t) => !t.done).length;
  $("todo-footer").hidden = !todos.length;
  $("todo-count").textContent = left === 1 ? "1 left" : `${left} left`;
  $("todo-clear").disabled = left === todos.length;
}

function addTodo() {
  const text = $("todo-input").value.trim();
  if (!text) return;
  todos.unshift({ id: "t" + Date.now(), text, done: false });
  $("todo-input").value = "";
  saveTodos();
  renderTodos();
}
$("todo-add").onclick = addTodo;
$("todo-input").onkeydown = (e) => { if (e.key === "Enter") addTodo(); };
$("todo-clear").onclick = () => { todos = todos.filter((t) => !t.done); saveTodos(); renderTodos(); };

/* ---------- notes ---------- */
let noteTimer;
function setNoteStatus() {
  $("note-status").textContent = $("note").value === savedNote ? "Saved" : "Unsaved changes";
}
async function saveNote() {
  clearTimeout(noteTimer);
  savedNote = $("note").value;
  await chrome.storage.local.set({ note: savedNote });
  setNoteStatus();
}
$("note").oninput = () => {
  setNoteStatus();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(saveNote, 800); // auto-save so nothing is lost if the popup closes
};
$("note-save").onclick = async () => { await saveNote(); toast("Note saved"); };
$("note").onkeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); $("note-save").click(); }
};
window.addEventListener("pagehide", () => { if ($("note").value !== savedNote) saveNote(); });

load();
