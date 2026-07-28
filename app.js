/* =========================================================
   TaskChain — app.js
   Vanilla JS, no dependencies. Single source of truth: `state`.
   ========================================================= */

/* ---------- Status system ----------
   Statuses are no longer a fixed set: workspace.statuses is an array of
   { key, label, color } shared by every project, editable from the
   "⚙ Statuses" modal. `key` never changes once created (even if the
   label is renamed later) since tasks store it in task.status. */
function defaultStatuses() {
  return [
    { key: 'not_started', label: 'Not Started', color: '#ECEDF7' },
    { key: 'working', label: 'Working', color: '#9696FF' },
    { key: 'done', label: 'Done', color: '#0000FF' },
    { key: 'release_process', label: 'In Release Process', color: '#42FFF2' },
    { key: 'released', label: 'Released', color: '#00FF00' },
    { key: 'rework', label: 'Rework', color: '#DC2626' },
  ];
}
function getStatuses() { return workspace.statuses; }
function getStatusMeta(key) {
  return getStatuses().find(s => s.key === key) || { key, label: key || 'Unknown', color: '#9AA2AC' };
}
function generateStatusId() {
  return 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
// Mixes a hex color toward white (amount > 0) or black (amount < 0) by
// |amount| (0-1) — used for badge/chip backgrounds and for darkening
// colors that are too light to read as text (see readableStatusColor).
function tintColor(hex, amount) {
  const h = (hex || '#9AA2AC').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const target = amount >= 0 ? 255 : 0;
  const a = Math.abs(amount);
  const mix = (c) => Math.round(c + (target - c) * a);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
function relativeLuminance(hex) {
  const h = (hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// A status color can be any custom value (e.g. a very pale "Not
// Started" color), which would be unreadable used directly as text or
// as a thin line on a white surface. This darkens it just enough to
// stay legible while keeping its hue; normal colors pass through as-is.
// Only used where the color IS the text/stroke — plain accents (a left
// border, a filled diamond) use the raw color regardless of lightness.
function readableStatusColor(hex) {
  return relativeLuminance(hex) > 0.65 ? tintColor(hex, -0.55) : hex;
}
// White or dark text — whichever reads better on a solid fill of this color.
function contrastTextFor(hex) {
  return relativeLuminance(hex) > 0.6 ? '#1A1D23' : '#FFFFFF';
}

/* ---------- Priority ----------
   A fixed 3-level scale (unlike statuses, not user-configurable). */
const PRIORITY_META = {
  low: { label: 'Low', color: '#6B7280' },
  medium: { label: 'Medium', color: '#2563EB' },
  high: { label: 'High', color: '#DC2626' },
};
function priorityBadge(priority) {
  const meta = PRIORITY_META[priority] || PRIORITY_META.medium;
  return `<span class="priority-badge" style="color:${meta.color};">${meta.label}</span>`;
}

const ZOOM_LEVELS = [6, 9, 13, 18, 26, 36, 48, 64]; // px per day, timeline
const TREE_ZOOM_LEVELS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.75, 2]; // tree diagram scale
const STORAGE_KEY = 'taskchain_state_v2';       // legacy single-project key, read once for migration
const WORKSPACE_KEY = 'taskchain_workspace_v1'; // current multi-project storage
const SIDEBAR_COLLAPSED_KEY = 'taskchain_sidebar_collapsed';
const APP_VERSION = 'v2.4';

/* ---------- State ----------
   `workspace` holds every project; `state` is always a direct reference
   to the currently active project inside workspace.projects, so every
   existing function that reads/writes state.tasks, state.meta, etc.
   keeps working unchanged — switching projects just repoints `state`. */
let workspace = loadWorkspace() || createDefaultWorkspace();
let state = getActiveProject();
let ui = {
  activeTab: 'list',
  search: '',
  statusFilter: 'all',
  editingTaskId: null,
  draftHistory: [],
  draftCategories: [],
  draftParents: [],
  dragTaskId: null,
  zoomIndex: 4,
  treeZoomIndex: 3,
  sortColumn: 'id',
  sortDirection: 'asc',
  collapsedCategories: new Set(),
  collapsedKanbanColumns: new Set(),
};

function generateProjectId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function createEmptyProject(name) {
  return {
    id: generateProjectId(),
    meta: { projectName: name || 'Untitled project', lastModified: nowISO() },
    tasks: [],
    categories: [],
    nextIdNum: 1,
    locked: false,
  };
}
function createDefaultWorkspace() {
  const p = createEmptyProject('Untitled project');
  return { projects: [p], activeProjectId: p.id, statuses: defaultStatuses() };
}
function getActiveProject() {
  return workspace.projects.find(p => p.id === workspace.activeProjectId) || workspace.projects[0];
}

function nowISO() { return new Date().toISOString(); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* =========================================================
   PERSISTENCE
   ========================================================= */
function normalizeProject(p) {
  p.tasks = p.tasks || [];
  p.tasks.forEach(t => {
    t.parents = t.parents || [];
    t.history = t.history || [];
    t.categories = t.categories || [];
    t.description = t.description || '';
    if (!['low', 'medium', 'high'].includes(t.priority)) t.priority = 'medium';
  });
  p.categories = p.categories || [];
  p.locked = !!p.locked;
  if (!p.meta) p.meta = { projectName: 'Imported project', lastModified: nowISO() };
  if (!p.meta.projectName) p.meta.projectName = 'Imported project';
  if (!p.nextIdNum) {
    const maxN = p.tasks.reduce((m, t) => {
      const n = parseInt(String(t.id).split('-')[1], 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    p.nextIdNum = maxN + 1;
  }
  if (!p.id) p.id = generateProjectId();
  return p;
}

function normalizeWorkspace(w) {
  w.projects = (w.projects || []).map(normalizeProject);
  if (!w.projects.length) w.projects.push(createEmptyProject('Untitled project'));
  if (!w.activeProjectId || !w.projects.some(p => p.id === w.activeProjectId)) {
    w.activeProjectId = w.projects[0].id;
  }
  if (!Array.isArray(w.statuses) || !w.statuses.length) {
    w.statuses = defaultStatuses();
  } else {
    w.statuses.forEach(s => { if (!s.color) s.color = '#9AA2AC'; if (!s.label) s.label = s.key; });
  }
  return w;
}

function loadWorkspace() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.projects) && parsed.projects.length) return normalizeWorkspace(parsed);
    }
  } catch (e) { /* fall through to migration */ }

  // One-time migration from the old single-project storage format.
  try {
    const legacyRaw = localStorage.getItem(STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (legacy && Array.isArray(legacy.tasks)) {
        normalizeProject(legacy);
        return normalizeWorkspace({ projects: [legacy], activeProjectId: legacy.id });
      }
    }
  } catch (e) { /* ignore, fall through to a fresh workspace */ }

  return null;
}

function saveState() {
  state.meta.lastModified = nowISO();
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
    document.getElementById('saveIndicator').textContent = 'Saved';
  } catch (e) { /* storage unavailable — ignore silently */ }
}

/* =========================================================
   DATE HELPERS — calendar days (for pixel positioning)
   All parsing/formatting stays in LOCAL calendar time (no toISOString
   round-trips): toISOString() converts through UTC, which silently
   shifts a date by one day in any timezone ahead of UTC. That was the
   root cause of dates drifting near weekends.
   ========================================================= */
function parseDateLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatDateLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(dateStr, days) {
  const dt = parseDateLocal(dateStr);
  dt.setDate(dt.getDate() + days);
  return formatDateLocal(dt);
}
function daysBetween(a, b) {
  const d1 = parseDateLocal(a);
  const d2 = parseDateLocal(b);
  return Math.round((d2 - d1) / 86400000);
}
function formatDate(dateStr) {
  if (!dateStr) return '—';
  return parseDateLocal(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function dayOfWeek(dateStr) { return parseDateLocal(dateStr).getDay(); } // 0=Sun..6=Sat
function isWeekend(dateStr) { const d = dayOfWeek(dateStr); return d === 0 || d === 6; }

/* =========================================================
   DATE HELPERS — business days (weekends excluded from all duration math)
   ========================================================= */
function nextBusinessDay(dateStr) {
  let d = addDays(dateStr, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}
function previousBusinessDay(dateStr) {
  let d = addDays(dateStr, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}
function addBusinessDays(dateStr, n) {
  let d = dateStr;
  for (let i = 0; i < n; i++) d = nextBusinessDay(d);
  return d;
}
function subtractBusinessDays(dateStr, n) {
  let d = dateStr;
  for (let i = 0; i < n; i++) d = previousBusinessDay(d);
  return d;
}

// Splits [start, finish] into the maximal runs of consecutive business
// days it contains, so a bar spanning a weekend can be drawn as two (or
// more) separate segments instead of one continuous rectangle.
function computeBusinessRuns(start, finish) {
  const runs = [];
  let runStart = null;
  let cur = start;
  while (true) {
    const weekend = isWeekend(cur);
    if (!weekend && runStart === null) runStart = cur;
    if (weekend && runStart !== null) {
      runs.push([runStart, addDays(cur, -1)]);
      runStart = null;
    }
    if (cur === finish) {
      if (runStart !== null) runs.push([runStart, finish]);
      break;
    }
    cur = addDays(cur, 1);
  }
  return runs;
}

/* =========================================================
   TASK HELPERS
   ========================================================= */
function getTask(id) { return state.tasks.find(t => t.id === id); }

function generateId() {
  const id = `T-${state.nextIdNum}`;
  state.nextIdNum += 1;
  return id;
}

// Direct children = tasks whose parents[] includes taskId
function getChildren(taskId) {
  return state.tasks.filter(t => t.parents.includes(taskId));
}

// All descendants (children, grandchildren, ...), cycle-safe
function getDescendants(taskId, visited = new Set()) {
  const result = [];
  for (const child of getChildren(taskId)) {
    if (visited.has(child.id)) continue;
    visited.add(child.id);
    result.push(child);
    result.push(...getDescendants(child.id, visited));
  }
  return result;
}

// All ancestors (parents, grandparents, ...), cycle-safe
function getAncestors(taskId, visited = new Set()) {
  const task = getTask(taskId);
  if (!task) return [];
  const result = [];
  for (const pid of task.parents) {
    if (visited.has(pid)) continue;
    const p = getTask(pid);
    if (!p) continue;
    visited.add(pid);
    result.push(p);
    result.push(...getAncestors(pid, visited));
  }
  return result;
}

/* =========================================================
   CATEGORIES
   Per-project, strictly hierarchical (single parent per category —
   unlike tasks, there's no need for a DAG here). Used purely to
   classify and help locate tasks; it doesn't feed the schedule engine
   or any cascade logic at all.
   ========================================================= */
function generateCategoryId() {
  return 'cat' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function getCategories() { return state.categories; }
function getCategory(id) { return getCategories().find(c => c.id === id); }
function getCategoryChildren(parentId) {
  return getCategories().filter(c => c.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
}
function getCategoryDescendantIds(id, visited = new Set()) {
  const result = [];
  getCategoryChildren(id).forEach(c => {
    if (visited.has(c.id)) return;
    visited.add(c.id);
    result.push(c.id);
    result.push(...getCategoryDescendantIds(c.id, visited));
  });
  return result;
}
function isCategoryOrDescendant(candidateId, ofId) {
  return candidateId === ofId || getCategoryDescendantIds(ofId).includes(candidateId);
}
// Does this category (or any of its subcategories) contain at least one
// of the given tasks? Used to skip empty branches in the parent picker.
function categoryHasTasks(cat, taskList) {
  if (taskList.some(t => (t.categories || []).includes(cat.id))) return true;
  return getCategoryChildren(cat.id).some(c => categoryHasTasks(c, taskList));
}

async function handleAddCategory(parentId) {
  if (guardLocked('add categories')) return;
  const name = await showPrompt(parentId ? 'New subcategory name' : 'New category name', 'New category');
  if (name === null) return;
  state.categories.push({ id: generateCategoryId(), name: name.trim() || 'New category', parentId: parentId || null });
  if (parentId) ui.collapsedCategories.delete(parentId);
  saveState();
  renderCategoryTab();
}

async function handleRenameCategory(id) {
  if (guardLocked('rename categories')) return;
  const cat = getCategory(id);
  if (!cat) return;
  const name = await showPrompt('Rename category', cat.name);
  if (name === null) return;
  cat.name = name.trim() || cat.name;
  saveState();
  renderCategoryTab();
}

async function handleDeleteCategory(id) {
  if (guardLocked('delete categories')) return;
  const cat = getCategory(id);
  if (!cat) return;
  const descendantIds = getCategoryDescendantIds(id);
  const affectedIds = [id, ...descendantIds];
  const affectedTaskCount = state.tasks.filter(t => (t.categories || []).some(cid => affectedIds.includes(cid))).length;

  let msg = `Delete category "${cat.name}"`;
  if (descendantIds.length) msg += ` and its ${descendantIds.length} subcategor${descendantIds.length === 1 ? 'y' : 'ies'}`;
  msg += '?';
  if (affectedTaskCount) msg += ` ${affectedTaskCount} task(s) will be uncategorized from it.`;

  const choice = await showConfirm(msg, [
    { label: 'Cancel', value: 'no' },
    { label: 'Delete', value: 'delete', danger: true, primary: true },
  ]);
  if (choice !== 'delete') return;

  state.categories = state.categories.filter(c => !affectedIds.includes(c.id));
  state.tasks.forEach(t => { t.categories = (t.categories || []).filter(cid => !affectedIds.includes(cid)); });
  saveState();
  renderCategoryTab();
  toast('Category deleted.');
}

function moveCategoryTo(categoryId, newParentId) {
  if (isActiveProjectLocked()) { guardLocked('move categories'); return false; }
  if (categoryId === newParentId) return false;
  const cat = getCategory(categoryId);
  if (!cat) return false;
  if (newParentId && isCategoryOrDescendant(newParentId, categoryId)) return false; // would create a cycle
  cat.parentId = newParentId || null;
  saveState();
  renderCategoryTab();
  return true;
}

function renderCategoryTab() {
  const wrap = document.getElementById('categoryTreeWrap');
  const roots = getCategoryChildren(null);

  if (!getCategories().length) {
    wrap.innerHTML = '<div class="empty-state"><p>No categories yet.</p><button class="btn btn-primary" id="btnEmptyNewCategory">Create your first category</button></div>';
    document.getElementById('btnEmptyNewCategory').onclick = () => handleAddCategory(null);
    wireCategoryRootDrop(wrap);
    return;
  }

  const container = document.createElement('div');
  container.className = 'cat-root-list';
  roots.forEach(c => container.appendChild(renderCategoryNode(c)));
  wrap.innerHTML = '';
  wrap.appendChild(container);
  wireCategoryRootDrop(wrap);
}

function renderCategoryNode(cat) {
  const node = document.createElement('div');
  node.className = 'cat-node';

  const children = getCategoryChildren(cat.id);
  const collapsed = ui.collapsedCategories.has(cat.id);
  const taskCount = state.tasks.filter(t => (t.categories || []).includes(cat.id)).length;

  const row = document.createElement('div');
  row.className = 'cat-row';
  row.dataset.id = cat.id;

  const toggle = document.createElement('button');
  toggle.className = 'cat-toggle' + (children.length ? '' : ' leaf');
  toggle.textContent = collapsed ? '▶' : '▼';
  toggle.onclick = () => {
    if (collapsed) ui.collapsedCategories.delete(cat.id); else ui.collapsedCategories.add(cat.id);
    renderCategoryTab();
  };
  row.appendChild(toggle);

  const card = document.createElement('div');
  card.className = 'cat-card';
  card.draggable = !isActiveProjectLocked();
  card.innerHTML = `
    <span class="cat-name">${escapeHtml(cat.name)}</span>
    <span class="cat-count">${taskCount} task${taskCount === 1 ? '' : 's'}</span>
    <span class="cat-actions">
      <button data-action="add" title="Add subcategory">+</button>
      <button data-action="rename" title="Rename">✏</button>
      <button data-action="delete" title="Delete">🗑</button>
    </span>`;
  card.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'add') handleAddCategory(cat.id);
      else if (action === 'rename') handleRenameCategory(cat.id);
      else if (action === 'delete') handleDeleteCategory(cat.id);
    };
  });
  row.appendChild(card);
  node.appendChild(row);

  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', cat.id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  card.addEventListener('dragend', () => row.classList.remove('dragging'));
  card.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); row.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    row.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === cat.id) return;
    if (!moveCategoryTo(draggedId, cat.id)) toast("Can't move a category into its own subcategory.");
  });

  if (children.length && !collapsed) {
    const childWrap = document.createElement('div');
    childWrap.className = 'cat-children';
    children.forEach(c => childWrap.appendChild(renderCategoryNode(c)));
    node.appendChild(childWrap);
  }

  return node;
}

// Dropping on the empty tree background (not on any category card)
// moves a category back to the top level.
function wireCategoryRootDrop(wrap) {
  wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drag-over-root'); });
  wrap.addEventListener('dragleave', e => { if (e.target === wrap) wrap.classList.remove('drag-over-root'); });
  wrap.addEventListener('drop', e => {
    wrap.classList.remove('drag-over-root');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId) moveCategoryTo(draggedId, null);
  });
}

function initCategoryTab() {
  document.getElementById('btnNewCategory').onclick = () => handleAddCategory(null);
}

/* =========================================================
   SCHEDULE ENGINE
   For every task computes { finish, finishSource, start, conflict }.
   Dates propagate in BOTH directions and the whole graph is relaxed
   repeatedly until nothing changes:
   - BACKWARD: a task with no deadline of its own can still get one
     once ALL the children that depend on it have a start date —
     its finish is then the business day right before the earliest
     of those starts ("derived").
   - FORWARD: once a task's finish is known (explicit or derived), any
     child that still has no date of its own can start the next
     business day after it.
   Resolving one task this way can be exactly what unlocks a sibling
   or a task further down/up the chain, so this repeats until a fixed
   point is reached — bounded by the task count, since a task's dates
   only ever move from "unknown" to "known" once, so this always
   terminates even with cyclical links.
   All math is business-day aware (weekends excluded).
   ========================================================= */
function computeSchedule() {
  const finish = {}, finishSource = {}, start = {};
  state.tasks.forEach(t => {
    finish[t.id] = t.deadline || null;
    finishSource[t.id] = t.deadline ? 'explicit' : null;
    start[t.id] = null;
  });

  const deriveStartFromFinish = (task) => {
    if (finish[task.id] == null || start[task.id] != null) return;
    start[task.id] = (task.duration != null && task.duration > 0)
      ? subtractBusinessDays(finish[task.id], task.duration - 1)
      : finish[task.id];
  };
  const deriveFinishFromStart = (task) => {
    if (start[task.id] == null || finish[task.id] != null) return;
    finish[task.id] = (task.duration != null && task.duration > 0)
      ? addBusinessDays(start[task.id], task.duration - 1)
      : start[task.id];
    finishSource[task.id] = 'derived';
  };

  state.tasks.forEach(deriveStartFromFinish);

  let changed = true;
  let guard = 0;
  const maxIterations = state.tasks.length + 5;
  while (changed && guard < maxIterations) {
    changed = false;
    guard++;
    for (const task of state.tasks) {
      if (finish[task.id] == null) {
        let candidate = null;
        for (const c of getChildren(task.id)) {
          if (start[c.id] != null) {
            const cand = previousBusinessDay(start[c.id]);
            if (candidate === null || cand < candidate) candidate = cand;
          }
        }
        if (candidate !== null) {
          finish[task.id] = candidate;
          finishSource[task.id] = 'derived';
          deriveStartFromFinish(task);
          changed = true;
        }
      }
      if (start[task.id] == null) {
        let candidate = null;
        for (const pid of task.parents) {
          if (finish[pid] != null) {
            const cand = nextBusinessDay(finish[pid]);
            if (candidate === null || cand > candidate) candidate = cand;
          }
        }
        if (candidate !== null) {
          start[task.id] = candidate;
          deriveFinishFromStart(task);
          changed = true;
        }
      }
    }
  }

  // Final pass purely to flag deadline conflicts: the tightest finish a
  // task's children require, regardless of whether that value ended up
  // being used (an explicit deadline always wins as the displayed date).
  const out = {};
  state.tasks.forEach(task => {
    let backwardRequirement = null;
    for (const c of getChildren(task.id)) {
      if (start[c.id] != null) {
        const cand = previousBusinessDay(start[c.id]);
        if (backwardRequirement === null || cand < backwardRequirement) backwardRequirement = cand;
      }
    }
    const conflict = !!(task.deadline && backwardRequirement && backwardRequirement < task.deadline);
    out[task.id] = {
      finish: finish[task.id],
      finishSource: finishSource[task.id],
      start: start[task.id],
      conflict,
      derivedFinish: backwardRequirement,
    };
  });
  return out;
}

/* =========================================================
   CRUD
   ========================================================= */
function upsertTaskFromForm() {
  const id = document.getElementById('taskFormId').value || null;
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { toast('A title is required.'); return null; }

  const description = document.getElementById('taskDescription').value.trim();
  const status = document.getElementById('taskStatus').value;
  const priorityBtn = document.querySelector('#priorityToggle button.active');
  const priority = priorityBtn ? priorityBtn.dataset.priority : 'medium';
  const link = document.getElementById('taskLink').value.trim();
  const deadline = document.getElementById('taskDeadline').value || null;
  const durationRaw = document.getElementById('taskDuration').value;
  const duration = durationRaw === '' ? null : Math.max(0, parseInt(durationRaw, 10));
  const parents = ui.draftParents.slice();
  const categories = ui.draftCategories.slice();
  const history = ui.draftHistory.slice();

  if (id) {
    const task = getTask(id);
    task.title = title;
    task.description = description;
    task.link = link;
    task.deadline = deadline;
    task.duration = duration;
    task.parents = parents.filter(p => p !== id);
    task.categories = categories;
    task.priority = priority;
    task.history = history;
    task.status = status; // status transitions themselves are logged via the status-change modal
    saveState();
    toast(`Task ${id} updated.`);
    return id;
  } else {
    const newId = generateId();
    const task = {
      id: newId, title, description, link, status, priority, deadline, duration,
      parents, categories,
      history: history.length ? history : [{ date: todayStr(), note: 'Task created' }],
      createdAt: nowISO(),
    };
    state.tasks.push(task);
    saveState();
    toast(`Task ${newId} created.`);
    return newId;
  }
}

function deleteTaskById(id, reparent) {
  const task = getTask(id);
  if (!task) return;
  const children = getChildren(id);
  for (const c of children) {
    c.parents = c.parents.filter(p => p !== id);
    if (reparent) {
      for (const gp of task.parents) {
        if (!c.parents.includes(gp)) c.parents.push(gp);
      }
    }
  }
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState();
}

/* =========================================================
   TOAST
   ========================================================= */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* =========================================================
   CONFIRM / CHOICE MODAL
   ========================================================= */
function showConfirm(message, buttons) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmMessage').textContent = message;
    const btnWrap = document.getElementById('confirmButtons');
    btnWrap.innerHTML = '';
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.primary ? 'btn-primary' : (b.danger ? 'btn-danger-ghost' : 'btn-ghost'));
      btn.textContent = b.label;
      btn.onclick = () => { overlay.classList.remove('open'); resolve(b.value); };
      btnWrap.appendChild(btn);
    });
    overlay.classList.add('open');
  });
}

function showPrompt(message, defaultValue) {
  return new Promise(resolve => {
    const overlay = document.getElementById('promptOverlay');
    document.getElementById('promptMessage').textContent = message;
    const input = document.getElementById('promptInput');
    input.value = defaultValue || '';
    const cleanup = (result) => { overlay.classList.remove('open'); resolve(result); };
    document.getElementById('promptCancel').onclick = () => cleanup(null);
    document.getElementById('promptConfirm').onclick = () => cleanup(input.value);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); cleanup(input.value); } };
    overlay.classList.add('open');
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/* =========================================================
   PROJECTS (workspace sidebar)
   Every project is a self-contained object with its own tasks,
   exactly like the old single-project `state` shape, just tagged with
   an id and kept in workspace.projects. Switching projects repoints
   the shared `state` reference, so the rest of the app (list, tree,
   planning, modals...) needs no awareness of multi-project support.
   ========================================================= */
function switchToProject(id) {
  const target = workspace.projects.find(p => p.id === id);
  if (!target || target === state) return;
  workspace.activeProjectId = id;
  state = target;
  saveState();
  renderAll();
}

// A locked project can still be viewed and switched to, but every
// mutating action (task CRUD, status changes, drags, category edits,
// rename/delete of the project itself) is blocked until it's unlocked
// again — this is purely to prevent accidentally editing the wrong
// project, not a real access-control feature.
function isActiveProjectLocked() { return !!state.locked; }
function guardLocked(actionLabel) {
  if (isActiveProjectLocked()) {
    toast(`"${state.meta.projectName}" is locked — unlock it in the sidebar to ${actionLabel}.`);
    return true;
  }
  return false;
}

function handleToggleProjectLock(id) {
  const p = workspace.projects.find(x => x.id === id);
  if (!p) return;
  p.locked = !p.locked;
  saveState();
  renderSidebar();
  if (p.id === workspace.activeProjectId) renderAll();
  toast(p.locked ? `"${p.meta.projectName}" locked.` : `"${p.meta.projectName}" unlocked.`);
}

async function handleNewProject() {
  const name = await showPrompt('Name this project', 'Untitled project');
  if (name === null) return;
  const p = createEmptyProject(name.trim() || 'Untitled project');
  workspace.projects.push(p);
  switchToProject(p.id);
  toast(`Project "${p.meta.projectName}" created.`);
}

function handleDuplicateProject(id) {
  const src = workspace.projects.find(p => p.id === id);
  if (!src) return;
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = generateProjectId();
  clone.meta.projectName = `${src.meta.projectName} (copy)`;
  clone.meta.lastModified = nowISO();
  clone.locked = false; // a duplicate starts unlocked even if the original was locked
  workspace.projects.splice(workspace.projects.indexOf(src) + 1, 0, clone);
  switchToProject(clone.id);
  toast(`Duplicated as "${clone.meta.projectName}".`);
}

async function handleRenameProject(id) {
  const p = workspace.projects.find(x => x.id === id);
  if (!p) return;
  if (p.locked) { toast(`"${p.meta.projectName}" is locked — unlock it first to rename it.`); return; }
  const name = await showPrompt('Rename project', p.meta.projectName);
  if (name === null) return;
  p.meta.projectName = name.trim() || p.meta.projectName;
  p.meta.lastModified = nowISO();
  saveState();
  if (p.id === workspace.activeProjectId) document.getElementById('projectNameInput').value = p.meta.projectName;
  renderSidebar();
}

async function handleDeleteProject(id) {
  const p = workspace.projects.find(x => x.id === id);
  if (!p) return;
  if (p.locked) { toast(`"${p.meta.projectName}" is locked — unlock it first to delete it.`); return; }
  const choice = await showConfirm(
    `Permanently delete project "${p.meta.projectName}" (${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'})? This can't be undone unless you've exported it.`,
    [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Delete', value: 'delete', danger: true, primary: true },
    ]
  );
  if (choice !== 'delete') return;

  const idx = workspace.projects.indexOf(p);
  workspace.projects.splice(idx, 1);
  if (!workspace.projects.length) workspace.projects.push(createEmptyProject('Untitled project'));

  if (workspace.activeProjectId === id) {
    const next = workspace.projects[Math.max(0, idx - 1)] || workspace.projects[0];
    workspace.activeProjectId = next.id;
    state = next;
  }
  saveState();
  renderAll();
  toast('Project deleted.');
}

function renderSidebar() {
  const list = document.getElementById('sidebarProjectList');
  // Deliberately NOT sorted by last-modified: switching projects
  // updates that timestamp, which would otherwise reshuffle the list
  // right as you click something — the order stays exactly as-is
  // (insertion order) so the list is a stable, predictable reference.
  list.innerHTML = workspace.projects.map(p => {
    const active = p.id === workspace.activeProjectId;
    const count = p.tasks.length;
    const lockIndicator = p.locked ? '<span class="sidebar-lock-indicator" title="This project is locked">🔒</span>' : '';
    return `<div class="sidebar-project-item${active ? ' active' : ''}${p.locked ? ' locked' : ''}" data-id="${p.id}">
      <div class="sidebar-project-info">
        <div class="sidebar-project-name" title="${escapeAttr(p.meta.projectName)}">${lockIndicator}${escapeHtml(p.meta.projectName)}</div>
        <div class="sidebar-project-meta">${count} task${count === 1 ? '' : 's'}</div>
      </div>
      <div class="sidebar-project-actions">
        <button data-action="lock" title="${p.locked ? 'Unlock this project' : 'Lock this project to prevent accidental changes'}">${p.locked ? '🔓' : '🔒'}</button>
        <button data-action="rename" title="Rename">✏</button>
        <button data-action="duplicate" title="Duplicate">⧉</button>
        <button data-action="export" title="Export this project as JSON">⬇</button>
        <button data-action="delete" title="Delete">🗑</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.sidebar-project-item').forEach(row => {
    const id = row.dataset.id;
    row.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) { switchToProject(id); return; }
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      if (action === 'lock') handleToggleProjectLock(id);
      else if (action === 'rename') handleRenameProject(id);
      else if (action === 'duplicate') handleDuplicateProject(id);
      else if (action === 'delete') handleDeleteProject(id);
      else if (action === 'export') {
        const p = workspace.projects.find(x => x.id === id);
        if (p) exportProjectJSON(p);
      }
    });
  });
}

function initSidebar() {
  const sidebarEl = document.getElementById('sidebar');
  const appEl = document.getElementById('app');
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  sidebarEl.classList.toggle('collapsed', collapsed);
  appEl.classList.toggle('sidebar-collapsed', collapsed);
  document.getElementById('btnSidebarToggle').onclick = () => {
    sidebarEl.classList.toggle('collapsed');
    const nowCollapsed = sidebarEl.classList.contains('collapsed');
    appEl.classList.toggle('sidebar-collapsed', nowCollapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nowCollapsed);
  };
  document.getElementById('btnNewProject').onclick = handleNewProject;
  renderSidebar();
}

/* =========================================================
   STATUS SETTINGS
   Statuses are shared across every project in the workspace. Deleting
   one that's still in use moves the affected tasks (in ALL projects,
   not just the active one) to the next remaining status.
   ========================================================= */
function renderStatusSettingsList() {
  const wrap = document.getElementById('statusSettingsList');
  const statuses = getStatuses();
  wrap.innerHTML = statuses.map((s, i) => `
    <div class="status-setting-row">
      <input type="color" class="status-color-input" value="${s.color}" data-key="${s.key}" title="Color">
      <input type="text" class="status-label-input" value="${escapeAttr(s.label)}" data-key="${s.key}">
      <div class="status-setting-actions">
        <button data-action="up" data-key="${s.key}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button data-action="down" data-key="${s.key}" ${i === statuses.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button data-action="delete" data-key="${s.key}" title="Delete">🗑</button>
      </div>
    </div>`).join('');

  wrap.querySelectorAll('.status-color-input').forEach(el => {
    el.oninput = () => {
      const s = getStatuses().find(x => x.key === el.dataset.key);
      if (!s) return;
      s.color = el.value;
      saveState();
      renderAll();
    };
  });
  wrap.querySelectorAll('.status-label-input').forEach(el => {
    el.onchange = () => {
      const s = getStatuses().find(x => x.key === el.dataset.key);
      if (!s) return;
      s.label = el.value.trim() || s.label;
      el.value = s.label;
      saveState();
      renderAll();
    };
  });
  wrap.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = async () => {
      const key = btn.dataset.key;
      const action = btn.dataset.action;
      const idx = workspace.statuses.findIndex(x => x.key === key);
      if (idx === -1) return;
      if (action === 'up' && idx > 0) {
        [workspace.statuses[idx - 1], workspace.statuses[idx]] = [workspace.statuses[idx], workspace.statuses[idx - 1]];
      } else if (action === 'down' && idx < workspace.statuses.length - 1) {
        [workspace.statuses[idx + 1], workspace.statuses[idx]] = [workspace.statuses[idx], workspace.statuses[idx + 1]];
      } else if (action === 'delete') {
        await handleDeleteStatus(key);
        return; // handleDeleteStatus already re-renders
      }
      saveState();
      renderAll();
      renderStatusSettingsList();
    };
  });
}

async function handleDeleteStatus(key) {
  if (workspace.statuses.length <= 1) { toast('You need at least one status.'); return; }
  const meta = getStatusMeta(key);
  const fallback = workspace.statuses.find(s => s.key !== key);
  const usageCount = workspace.projects.reduce((sum, p) => sum + p.tasks.filter(t => t.status === key).length, 0);

  if (usageCount > 0) {
    const choice = await showConfirm(
      `${usageCount} task(s) across your projects currently use "${meta.label}". Deleting it will move them to "${fallback.label}". Continue?`,
      [
        { label: 'Cancel', value: 'no' },
        { label: 'Delete status', value: 'yes', danger: true, primary: true },
      ]
    );
    if (choice !== 'yes') return;
    workspace.projects.forEach(p => p.tasks.forEach(t => { if (t.status === key) t.status = fallback.key; }));
  }

  workspace.statuses = workspace.statuses.filter(s => s.key !== key);
  saveState();
  renderAll();
  renderStatusSettingsList();
  toast('Status deleted.');
}

async function handleAddStatus() {
  const name = await showPrompt('New status name', 'New status');
  if (name === null) return;
  const palette = ['#2563EB', '#B45309', '#15803D', '#0891B2', '#DC2626', '#7C3AED', '#DB2777', '#65A30D'];
  const color = palette[workspace.statuses.length % palette.length];
  workspace.statuses.push({ key: generateStatusId(), label: name.trim() || 'New status', color });
  saveState();
  renderAll();
  renderStatusSettingsList();
}

function initStatusSettings() {
  const overlay = document.getElementById('statusSettingsOverlay');
  document.getElementById('btnStatusSettings').onclick = () => {
    renderStatusSettingsList();
    overlay.classList.add('open');
  };
  document.getElementById('statusSettingsClose').onclick = () => overlay.classList.remove('open');
  document.getElementById('statusSettingsDone').onclick = () => overlay.classList.remove('open');
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  document.getElementById('btnAddStatus').onclick = handleAddStatus;
}

/* =========================================================
   STATUS CHANGE MODAL
   Pops up whenever a task's status changes (Kanban drag or the
   status dropdown in the edit modal). Lets the user log a reason
   and, if the task has children, always asks whether to also apply
   the change to them — the checkbox starts unchecked every time, and
   the same reason is copied into the children's history if propagated.
   ========================================================= */
function showStatusChangeModal(task, newStatus) {
  return new Promise(resolve => {
    const overlay = document.getElementById('statusChangeOverlay');
    document.getElementById('statusChangeTaskLabel').textContent = `${task.id} — ${task.title}`;
    document.getElementById('statusChangeTransition').innerHTML =
      `${statusBadge(task.status)} <span style="color:var(--text-tertiary);">&rarr;</span> ${statusBadge(newStatus)}`;
    document.getElementById('statusChangeDate').value = todayStr();
    document.getElementById('statusChangeNote').value = '';

    const descendants = getDescendants(task.id);
    const canPropagate = descendants.length > 0;
    document.getElementById('statusChangePropagateRow').hidden = !canPropagate;
    document.getElementById('statusChangePropagateCheckbox').checked = false;
    document.getElementById('statusChangePropagateLabel').textContent =
      `Also apply to ${descendants.length} child task${descendants.length === 1 ? '' : 's'}`;

    const cleanup = (result) => { overlay.classList.remove('open'); resolve(result); };
    document.getElementById('statusChangeCancel').onclick = () => cleanup(null);
    document.getElementById('statusChangeClose').onclick = () => cleanup(null);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    document.getElementById('statusChangeConfirm').onclick = () => {
      const date = document.getElementById('statusChangeDate').value || todayStr();
      const note = document.getElementById('statusChangeNote').value.trim();
      const propagate = canPropagate && document.getElementById('statusChangePropagateCheckbox').checked;
      cleanup({ date, note, propagate });
    };
    overlay.classList.add('open');
    setTimeout(() => document.getElementById('statusChangeNote').focus(), 30);
  });
}

async function promptAndApplyStatusChange(task, newStatus) {
  if (task.status === newStatus) return false;
  if (guardLocked('change task status')) return false;
  const result = await showStatusChangeModal(task, newStatus);
  if (!result) return false;

  const oldLabel = getStatusMeta(task.status).label;
  const newLabel = getStatusMeta(newStatus).label;
  const suffix = result.note ? ` — ${result.note}` : '';

  task.history.push({ date: result.date, note: `Status changed: ${oldLabel} → ${newLabel}${suffix}` });
  task.status = newStatus;

  if (result.propagate) {
    const descendants = getDescendants(task.id);
    descendants.forEach(d => {
      d.history.push({
        date: result.date,
        note: `Status changed to ${newLabel} — parent task "${task.title}" (${task.id}) changed from ${oldLabel} to ${newLabel}${suffix}`,
      });
      d.status = newStatus;
    });
  }
  saveState();
  return true;
}

/* =========================================================
   TASK MODAL
   ========================================================= */
function openTaskModal(taskId) {
  ui.editingTaskId = taskId;
  const task = taskId ? getTask(taskId) : null;

  document.getElementById('taskModalIdBadge').textContent = task ? task.id : 'New task';
  document.getElementById('taskFormId').value = task ? task.id : '';
  document.getElementById('taskTitle').value = task ? task.title : '';
  document.getElementById('taskDescription').value = task ? (task.description || '') : '';
  populateStatusSelect(task ? task.status : getStatuses()[0].key);
  setPriorityToggle(task ? (task.priority || 'medium') : 'medium');
  document.getElementById('taskLink').value = task ? (task.link || '') : '';
  document.getElementById('taskDeadline').value = task ? (task.deadline || '') : '';
  document.getElementById('taskDuration').value = task && task.duration != null ? task.duration : '';
  document.getElementById('historyDateInput').value = todayStr();
  document.getElementById('historyNoteInput').value = '';
  document.getElementById('btnDeleteTask').hidden = !task;

  ui.draftHistory = task ? task.history.slice() : [];
  renderHistoryList();

  ui.draftCategories = task ? task.categories.slice() : [];
  renderCategoryChipList();

  ui.draftParents = task ? task.parents.slice() : [];
  renderParentChipList();

  if (task) {
    refreshModalComputedDisplays(task.id);
  } else {
    document.getElementById('taskDeadlineNote').textContent = '';
  }

  applyTaskModalLockState();

  document.getElementById('taskModalOverlay').classList.add('open');
  document.getElementById('taskTitle').focus();
}

function setPriorityToggle(value) {
  document.querySelectorAll('#priorityToggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === value);
  });
}

// Inline, read-only-looking chip lists shown in the task modal itself;
// the actual selection happens in the two sub-picker modals below.
function renderCategoryChipList() {
  const wrap = document.getElementById('categoryChipList');
  if (!ui.draftCategories.length) {
    wrap.innerHTML = '<span class="label-hint">No categories</span>';
    return;
  }
  wrap.innerHTML = ui.draftCategories.map(cid => {
    const c = getCategory(cid);
    return c ? `<span class="dep-tag" title="${escapeAttr(c.name)}">${escapeHtml(c.name)}</span>` : '';
  }).join('');
}

function renderParentChipList() {
  const wrap = document.getElementById('parentChipList');
  if (!ui.draftParents.length) {
    wrap.innerHTML = '<span class="label-hint">No parent tasks</span>';
    return;
  }
  wrap.innerHTML = ui.draftParents.map(pid => {
    const p = getTask(pid);
    const label = p ? `${pid}: ${p.title}` : pid;
    return `<span class="dep-tag" data-open="${pid}" title="${escapeAttr(label)} — click to open">${escapeHtml(label)}</span>`;
  }).join('');
  wrap.querySelectorAll('[data-open]').forEach(el => {
    el.onclick = () => openTaskModal(el.dataset.open);
  });
}

// ---- Category select sub-modal: a full collapsible tree with checkboxes ----
function renderCategorySelectTree() {
  const wrap = document.getElementById('categorySelectTree');
  if (!getCategories().length) {
    wrap.innerHTML = '<div class="parent-picker-empty">No categories yet — create some in the Category tab.</div>';
    return;
  }
  function renderNode(cat) {
    const children = getCategoryChildren(cat.id);
    const collapsed = ui.collapsedCategories.has(cat.id);
    const checked = ui.draftCategories.includes(cat.id) ? 'checked' : '';
    let html = `<div class="cat-node">
      <div class="cat-row">
        <button type="button" class="cat-toggle${children.length ? '' : ' leaf'}" data-toggle="${cat.id}">${collapsed ? '▶' : '▼'}</button>
        <label class="cat-select-card">
          <input type="checkbox" value="${cat.id}" ${checked}>
          <span class="cat-name">${escapeHtml(cat.name)}</span>
        </label>
      </div>`;
    if (children.length && !collapsed) {
      html += `<div class="cat-children">${children.map(renderNode).join('')}</div>`;
    }
    html += `</div>`;
    return html;
  }
  wrap.innerHTML = `<div class="cat-root-list">${getCategoryChildren(null).map(renderNode).join('')}</div>`;

  wrap.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.toggle;
      if (ui.collapsedCategories.has(id)) ui.collapsedCategories.delete(id); else ui.collapsedCategories.add(id);
      renderCategorySelectTree();
    };
  });
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      if (cb.checked) { if (!ui.draftCategories.includes(cb.value)) ui.draftCategories.push(cb.value); }
      else { ui.draftCategories = ui.draftCategories.filter(id => id !== cb.value); }
    };
  });
}

function openCategorySelectModal() {
  if (guardLocked('edit categories')) return;
  renderCategorySelectTree();
  document.getElementById('categorySelectOverlay').classList.add('open');
}

// ---- Parent task select sub-modal: reuses the category-grouped tree,
// now driven by ui.draftParents directly so checkbox changes apply live. ----
function openParentSelectModal() {
  if (guardLocked('edit parent tasks')) return;
  const task = ui.editingTaskId ? getTask(ui.editingTaskId) : null;
  const excluded = new Set(task ? [task.id, ...getDescendants(task.id).map(t => t.id)] : []);
  const candidates = state.tasks.filter(t => !excluded.has(t.id));
  const wrap = document.getElementById('parentSelectTree');
  wrap.innerHTML = '';
  wrap.appendChild(buildParentPickerTree(candidates));
  document.getElementById('parentSelectOverlay').classList.add('open');
}

// Builds a collapsible tree of tasks grouped by category (a task with
// several categories appears under each — this is just a browsing aid,
// not the real data structure, so duplication here is harmless and
// actually helps find things among many tasks). Checkbox state reads
// from and writes straight to ui.draftParents.
function buildParentPickerTree(candidates) {
  const container = document.createElement('div');

  function taskRow(t) {
    const row = document.createElement('label');
    row.className = 'parent-picker-item';
    const checked = ui.draftParents.includes(t.id) ? 'checked' : '';
    row.innerHTML = `<input type="checkbox" value="${t.id}" ${checked}> <span class="id-tag">${t.id}</span> ${escapeHtml(t.title)}`;
    row.querySelector('input').onchange = (e) => {
      if (e.target.checked) { if (!ui.draftParents.includes(t.id)) ui.draftParents.push(t.id); }
      else { ui.draftParents = ui.draftParents.filter(id => id !== t.id); }
    };
    return row;
  }

  function categoryGroup(cat, depth) {
    if (!categoryHasTasks(cat, candidates)) return null;
    const node = document.createElement('div');
    node.className = 'picker-cat-node';

    const header = document.createElement('div');
    header.className = 'picker-cat-header';
    header.style.paddingLeft = (depth * 14) + 'px';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'picker-cat-toggle';
    toggle.textContent = '▼';
    const label = document.createElement('span');
    label.className = 'picker-cat-label';
    label.textContent = cat.name;
    header.appendChild(toggle);
    header.appendChild(label);

    const body = document.createElement('div');
    body.className = 'picker-cat-body';
    toggle.onclick = () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      toggle.textContent = hidden ? '▼' : '▶';
    };

    getCategoryChildren(cat.id).forEach(c => {
      const childNode = categoryGroup(c, depth + 1);
      if (childNode) body.appendChild(childNode);
    });
    candidates.filter(t => (t.categories || []).includes(cat.id)).forEach(t => {
      const row = taskRow(t);
      row.style.paddingLeft = ((depth + 1) * 14 + 12) + 'px';
      body.appendChild(row);
    });

    node.appendChild(header);
    node.appendChild(body);
    return node;
  }

  getCategoryChildren(null).forEach(cat => {
    const node = categoryGroup(cat, 0);
    if (node) container.appendChild(node);
  });

  const uncategorized = candidates.filter(t => !(t.categories || []).length);
  if (uncategorized.length) {
    const node = document.createElement('div');
    node.className = 'picker-cat-node';
    const header = document.createElement('div');
    header.className = 'picker-cat-header';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'picker-cat-toggle';
    toggle.textContent = '▼';
    const label = document.createElement('span');
    label.className = 'picker-cat-label';
    label.textContent = 'Uncategorized';
    header.appendChild(toggle);
    header.appendChild(label);
    const body = document.createElement('div');
    body.className = 'picker-cat-body';
    toggle.onclick = () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      toggle.textContent = hidden ? '▼' : '▶';
    };
    uncategorized.forEach(t => {
      const row = taskRow(t);
      row.style.paddingLeft = '12px';
      body.appendChild(row);
    });
    node.appendChild(header);
    node.appendChild(body);
    container.appendChild(node);
  }

  if (!container.children.length) {
    container.innerHTML = '<div class="parent-picker-empty">No other tasks available.</div>';
  }
  return container;
}

function populateStatusSelect(selectedKey) {
  const sel = document.getElementById('taskStatus');
  sel.innerHTML = getStatuses().map(s => `<option value="${s.key}">${escapeHtml(s.label)}</option>`).join('');
  sel.value = selectedKey;
}

// Disables every field/button that could mutate the task when the
// active project is locked, and shows the explanatory banner. Called
// once when the modal opens — nothing inside it can trigger further
// edits while locked (status changes, add-history, etc. are already
// blocked at the source), so it doesn't need to re-run mid-session.
function applyTaskModalLockState() {
  const locked = isActiveProjectLocked();
  document.getElementById('taskLockBanner').hidden = !locked;
  ['taskTitle', 'taskDescription', 'taskStatus', 'taskLink', 'taskDeadline', 'taskDuration', 'historyDateInput', 'historyNoteInput']
    .forEach(id => { document.getElementById(id).disabled = locked; });
  document.querySelectorAll('#priorityToggle button').forEach(btn => { btn.disabled = locked; });
  document.getElementById('btnEditCategories').disabled = locked;
  document.getElementById('btnEditParents').disabled = locked;
  document.getElementById('btnAddHistory').disabled = locked;
  document.getElementById('btnClearHistory').disabled = locked;
  document.getElementById('btnSaveTask').disabled = locked;
  document.getElementById('btnDeleteTask').disabled = locked;
  document.querySelectorAll('.history-item .h-del').forEach(btn => { btn.disabled = locked; });
}

function refreshModalComputedDisplays(taskId) {
  const task = getTask(taskId);
  const schedule = computeSchedule();
  const sched = schedule[taskId];

  const noteEl = document.getElementById('taskDeadlineNote');
  if (task.deadline) {
    if (sched.conflict) {
      noteEl.textContent = `⚠ Needs to finish by ${formatDate(sched.derivedFinish)} to meet linked tasks' deadlines — the current deadline is later than that.`;
      noteEl.className = 'field-note conflict';
    } else {
      noteEl.textContent = '';
      noteEl.className = 'field-note';
    }
  } else if (sched.finish) {
    noteEl.textContent = `Calculated from linked tasks: ${formatDate(sched.finish)} (leave empty to keep using this automatically)`;
    noteEl.className = 'field-note';
  } else {
    noteEl.textContent = '';
    noteEl.className = 'field-note';
  }
}

function closeTaskModal() {
  document.getElementById('taskModalOverlay').classList.remove('open');
  ui.editingTaskId = null;
}

function renderHistoryList() {
  const wrap = document.getElementById('historyList');
  const sorted = ui.draftHistory.slice().sort((a, b) => a.date < b.date ? 1 : -1);
  if (!sorted.length) {
    wrap.innerHTML = '<div class="history-empty">No history entries yet.</div>';
    return;
  }
  wrap.innerHTML = sorted.map(h => {
    const realIndex = ui.draftHistory.indexOf(h);
    return `<div class="history-item">
      <span class="h-date">${formatDate(h.date)}</span>
      <span class="h-note">${escapeHtml(h.note)}</span>
      <button class="h-del" data-index="${realIndex}" title="Remove">&times;</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.h-del').forEach(btn => {
    btn.onclick = () => {
      ui.draftHistory.splice(parseInt(btn.dataset.index, 10), 1);
      renderHistoryList();
    };
  });
}

async function handleSaveTask() {
  if (guardLocked('save tasks')) return;
  const savedId = upsertTaskFromForm();
  if (savedId) {
    closeTaskModal();
    renderAll();
  }
}

async function handleDeleteTask() {
  if (guardLocked('delete tasks')) return;
  const id = document.getElementById('taskFormId').value;
  const task = getTask(id);
  const children = getChildren(id);
  let reparent = false;
  if (children.length) {
    const choice = await showConfirm(
      `"${task.title}" (${id}) has ${children.length} child task(s). Reattach them to this task's own parents, or detach them (they become roots)?`,
      [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Detach', value: 'detach' },
        { label: 'Reattach to parents', value: 'reparent', primary: true },
      ]
    );
    if (choice === 'cancel') return;
    reparent = choice === 'reparent';
  } else {
    const choice = await showConfirm(`Permanently delete "${task.title}" (${id})?`, [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Delete', value: 'delete', danger: true, primary: true },
    ]);
    if (choice !== 'delete') return;
  }
  deleteTaskById(id, reparent);
  closeTaskModal();
  renderAll();
  toast('Task deleted.');
}

/* =========================================================
   RENDER: LIST
   ========================================================= */
function compareNullsLast(a, b, cmpFn) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmpFn(a, b);
}

function getFilteredTasks() {
  let list = state.tasks.slice();
  if (ui.statusFilter !== 'all') list = list.filter(t => t.status === ui.statusFilter);
  if (ui.search.trim()) {
    const q = ui.search.trim().toLowerCase();
    list = list.filter(t => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }

  const schedule = computeSchedule();
  const statusOrder = getStatuses().map(s => s.key);
  const priorityOrder = { low: 0, medium: 1, high: 2 };
  const dir = ui.sortDirection === 'desc' ? -1 : 1;
  const effectiveDeadline = (t) => t.deadline || (schedule[t.id] && schedule[t.id].finish) || null;

  list.sort((a, b) => {
    switch (ui.sortColumn) {
      case 'title':
        return a.title.localeCompare(b.title) * dir;
      case 'status':
        return (statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)) * dir;
      case 'priority':
        return ((priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)) * dir;
      case 'deadline':
        return compareNullsLast(effectiveDeadline(a), effectiveDeadline(b), (x, y) => x.localeCompare(y) * dir);
      case 'duration':
        return compareNullsLast(a.duration ?? null, b.duration ?? null, (x, y) => (x - y) * dir);
      case 'id':
      default: {
        const na = parseInt(a.id.split('-')[1], 10), nb = parseInt(b.id.split('-')[1], 10);
        return (na - nb) * dir;
      }
    }
  });
  return list;
}

function renderList() {
  const tbody = document.getElementById('taskTableBody');
  const list = getFilteredTasks();
  const schedule = computeSchedule();

  document.getElementById('listEmptyState').hidden = state.tasks.length > 0;
  document.getElementById('taskTableBody').closest('table').style.display = state.tasks.length ? '' : 'none';

  tbody.innerHTML = list.map(t => {
    const categoriesHtml = (t.categories || []).length
      ? t.categories.map(cid => {
          const cat = getCategory(cid);
          return cat ? `<span class="dep-tag" title="${escapeAttr(cat.name)}">${escapeHtml(cat.name)}</span>` : '';
        }).join('')
      : '<span class="label-hint">—</span>';

    const linkHtml = t.link
      ? `<a class="link-icon" href="${escapeAttr(t.link)}" target="_blank" rel="noopener" title="${escapeAttr(t.link)}">🔗</a>`
      : '<span class="label-hint">—</span>';

    const sched = schedule[t.id];
    let deadlineHtml;
    if (t.deadline) {
      deadlineHtml = formatDate(t.deadline);
      if (sched.conflict) {
        deadlineHtml += ` <span class="conflict-icon" title="Needs to finish by ${formatDate(sched.derivedFinish)} based on linked tasks">⚠</span>`;
      }
    } else if (sched.finish) {
      deadlineHtml = `<span class="deadline-computed" title="Calculated from linked tasks">~ ${formatDate(sched.finish)}</span>`;
    } else {
      deadlineHtml = '<span class="label-hint">—</span>';
    }

    return `<tr>
      <td class="id-tag">${t.id}</td>
      <td class="task-title-cell" data-open="${t.id}">${escapeHtml(t.title)}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td>${categoriesHtml}</td>
      <td>${deadlineHtml}</td>
      <td>${t.duration != null ? t.duration + ' d' : '<span class="label-hint">—</span>'}</td>
      <td>${linkHtml}</td>
      <td class="row-actions">
        <button class="icon-btn" data-open="${t.id}" title="Edit">✏️</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-open]').forEach(el => {
    el.onclick = () => openTaskModal(el.dataset.open);
  });

  updateSortHeaders();
}

function updateSortHeaders() {
  document.querySelectorAll('#panel-list thead th.sortable').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === ui.sortColumn) {
      arrow.textContent = ui.sortDirection === 'asc' ? '▲' : '▼';
      th.classList.add('sorted');
    } else {
      arrow.textContent = '';
      th.classList.remove('sorted');
    }
  });
}

function initListSorting() {
  document.querySelectorAll('#panel-list thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (ui.sortColumn === col) {
        ui.sortDirection = ui.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        ui.sortColumn = col;
        ui.sortDirection = 'asc';
      }
      renderList();
    });
  });
}

function renderStatusFilterChips() {
  const wrap = document.getElementById('statusFilterChips');
  const active = ui.statusFilter;
  let html = `<button class="chip chip-all${active === 'all' ? ' active' : ''}" data-status="all">All</button>`;
  getStatuses().forEach(s => {
    const isActive = active === s.key;
    const style = isActive
      ? `background:${s.color};border-color:${s.color};color:${contrastTextFor(s.color)};`
      : `color:${readableStatusColor(s.color)};border-color:${tintColor(s.color, 0.55)};`;
    html += `<button class="chip" data-status="${s.key}" style="${style}">${escapeHtml(s.label)}</button>`;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      ui.statusFilter = chip.dataset.status;
      renderStatusFilterChips();
      renderList();
    };
  });
}

function statusBadge(status) {
  const meta = getStatusMeta(status);
  const textColor = readableStatusColor(meta.color);
  return `<span class="badge-status" style="color:${textColor};background:${tintColor(meta.color, 0.85)};">${escapeHtml(meta.label)}</span>`;
}

/* =========================================================
   RENDER: TREE — node-link diagram
   Every task is drawn exactly once as a box; an arrow is drawn from
   every parent to every child (so a task with several parents simply
   gets several incoming arrows — no duplication). Layout is a simple
   layered ("Sugiyama-style") arrangement: a task's level is one more
   than the deepest of its parents, so children always sit below every
   parent that feeds into them; a couple of barycenter passes reorder
   tasks within each level to reduce crossing lines. This stays
   intentionally simple — no physics/force simulation.
   ========================================================= */
const TREE_BOX_W = 190, TREE_BOX_H = 60, TREE_H_GAP = 34, TREE_V_GAP = 60, TREE_PAD = 32;

function computeTreeLayout() {
  const levelOf = {};
  function level(id, visiting) {
    if (levelOf[id] !== undefined) return levelOf[id];
    if (visiting.has(id)) { levelOf[id] = 0; return 0; } // cycle guard
    visiting.add(id);
    const task = getTask(id);
    let lvl = 0;
    for (const pid of task.parents) {
      if (!getTask(pid)) continue;
      lvl = Math.max(lvl, level(pid, visiting) + 1);
    }
    levelOf[id] = lvl;
    return lvl;
  }
  state.tasks.forEach(t => level(t.id, new Set()));

  const levels = {};
  state.tasks.forEach(t => {
    const lvl = levelOf[t.id];
    (levels[lvl] = levels[lvl] || []).push(t.id);
  });
  Object.values(levels).forEach(ids => ids.sort((a, b) => getTask(a).title.localeCompare(getTask(b).title)));

  let order = {};
  const reindex = () => { order = {}; Object.values(levels).forEach(ids => ids.forEach((id, i) => { order[id] = i; })); };
  reindex();

  function barycenterPass(topDown) {
    const keys = Object.keys(levels).map(Number).sort((a, b) => topDown ? a - b : b - a);
    for (const lvl of keys) {
      const refLevel = topDown ? lvl - 1 : lvl + 1;
      if (!levels[refLevel]) continue;
      const scored = levels[lvl].map(id => {
        const task = getTask(id);
        const refs = topDown ? task.parents : getChildren(id).map(c => c.id);
        const idx = refs.map(r => order[r]).filter(v => v !== undefined);
        const bary = idx.length ? idx.reduce((a, b) => a + b, 0) / idx.length : order[id];
        return { id, bary };
      });
      scored.sort((a, b) => a.bary - b.bary);
      levels[lvl] = scored.map(s => s.id);
      levels[lvl].forEach((id, i) => { order[id] = i; });
    }
  }
  if (Object.keys(levels).length > 1) { barycenterPass(true); barycenterPass(false); barycenterPass(true); }

  const positions = {};
  let maxCount = 1;
  Object.entries(levels).forEach(([lvl, ids]) => {
    maxCount = Math.max(maxCount, ids.length);
    ids.forEach((id, i) => { positions[id] = { level: Number(lvl), order: i, count: ids.length }; });
  });
  const maxLevel = Math.max(0, ...Object.keys(levels).map(Number));
  return { positions, maxLevel, maxCount };
}

function renderTree() {
  const wrap = document.getElementById('treeCanvasWrap');
  const canvas = document.getElementById('treeCanvas');

  if (!state.tasks.length) {
    canvas.style.transform = 'scale(1)';
    canvas.innerHTML = '<div class="tree-empty-note">No tasks to display yet.</div>';
    return;
  }

  const { positions, maxLevel, maxCount } = computeTreeLayout();
  const autoX = (id) => TREE_PAD + positions[id].order * (TREE_BOX_W + TREE_H_GAP);
  const autoY = (id) => TREE_PAD + positions[id].level * (TREE_BOX_H + TREE_V_GAP);

  // Effective position: a manually-dragged task keeps its saved spot
  // (task.treePos); everything else falls back to the computed slot.
  const pos = {};
  state.tasks.forEach(t => {
    pos[t.id] = t.treePos ? { x: t.treePos.x, y: t.treePos.y } : { x: autoX(t.id), y: autoY(t.id) };
  });

  let canvasW = maxCount * (TREE_BOX_W + TREE_H_GAP) - TREE_H_GAP + TREE_PAD * 2;
  let canvasH = (maxLevel + 1) * (TREE_BOX_H + TREE_V_GAP) - TREE_V_GAP + TREE_PAD * 2;
  Object.values(pos).forEach(p => {
    canvasW = Math.max(canvasW, p.x + TREE_BOX_W + TREE_PAD);
    canvasH = Math.max(canvasH, p.y + TREE_BOX_H + TREE_PAD);
  });

  // Rebuilds one edge's path from the CURRENT contents of `pos`, so it
  // can be called live while a box is being dragged, not just at render
  // time. The arrowhead's own orientation follows automatically — its
  // marker uses orient="auto-start-reverse", which SVG derives from the
  // path's tangent, so it always points the right way as the curve moves.
  function edgeD(pid, cid) {
    const x1 = pos[pid].x + TREE_BOX_W / 2, y1 = pos[pid].y + TREE_BOX_H;
    const x2 = pos[cid].x + TREE_BOX_W / 2, y2 = pos[cid].y;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  }

  let edges = '';
  state.tasks.forEach(t => {
    t.parents.forEach(pid => {
      if (!pos[pid]) return;
      const parentMeta = getStatusMeta(getTask(pid).status);
      edges += `<path class="tree-edge" data-parent="${pid}" data-child="${t.id}" style="stroke:${readableStatusColor(parentMeta.color)};" d="${edgeD(pid, t.id)}" marker-end="url(#tree-arrow-${parentMeta.key})"></path>`;
    });
  });

  let boxes = '';
  state.tasks.forEach(t => {
    const meta = getStatusMeta(t.status);
    const badge = t.parents.length > 1 ? `<span class="tree-multi-badge" title="Depends on ${t.parents.length} parent tasks">⛓ ${t.parents.length}</span>` : '';
    const pin = t.treePos ? `<span class="tree-pin" title="Manually positioned — double-click to reset">📌</span>` : '';
    boxes += `<div class="tree-box" style="left:${pos[t.id].x}px;top:${pos[t.id].y}px;width:${TREE_BOX_W}px;height:${TREE_BOX_H}px;border-left-color:${readableStatusColor(meta.color)};" data-id="${t.id}" title="Drag to reposition · double-click to reset">
      <div class="tree-box-top">
        <span class="id-tag">${t.id}</span>
        <span class="tree-box-title">${escapeHtml(t.title)}</span>
        ${pin}
      </div>
      <div class="tree-box-bottom">
        ${statusBadge(t.status)}
        ${t.deadline ? `<span class="label-hint">${formatDate(t.deadline)}</span>` : ''}
        ${badge}
      </div>
    </div>`;
  });

  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';
  canvas.style.transform = `scale(${TREE_ZOOM_LEVELS[ui.treeZoomIndex]})`;
  canvas.innerHTML = `
    <svg class="tree-svg-layer" width="${canvasW}" height="${canvasH}">
      <defs>
        ${getStatuses().map(s => `
        <marker id="tree-arrow-${s.key}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" style="fill:${readableStatusColor(s.color)};"></path>
        </marker>`).join('')}
      </defs>
      ${edges}
    </svg>
    ${boxes}`;

  canvas.querySelectorAll('.tree-box').forEach(el => {
    const id = el.dataset.id;
    const connectedEdges = () => canvas.querySelectorAll(`.tree-edge[data-parent="${id}"], .tree-edge[data-child="${id}"]`);

    el.addEventListener('mouseenter', () => connectedEdges().forEach(edge => edge.classList.add('tree-edge-highlight')));
    el.addEventListener('mouseleave', () => connectedEdges().forEach(edge => edge.classList.remove('tree-edge-highlight')));

    el.addEventListener('click', () => {
      if (treeJustDragged) { treeJustDragged = false; return; }
      openTaskModal(id);
    });

    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const task = getTask(id);
      if (task.treePos) {
        delete task.treePos;
        saveState();
        renderTree();
      }
    });

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (isActiveProjectLocked()) return;
      e.preventDefault();
      treeDrag = {
        id,
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startX: pos[id].x,
        startY: pos[id].y,
        moved: false,
        onMove: (newX, newY) => {
          pos[id].x = newX; pos[id].y = newY;
          el.style.left = newX + 'px';
          el.style.top = newY + 'px';
          connectedEdges().forEach(edge => {
            edge.setAttribute('d', edgeD(edge.dataset.parent, edge.dataset.child));
          });
        },
        onEnd: () => {
          if (!treeDrag.moved) return;
          treeJustDragged = true;
          getTask(id).treePos = { x: pos[id].x, y: pos[id].y };
          saveState();
          renderTree();
        },
      };
    });
  });
}

// Drag state lives at module scope (not inside renderTree) so a single
// pair of document-level mousemove/mouseup listeners — registered once
// in initTreeControls() — can drive it regardless of which render
// created the box currently being dragged.
let treeDrag = null;
let treeJustDragged = false;

function initTreeDragHandlers() {
  document.addEventListener('mousemove', (e) => {
    if (!treeDrag) return;
    const dxScreen = e.clientX - treeDrag.startScreenX;
    const dyScreen = e.clientY - treeDrag.startScreenY;
    if (Math.abs(dxScreen) > 3 || Math.abs(dyScreen) > 3) treeDrag.moved = true;
    const zoom = TREE_ZOOM_LEVELS[ui.treeZoomIndex];
    const newX = Math.max(TREE_PAD, treeDrag.startX + dxScreen / zoom);
    const newY = Math.max(TREE_PAD, treeDrag.startY + dyScreen / zoom);
    treeDrag.onMove(newX, newY);
  });
  document.addEventListener('mouseup', () => {
    if (!treeDrag) return;
    treeDrag.onEnd();
    treeDrag = null;
  });
}

/* =========================================================
   RENDER: KANBAN (planning tab)
   ========================================================= */
function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  const statuses = getStatuses();

  board.innerHTML = statuses.map(s => {
    const tasks = state.tasks.filter(t => t.status === s.key)
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    const collapsed = ui.collapsedKanbanColumns.has(s.key);

    if (collapsed) {
      return `<div class="kanban-col-collapsed" data-status="${s.key}" title="${escapeAttr(s.label)} (${tasks.length}) — click to expand">
        <button class="kanban-col-expand-btn" data-status="${s.key}" title="Expand column">▸</button>
        <span class="kanban-col-collapsed-label" style="color:${readableStatusColor(s.color)};">${escapeHtml(s.label)}</span>
        <span class="kanban-col-count">${tasks.length}</span>
      </div>`;
    }
    return `<div class="kanban-col" data-status="${s.key}">
      <div class="kanban-col-header" style="color:${readableStatusColor(s.color)};">
        <button class="kanban-col-collapse-btn" data-status="${s.key}" title="Collapse column">◂</button>
        <span>${escapeHtml(s.label)}</span>
        <span class="kanban-col-count">${tasks.length}</span>
      </div>
      <div class="kanban-col-body" data-status="${s.key}">
        ${tasks.map(t => kanbanCardHtml(t)).join('') || ''}
      </div>
    </div>`;
  }).join('');

  board.querySelectorAll('.kanban-col-collapse-btn, .kanban-col-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.status;
      if (ui.collapsedKanbanColumns.has(key)) ui.collapsedKanbanColumns.delete(key);
      else ui.collapsedKanbanColumns.add(key);
      renderKanban();
    });
  });
  // Clicking anywhere else on a collapsed column also expands it.
  board.querySelectorAll('.kanban-col-collapsed').forEach(col => {
    col.addEventListener('click', () => {
      ui.collapsedKanbanColumns.delete(col.dataset.status);
      renderKanban();
    });
  });

  board.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      ui.dragTaskId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => openTaskModal(card.dataset.id));
  });

  board.querySelectorAll('.kanban-col-body').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain') || ui.dragTaskId;
      const newStatus = col.dataset.status;
      await handleStatusDrop(taskId, newStatus);
    });
  });

  // A collapsed column stays a valid drop target — no need to expand
  // it first just to move a card into that status.
  board.querySelectorAll('.kanban-col-collapsed').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation();
      col.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain') || ui.dragTaskId;
      await handleStatusDrop(taskId, col.dataset.status);
    });
  });
}

function kanbanCardHtml(t) {
  const meta = getStatusMeta(t.status);
  const childCount = getDescendants(t.id).length;
  return `<div class="kanban-card" style="border-left-color:${readableStatusColor(meta.color)};" draggable="${!isActiveProjectLocked()}" data-id="${t.id}">
    <div class="kanban-card-title">${escapeHtml(t.title)}</div>
    <div class="kanban-card-meta">
      <span class="kanban-card-id">${t.id}</span>
      ${t.deadline ? `<span>· ${formatDate(t.deadline)}</span>` : ''}
      ${childCount ? `<span class="kanban-card-children">· ${childCount} child${childCount > 1 ? 'ren' : ''}</span>` : ''}
    </div>
  </div>`;
}

async function handleStatusDrop(taskId, newStatus) {
  const task = getTask(taskId);
  if (!task || task.status === newStatus) { renderKanban(); return; }
  const applied = await promptAndApplyStatusChange(task, newStatus);
  renderAll();
  if (applied) toast(`${task.id} → ${getStatusMeta(newStatus).label}`);
}

/* =========================================================
   RENDER: TIMELINE (schedule-aware Gantt, weekly grid, zoomable)
   ========================================================= */
function renderTimeline() {
  const wrap = document.getElementById('timelineWrap');
  const schedule = computeSchedule();
  const items = state.tasks
    .map(t => ({ task: t, sched: schedule[t.id] }))
    .filter(x => x.sched.finish);

  if (!items.length) {
    wrap.innerHTML = '<div class="timeline-empty">Add a deadline (ideally with a duration) to at least one task in a chain. Linked tasks without their own deadline will then get a calculated date automatically.</div>';
    return;
  }

  const pxPerDay = ZOOM_LEVELS[ui.zoomIndex];

  let minDate = items.reduce((m, x) => {
    const anchor = x.sched.start || x.sched.finish;
    return anchor < m ? anchor : m;
  }, items[0].sched.start || items[0].sched.finish);
  let maxDate = items.reduce((m, x) => x.sched.finish > m ? x.sched.finish : m, items[0].sched.finish);
  minDate = addDays(minDate, -3);
  maxDate = addDays(maxDate, 5);

  // Align the visible range to a Monday so week separators land cleanly
  const dow = dayOfWeek(minDate);
  const backToMonday = dow === 0 ? 6 : dow - 1;
  minDate = addDays(minDate, -backToMonday);

  const totalDays = Math.max(7, daysBetween(minDate, maxDate));
  const totalWidth = totalDays * pxPerDay;

  items.sort((a, b) => (a.sched.start || a.sched.finish).localeCompare(b.sched.start || b.sched.finish));

  const gridOverlay = buildGridOverlay(minDate, totalDays, pxPerDay, items.length);
  const ruler = buildRuler(minDate, totalDays, pxPerDay);

  const rows = items.map(({ task, sched }) => {
    const meta = getStatusMeta(task.status);
    const isMilestone = !(task.duration != null && task.duration > 0);
    const left = daysBetween(minDate, sched.start || sched.finish) * pxPerDay;
    let innerHtml;

    if (isMilestone) {
      innerHtml = `<div class="timeline-milestone" style="left:${left}px;background-color:${meta.color};" data-id="${task.id}" title="${escapeAttr(task.title)}: ${formatDate(sched.finish)}"></div>`;
    } else {
      const derived = sched.finishSource === 'derived';
      const runs = computeBusinessRuns(sched.start, sched.finish);
      const tooltip = `${task.title}: ${formatDate(sched.start)} → ${formatDate(sched.finish)}${derived ? ' (calculated)' : ''}${sched.conflict ? ' — deadline conflict' : ''}`;
      const colorStyle = derived
        ? `color:${readableStatusColor(meta.color)};`
        : `background-color:${meta.color};color:${contrastTextFor(meta.color)};`;
      const cls = ['timeline-bar', derived ? 'derived' : '', sched.conflict ? 'conflict' : ''];

      const segHtml = runs.map(([runStart, runEnd], i) => {
        const segLeft = daysBetween(minDate, runStart) * pxPerDay + 1;
        const segWidth = Math.max(pxPerDay * 0.7, (daysBetween(runStart, runEnd) + 1) * pxPerDay - 3);
        const compact = segWidth < 74;
        const hideText = segWidth < 26;
        // Only the first segment carries the label, and only shows the
        // full date range when the whole bar is a single run.
        const label = (i === 0 && !hideText)
          ? (compact || runs.length > 1 ? task.id : `${task.id} · ${formatDate(sched.start)} → ${formatDate(sched.finish)}`)
          : '';
        const segCls = cls.concat(compact ? 'compact' : '').filter(Boolean).join(' ');
        return `<div class="${segCls}" style="left:${segLeft}px;width:${segWidth}px;${colorStyle}" data-id="${task.id}" title="${escapeAttr(tooltip)}">${label}</div>`;
      }).join('');

      const bridgeHtml = runs.slice(0, -1).map(([, runEnd], i) => {
        const nextStart = runs[i + 1][0];
        const bLeft = daysBetween(minDate, runEnd) * pxPerDay + pxPerDay - 1;
        const bWidth = daysBetween(runEnd, nextStart) * pxPerDay - pxPerDay + 2;
        return `<div class="timeline-bar-bridge" style="left:${bLeft}px;width:${Math.max(0, bWidth)}px;background-color:${readableStatusColor(meta.color)};"></div>`;
      }).join('');

      innerHtml = bridgeHtml + segHtml;
    }

    return `<div class="timeline-row">
      <div class="timeline-label">
        <span class="id-tag">${task.id}</span>
        <span>${escapeHtml(task.title)}</span>
      </div>
      <div class="timeline-track" style="width:${totalWidth}px;">${innerHtml}</div>
    </div>`;
  }).join('');

  wrap.innerHTML = `<div class="timeline-inner">
    ${gridOverlay}
    <div class="timeline-ruler">
      <div class="timeline-label">Task</div>
      <div class="timeline-ruler-track" style="width:${totalWidth}px;">${ruler}</div>
    </div>
    ${rows}
    <div class="timeline-legend">
      <span><span class="legend-swatch"></span> Explicit deadline</span>
      <span><span class="legend-swatch dashed"></span> Calculated deadline</span>
      <span>◆ Milestone (no duration set)</span>
      <span style="color:var(--danger);">Red outline = deadline conflict</span>
    </div>
  </div>`;

  wrap.querySelectorAll('[data-id]').forEach(el => {
    el.onclick = () => openTaskModal(el.dataset.id);
  });
}

function buildGridOverlay(minDate, totalDays, pxPerDay, rowCount) {
  const height = rowCount * 40;
  let inner = '';
  for (let d = 0; d <= totalDays; d++) {
    const dateStr = addDays(minDate, d);
    const dow = dayOfWeek(dateStr);
    if (dow === 0 || dow === 6) {
      inner += `<div class="timeline-weekend-col" style="left:${d * pxPerDay}px;width:${pxPerDay}px;"></div>`;
    }
    if (dow === 1) {
      inner += `<div class="timeline-week-line" style="left:${d * pxPerDay}px;"></div>`;
    }
  }
  const todayOffset = daysBetween(minDate, todayStr());
  if (todayOffset >= 0 && todayOffset <= totalDays) {
    inner += `<div class="timeline-today-marker" style="left:${todayOffset * pxPerDay}px;" title="Today"></div>`;
  }
  return `<div class="timeline-grid-overlay" style="left:230px;top:30px;width:${totalDays * pxPerDay}px;height:${height}px;">${inner}</div>`;
}

function buildRuler(minDate, totalDays, pxPerDay) {
  let ticks = '';
  for (let d = 0; d <= totalDays; d += 7) {
    const dateStr = addDays(minDate, d);
    ticks += `<div class="timeline-tick" style="left:${d * pxPerDay}px;">${formatDate(dateStr)}</div>`;
  }
  return ticks;
}

/* =========================================================
   MASTER RENDER
   ========================================================= */
function renderAll() {
  renderStatusFilterChips();
  renderList();
  renderTree();
  renderKanban();
  renderTimeline();
  renderCategoryTab();
  renderSidebar();
  document.getElementById('projectNameInput').value = state.meta.projectName;
  document.getElementById('projectNameInput').disabled = isActiveProjectLocked();
  document.getElementById('activeLockBadge').hidden = !isActiveProjectLocked();
}

/* =========================================================
   IMPORT / EXPORT
   ========================================================= */
function exportWorkspaceJSON() {
  const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `taskchain_workspace_${workspace.projects.length}projects.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportProjectJSON(project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (project.meta.projectName || 'project').trim().replace(/[^a-z0-9\-_]+/gi, '_').toLowerCase() || 'project';
  a.download = `taskchain_${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (Array.isArray(parsed.projects) && parsed.projects.length) {
        // Whole-workspace file: replacing everything is destructive, confirm first.
        const choice = await showConfirm(
          `This file contains ${parsed.projects.length} project(s). Loading it will replace your entire local workspace (all current projects). Continue?`,
          [
            { label: 'Cancel', value: 'no' },
            { label: 'Replace workspace', value: 'yes', danger: true, primary: true },
          ]
        );
        if (choice !== 'yes') return;
        workspace = normalizeWorkspace(parsed);
        state = getActiveProject();
        saveState();
        renderAll();
        toast('Workspace loaded.');
      } else if (Array.isArray(parsed.tasks)) {
        // Single-project file: add it alongside existing projects, no data loss.
        normalizeProject(parsed);
        parsed.id = generateProjectId();
        workspace.projects.push(parsed);
        switchToProject(parsed.id);
        toast(`Imported as new project "${parsed.meta.projectName}".`);
      } else {
        throw new Error('invalid format');
      }
    } catch (e) {
      toast('Invalid JSON file.');
    }
  };
  reader.readAsText(file);
}

/* =========================================================
   FIREBASE SYNC
   Lazily loads the Firebase compat SDK only when the user opens the
   Firebase modal, so projects that never use it pay no extra cost.
   The whole project JSON is stored as a single field on one Firestore
   document, identified by a user-chosen "document name". The app signs
   in anonymously so Firestore rules can require request.auth != null
   without needing a real login screen — see README for the setup and
   the security trade-offs of this approach.
   ========================================================= */
const FIREBASE_CONFIG_KEY = 'taskchain_firebase_config_v1';
const FIREBASE_SDK_VERSION = '10.12.5';
let firebaseApp = null;
let firebaseAuthReadyPromise = null;

function loadFirebaseSdk() {
  if (window.firebase && window.firebase.firestore) return Promise.resolve();
  const urls = [
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore-compat.js`,
  ];
  return urls.reduce((chain, src) => chain.then(() => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the Firebase SDK. Check your internet connection.'));
    document.head.appendChild(s);
  })), Promise.resolve());
}

function getStoredFirebaseConfig() {
  try { return JSON.parse(localStorage.getItem(FIREBASE_CONFIG_KEY) || 'null'); } catch (e) { return null; }
}

function readFirebaseFormConfig() {
  return {
    apiKey: document.getElementById('fbApiKey').value.trim(),
    authDomain: document.getElementById('fbAuthDomain').value.trim(),
    projectId: document.getElementById('fbProjectId').value.trim(),
    storageBucket: document.getElementById('fbStorageBucket').value.trim(),
    messagingSenderId: document.getElementById('fbMessagingSenderId').value.trim(),
    appId: document.getElementById('fbAppId').value.trim(),
    docId: document.getElementById('fbDocId').value.trim() || 'default',
  };
}

function fillFirebaseForm(cfg) {
  document.getElementById('fbApiKey').value = cfg?.apiKey || '';
  document.getElementById('fbAuthDomain').value = cfg?.authDomain || '';
  document.getElementById('fbProjectId').value = cfg?.projectId || '';
  document.getElementById('fbStorageBucket').value = cfg?.storageBucket || '';
  document.getElementById('fbMessagingSenderId').value = cfg?.messagingSenderId || '';
  document.getElementById('fbAppId').value = cfg?.appId || '';
  document.getElementById('fbDocId').value = cfg?.docId || '';
}

function setFirebaseStatus(msg, isError) {
  const el = document.getElementById('fbStatus');
  el.textContent = msg;
  el.className = 'field-note' + (isError ? ' conflict' : '');
}

async function ensureFirebaseReady(cfg) {
  await loadFirebaseSdk();
  if (!firebaseApp) {
    firebaseApp = firebase.apps.length ? firebase.app() : firebase.initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId,
    });
  }
  if (!firebaseAuthReadyPromise) {
    firebaseAuthReadyPromise = firebase.auth().signInAnonymously();
  }
  await firebaseAuthReadyPromise;
}

function persistFirebaseConfigIfChecked(cfg) {
  if (document.getElementById('fbRememberConfig').checked) {
    localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(cfg));
  } else {
    localStorage.removeItem(FIREBASE_CONFIG_KEY);
  }
}

async function saveWorkspaceToFirebase(cfg, opts) {
  const showModalStatus = !!(opts && opts.showModalStatus);
  if (!cfg || !cfg.apiKey || !cfg.projectId || !cfg.appId) {
    const msg = 'Please fill in at least the API key, Project ID and App ID.';
    if (showModalStatus) setFirebaseStatus(msg, true); else toast(msg);
    return false;
  }
  if (showModalStatus) setFirebaseStatus('Connecting…', false);
  try {
    await ensureFirebaseReady(cfg);
    const db = firebase.firestore();
    await db.collection('taskchain_projects').doc(cfg.docId).set({
      json: JSON.stringify(workspace),
      projectCount: workspace.projects.length,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    const msg = `Saved ${workspace.projects.length} project(s) to Firebase as "${cfg.docId}".`;
    if (showModalStatus) setFirebaseStatus(msg, false);
    toast('Workspace saved to Firebase.');
    return true;
  } catch (e) {
    const msg = 'Save failed: ' + (e.message || e);
    if (showModalStatus) setFirebaseStatus(msg, true); else toast(msg);
    return false;
  }
}

async function handleFirebaseSave() {
  const cfg = readFirebaseFormConfig();
  persistFirebaseConfigIfChecked(cfg);
  await saveWorkspaceToFirebase(cfg, { showModalStatus: true });
}

async function handleQuickSave() {
  const cfg = getStoredFirebaseConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId || !cfg.appId) {
    toast('Set up your Firebase connection first.');
    openFirebaseModal();
    return;
  }
  toast('Saving to Firebase…');
  await saveWorkspaceToFirebase(cfg, { showModalStatus: false });
}

async function handleFirebaseLoad() {
  const cfg = readFirebaseFormConfig();
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    setFirebaseStatus('Please fill in at least the API key, Project ID and App ID.', true);
    return;
  }
  persistFirebaseConfigIfChecked(cfg);
  setFirebaseStatus('Connecting…', false);
  try {
    await ensureFirebaseReady(cfg);
    const db = firebase.firestore();
    const snap = await db.collection('taskchain_projects').doc(cfg.docId).get();
    if (!snap.exists) {
      setFirebaseStatus(`No document named "${cfg.docId}" was found in this Firebase project.`, true);
      return;
    }
    const data = snap.data();
    const parsed = JSON.parse(data.json);
    let newWorkspace;
    if (Array.isArray(parsed.projects) && parsed.projects.length) {
      newWorkspace = normalizeWorkspace(parsed);
    } else if (Array.isArray(parsed.tasks)) {
      // Backward compatible with docs saved by an earlier single-project version.
      normalizeProject(parsed);
      newWorkspace = { projects: [parsed], activeProjectId: parsed.id };
    } else {
      throw new Error('the stored document is not a valid TaskChain workspace or project');
    }
    workspace = newWorkspace;
    state = getActiveProject();
    saveState();
    renderAll();
    setFirebaseStatus(`Loaded ${workspace.projects.length} project(s) from "${cfg.docId}".`, false);
    toast('Workspace loaded from Firebase.');
    closeFirebaseModal();
  } catch (e) {
    setFirebaseStatus('Load failed: ' + (e.message || e), true);
  }
}

function openFirebaseModal() {
  fillFirebaseForm(getStoredFirebaseConfig());
  setFirebaseStatus('', false);
  document.getElementById('firebaseModalOverlay').classList.add('open');
}
function closeFirebaseModal() {
  document.getElementById('firebaseModalOverlay').classList.remove('open');
}

/* =========================================================
   EXAMPLE DATA
   Demonstrates: explicit deadlines, a calculated (derived) deadline on
   a parent task with none of its own, a task already Released while a
   parent is not (release warning), multiple parents, and a task (T-6)
   that has no deadline and no children of its own — it only gets
   scheduled because the iterative engine derives T-1's finish date
   first (from T-2), which then unlocks T-6 going forward.
   ========================================================= */
function loadExampleData() {
  const t = todayStr();
  const catEngineering = generateCategoryId();
  const catDesign = generateCategoryId();
  const catTesting = generateCategoryId();
  const catPM = generateCategoryId();
  const project = {
    id: generateProjectId(),
    meta: { projectName: 'Example — Mechanical component', lastModified: nowISO() },
    nextIdNum: 8,
    locked: false,
    categories: [
      { id: catEngineering, name: 'Engineering', parentId: null },
      { id: catDesign, name: 'Design', parentId: catEngineering },
      { id: catTesting, name: 'Testing', parentId: catEngineering },
      { id: catPM, name: 'Project Management', parentId: null },
    ],
    tasks: [
      {
        id: 'T-1', title: 'Component design', link: 'https://example.com/design-doc',
        description: 'Define the overall geometry and material for the bracket, including tolerances for the mounting interface.',
        status: 'working', priority: 'high', deadline: null, duration: 5, parents: [], categories: [catDesign],
        history: [{ date: addDays(t, -20), note: 'Task created' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-2', title: 'Component calculations', link: '',
        description: 'Structural load calculations for the design above, to validate margins before manufacturing.',
        status: 'released', priority: 'high', deadline: addDays(t, -3), duration: 4, parents: ['T-1'], categories: [catDesign],
        history: [
          { date: addDays(t, -18), note: 'Task created' },
          { date: addDays(t, -3), note: 'Status changed: Working → Released' },
        ],
        createdAt: nowISO(),
      },
      {
        id: 'T-3', title: 'Test validation', link: '',
        status: 'release_process', priority: 'medium', deadline: addDays(t, 4), duration: 3, parents: ['T-2'], categories: [catTesting],
        history: [{ date: addDays(t, -5), note: 'Task created' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-4', title: 'Housing design', link: '',
        status: 'working', priority: 'medium', deadline: addDays(t, 10), duration: 6, parents: [], categories: [catDesign],
        history: [{ date: addDays(t, -2), note: 'Task created' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-5', title: 'Final bill of materials', link: '',
        status: 'working', priority: 'low', deadline: addDays(t, 16), duration: 2, parents: ['T-3', 'T-4'], categories: [catPM],
        history: [{ date: addDays(t, -1), note: 'Task created' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-6', title: 'Assembly drawings', link: '',
        status: 'working', priority: 'medium', deadline: null, duration: 4, parents: ['T-1'], categories: [catDesign],
        history: [{ date: addDays(t, -1), note: 'Task created — has no deadline of its own; scheduled forward once T-1 gets a calculated finish date from T-2.' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-7', title: 'Kickoff meeting', link: '',
        status: 'done', priority: 'low', deadline: addDays(t, -22), duration: 1, parents: [], categories: [catPM],
        history: [
          { date: addDays(t, -22), note: 'Task created' },
          { date: addDays(t, -22), note: 'Status changed: Working → Done' },
        ],
        createdAt: nowISO(),
      },
    ],
  };
  workspace.projects.push(project);
  switchToProject(project.id);
  toast('Example project added.');
}

/* =========================================================
   UTIL
   ========================================================= */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* =========================================================
   EVENT WIRING / INIT
   ========================================================= */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      ui.activeTab = btn.dataset.tab;
    });
  });
}

function initToolbar() {
  document.getElementById('btnNewTask').onclick = () => { if (guardLocked('add tasks')) return; openTaskModal(null); };
  document.getElementById('btnEmptyNewTask').onclick = () => { if (guardLocked('add tasks')) return; openTaskModal(null); };

  document.getElementById('btnExport').onclick = exportWorkspaceJSON;
  document.getElementById('btnImport').onclick = () => document.getElementById('fileImport').click();
  document.getElementById('fileImport').onchange = e => {
    if (e.target.files[0]) importJSONFile(e.target.files[0]);
    e.target.value = '';
  };
  document.getElementById('btnLoadExample').onclick = () => loadExampleData();
  document.getElementById('btnReset').onclick = async () => {
    if (guardLocked('clear tasks')) return;
    const choice = await showConfirm(
      `Remove all tasks from "${state.meta.projectName}"? The project itself is kept — this only clears its tasks. Any unexported changes will be lost.`,
      [
        { label: 'Cancel', value: 'no' },
        { label: 'Clear tasks', value: 'yes', danger: true, primary: true },
      ]
    );
    if (choice !== 'yes') return;
    state.tasks = [];
    state.nextIdNum = 1;
    saveState();
    renderAll();
  };

  document.getElementById('projectNameInput').oninput = e => {
    if (isActiveProjectLocked()) { e.target.value = state.meta.projectName; return; }
    state.meta.projectName = e.target.value;
    saveState();
    renderSidebar();
  };

  document.getElementById('btnQuickSave').onclick = handleQuickSave;
  document.getElementById('btnFirebase').onclick = openFirebaseModal;
  document.getElementById('firebaseModalClose').onclick = closeFirebaseModal;
  document.getElementById('firebaseModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'firebaseModalOverlay') closeFirebaseModal();
  });
  document.getElementById('fbSaveBtn').onclick = handleFirebaseSave;
  document.getElementById('fbLoadBtn').onclick = handleFirebaseLoad;
  document.getElementById('fbForget').onclick = () => {
    localStorage.removeItem(FIREBASE_CONFIG_KEY);
    fillFirebaseForm(null);
    setFirebaseStatus('Saved connection settings removed from this browser.', false);
  };

  document.getElementById('btnZoomIn').onclick = () => {
    ui.zoomIndex = Math.min(ZOOM_LEVELS.length - 1, ui.zoomIndex + 1);
    renderTimeline();
  };
  document.getElementById('btnZoomOut').onclick = () => {
    ui.zoomIndex = Math.max(0, ui.zoomIndex - 1);
    renderTimeline();
  };
}

function initListFilters() {
  document.getElementById('searchInput').oninput = e => { ui.search = e.target.value; renderList(); };
}

function initTreeControls() {
  document.getElementById('btnTreeZoomIn').onclick = () => {
    ui.treeZoomIndex = Math.min(TREE_ZOOM_LEVELS.length - 1, ui.treeZoomIndex + 1);
    renderTree();
  };
  document.getElementById('btnTreeZoomOut').onclick = () => {
    ui.treeZoomIndex = Math.max(0, ui.treeZoomIndex - 1);
    renderTree();
  };
  document.getElementById('btnTreeFit').onclick = () => {
    ui.treeZoomIndex = 3;
    renderTree();
    document.getElementById('treeCanvasWrap').scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  };
  document.getElementById('btnTreeResetLayout').onclick = async () => {
    const movedCount = state.tasks.filter(t => t.treePos).length;
    if (!movedCount) { toast('No boxes have been manually moved.'); return; }
    const choice = await showConfirm(`Reset ${movedCount} manually-positioned box(es) back to the automatic layout?`, [
      { label: 'Cancel', value: 'no' },
      { label: 'Reset layout', value: 'yes', primary: true },
    ]);
    if (choice !== 'yes') return;
    state.tasks.forEach(t => { delete t.treePos; });
    saveState();
    renderTree();
  };
  initTreeDragHandlers();
}

function initModal() {
  document.getElementById('taskModalClose').onclick = closeTaskModal;
  document.getElementById('btnCancelTask').onclick = closeTaskModal;
  document.getElementById('btnSaveTask').onclick = handleSaveTask;
  document.getElementById('btnDeleteTask').onclick = handleDeleteTask;
  document.getElementById('taskModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'taskModalOverlay') closeTaskModal();
  });

  document.querySelectorAll('#priorityToggle button').forEach(btn => {
    btn.onclick = () => {
      if (isActiveProjectLocked()) return;
      setPriorityToggle(btn.dataset.priority);
    };
  });

  document.getElementById('btnEditCategories').onclick = openCategorySelectModal;
  document.getElementById('categorySelectClose').onclick = () => document.getElementById('categorySelectOverlay').classList.remove('open');
  document.getElementById('categorySelectDone').onclick = () => {
    document.getElementById('categorySelectOverlay').classList.remove('open');
    renderCategoryChipList();
  };
  document.getElementById('categorySelectOverlay').addEventListener('click', e => {
    if (e.target.id === 'categorySelectOverlay') {
      document.getElementById('categorySelectOverlay').classList.remove('open');
      renderCategoryChipList();
    }
  });

  document.getElementById('btnEditParents').onclick = openParentSelectModal;
  document.getElementById('parentSelectClose').onclick = () => document.getElementById('parentSelectOverlay').classList.remove('open');
  document.getElementById('parentSelectDone').onclick = () => {
    document.getElementById('parentSelectOverlay').classList.remove('open');
    renderParentChipList();
  };
  document.getElementById('parentSelectOverlay').addEventListener('click', e => {
    if (e.target.id === 'parentSelectOverlay') {
      document.getElementById('parentSelectOverlay').classList.remove('open');
      renderParentChipList();
    }
  });

  // Status changes go through the dedicated status-change modal so a
  // reason can be logged and cascading to children can be decided.
  document.getElementById('taskStatus').addEventListener('change', async (e) => {
    const id = document.getElementById('taskFormId').value;
    if (!id) return; // new task: no history / cascade concept yet
    const task = getTask(id);
    const newStatus = e.target.value;
    if (newStatus === task.status) return;
    const previousValue = task.status;
    const applied = await promptAndApplyStatusChange(task, newStatus);
    if (!applied) {
      e.target.value = previousValue;
    } else {
      ui.draftHistory = task.history.slice();
      renderHistoryList();
      refreshModalComputedDisplays(task.id);
      renderAll();
    }
  });

  document.getElementById('btnAddHistory').onclick = () => {
    const date = document.getElementById('historyDateInput').value || todayStr();
    const note = document.getElementById('historyNoteInput').value.trim();
    if (!note) return;
    ui.draftHistory.push({ date, note });
    document.getElementById('historyNoteInput').value = '';
    renderHistoryList();
  };

  document.getElementById('btnClearHistory').onclick = async () => {
    if (guardLocked('clear history')) return;
    if (ui.draftHistory.length <= 1) { toast('Nothing to clear.'); return; }
    const choice = await showConfirm('Clear this task\'s history, keeping only its creation entry?', [
      { label: 'Cancel', value: 'no' },
      { label: 'Clear history', value: 'yes', danger: true, primary: true },
    ]);
    if (choice !== 'yes') return;
    const sorted = ui.draftHistory.slice().sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
    const creationEntry = sorted.find(h => h.note === 'Task created') || sorted[0];
    ui.draftHistory = [creationEntry];
    renderHistoryList();
    toast('History cleared — save the task to keep this change.');
  };

  document.getElementById('historyNoteInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnAddHistory').click(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeTaskModal();
      document.getElementById('confirmOverlay').classList.remove('open');
      document.getElementById('statusChangeOverlay').classList.remove('open');
      document.getElementById('promptOverlay').classList.remove('open');
      document.getElementById('statusSettingsOverlay').classList.remove('open');
      document.getElementById('categorySelectOverlay').classList.remove('open');
      document.getElementById('parentSelectOverlay').classList.remove('open');
      closeFirebaseModal();
    }
  });
}

function init() {
  document.getElementById('versionBadge').textContent = APP_VERSION;
  initTabs();
  initToolbar();
  initListFilters();
  initListSorting();
  initTreeControls();
  initModal();
  initSidebar();
  initStatusSettings();
  initCategoryTab();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
