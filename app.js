/* =========================================================
   TaskChain — app.js
   Vanilla JS, no dependencies. Single source of truth: `state`.
   ========================================================= */

/* ---------- Status metadata ---------- */
const STATUS_ORDER = ['working', 'release_process', 'released', 'rework'];
const STATUS_META = {
  working:         { label: 'Working' },
  release_process: { label: 'In Release Process' },
  released:        { label: 'Released' },
  rework:          { label: 'Rework' },
};

const ZOOM_LEVELS = [6, 9, 13, 18, 26, 36, 48, 64]; // px per day, timeline
const TREE_ZOOM_LEVELS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.75, 2]; // tree diagram scale
const STORAGE_KEY = 'taskchain_state_v2';       // legacy single-project key, read once for migration
const WORKSPACE_KEY = 'taskchain_workspace_v1'; // current multi-project storage
const SIDEBAR_COLLAPSED_KEY = 'taskchain_sidebar_collapsed';
const APP_VERSION = 'v1.4';

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
  dragTaskId: null,
  zoomIndex: 4,
  treeZoomIndex: 3,
};

function generateProjectId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function createEmptyProject(name) {
  return {
    id: generateProjectId(),
    meta: { projectName: name || 'Untitled project', lastModified: nowISO() },
    tasks: [],
    nextIdNum: 1,
  };
}
function createDefaultWorkspace() {
  const p = createEmptyProject('Untitled project');
  return { projects: [p], activeProjectId: p.id };
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
  p.tasks.forEach(t => { t.parents = t.parents || []; t.history = t.history || []; });
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
        return { projects: [legacy], activeProjectId: legacy.id };
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

/* Maps taskId -> [releasedDescendantTask, ...] for tasks that are NOT
   released while a descendant already is. Used to draw the dashed
   orange warning around parent tasks. */
function computeUnreleasedParentWarnings() {
  const warnMap = new Map();
  state.tasks.filter(t => t.status === 'released').forEach(r => {
    getAncestors(r.id).forEach(a => {
      if (a.status !== 'released') {
        if (!warnMap.has(a.id)) warnMap.set(a.id, []);
        warnMap.get(a.id).push(r);
      }
    });
  });
  return warnMap;
}

/* =========================================================
   CRUD
   ========================================================= */
function upsertTaskFromForm() {
  const id = document.getElementById('taskFormId').value || null;
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { toast('A title is required.'); return null; }

  const status = document.getElementById('taskStatus').value;
  const link = document.getElementById('taskLink').value.trim();
  const deadline = document.getElementById('taskDeadline').value || null;
  const durationRaw = document.getElementById('taskDuration').value;
  const duration = durationRaw === '' ? null : Math.max(0, parseInt(durationRaw, 10));
  const parents = Array.from(document.querySelectorAll('#parentPicker input[type=checkbox]:checked')).map(cb => cb.value);
  const history = ui.draftHistory.slice();

  if (id) {
    const task = getTask(id);
    task.title = title;
    task.link = link;
    task.deadline = deadline;
    task.duration = duration;
    task.parents = parents.filter(p => p !== id);
    task.history = history;
    task.status = status; // status transitions themselves are logged via the status-change modal
    saveState();
    toast(`Task ${id} updated.`);
    return id;
  } else {
    const newId = generateId();
    const task = {
      id: newId, title, link, status, deadline, duration,
      parents,
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
  workspace.projects.splice(workspace.projects.indexOf(src) + 1, 0, clone);
  switchToProject(clone.id);
  toast(`Duplicated as "${clone.meta.projectName}".`);
}

async function handleRenameProject(id) {
  const p = workspace.projects.find(x => x.id === id);
  if (!p) return;
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
  const sorted = workspace.projects.slice().sort((a, b) =>
    (b.meta.lastModified || '').localeCompare(a.meta.lastModified || ''));

  list.innerHTML = sorted.map(p => {
    const active = p.id === workspace.activeProjectId;
    const count = p.tasks.length;
    return `<div class="sidebar-project-item${active ? ' active' : ''}" data-id="${p.id}">
      <div class="sidebar-project-info">
        <div class="sidebar-project-name" title="${escapeAttr(p.meta.projectName)}">${escapeHtml(p.meta.projectName)}</div>
        <div class="sidebar-project-meta">${count} task${count === 1 ? '' : 's'}</div>
      </div>
      <div class="sidebar-project-actions">
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
      if (action === 'rename') handleRenameProject(id);
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
  if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true') sidebarEl.classList.add('collapsed');
  document.getElementById('btnSidebarToggle').onclick = () => {
    sidebarEl.classList.toggle('collapsed');
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarEl.classList.contains('collapsed'));
  };
  document.getElementById('btnNewProject').onclick = handleNewProject;
  renderSidebar();
}

/* =========================================================
   STATUS CHANGE MODAL
   Pops up whenever a task's status changes (Kanban drag or the
   status dropdown in the edit modal). Lets the user log a reason
   and choose whether to cascade to child tasks. Cascading is never
   offered when moving TO Released — a parent finishing does not
   mean its children are automatically done.
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
    const canPropagate = newStatus !== 'released' && descendants.length > 0;
    document.getElementById('statusChangePropagateRow').hidden = !canPropagate;
    document.getElementById('statusChangePropagateCheckbox').checked = true;
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
  const result = await showStatusChangeModal(task, newStatus);
  if (!result) return false;

  const oldLabel = STATUS_META[task.status].label;
  const newLabel = STATUS_META[newStatus].label;
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

  document.getElementById('taskModalTitle').textContent = task ? `Edit ${task.id}` : 'New task';
  document.getElementById('taskFormId').value = task ? task.id : '';
  document.getElementById('taskTitle').value = task ? task.title : '';
  document.getElementById('taskStatus').value = task ? task.status : 'working';
  document.getElementById('taskLink').value = task ? (task.link || '') : '';
  document.getElementById('taskDeadline').value = task ? (task.deadline || '') : '';
  document.getElementById('taskDuration').value = task && task.duration != null ? task.duration : '';
  document.getElementById('historyDateInput').value = todayStr();
  document.getElementById('historyNoteInput').value = '';
  document.getElementById('btnDeleteTask').hidden = !task;

  ui.draftHistory = task ? task.history.slice() : [];
  renderHistoryList();

  const excluded = new Set(task ? [task.id, ...getDescendants(task.id).map(t => t.id)] : []);
  const picker = document.getElementById('parentPicker');
  picker.innerHTML = '';
  const candidates = state.tasks.filter(t => !excluded.has(t.id));
  if (!candidates.length) {
    picker.innerHTML = '<div class="parent-picker-empty">No other tasks available.</div>';
  } else {
    candidates.forEach(t => {
      const row = document.createElement('label');
      row.className = 'parent-picker-item';
      const checked = task && task.parents.includes(t.id) ? 'checked' : '';
      row.innerHTML = `<input type="checkbox" value="${t.id}" ${checked}> <span class="id-tag">${t.id}</span> ${escapeHtml(t.title)}`;
      picker.appendChild(row);
    });
  }

  if (task) {
    refreshModalComputedDisplays(task.id);
  } else {
    document.getElementById('taskDeadlineNote').textContent = '';
    document.getElementById('parentWarningBanner').hidden = true;
  }

  document.getElementById('taskModalOverlay').classList.add('open');
  document.getElementById('taskTitle').focus();
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

  const warnMap = computeUnreleasedParentWarnings();
  const banner = document.getElementById('parentWarningBanner');
  if (warnMap.has(taskId)) {
    const list = warnMap.get(taskId).map(c => `${c.id} (${c.title})`).join(', ');
    banner.textContent = `⚠ This task is not yet Released, but the following descendant task(s) already are: ${list}.`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
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
  const savedId = upsertTaskFromForm();
  if (savedId) {
    closeTaskModal();
    renderAll();
  }
}

async function handleDeleteTask() {
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
function getFilteredTasks() {
  let list = state.tasks.slice();
  if (ui.statusFilter !== 'all') list = list.filter(t => t.status === ui.statusFilter);
  if (ui.search.trim()) {
    const q = ui.search.trim().toLowerCase();
    list = list.filter(t => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }
  return list.sort((a, b) => {
    const na = parseInt(a.id.split('-')[1], 10), nb = parseInt(b.id.split('-')[1], 10);
    return na - nb;
  });
}

function renderList() {
  const tbody = document.getElementById('taskTableBody');
  const list = getFilteredTasks();
  const schedule = computeSchedule();
  const warnMap = computeUnreleasedParentWarnings();

  document.getElementById('listEmptyState').hidden = state.tasks.length > 0;
  document.getElementById('taskTableBody').closest('table').style.display = state.tasks.length ? '' : 'none';

  tbody.innerHTML = list.map(t => {
    const parentsHtml = t.parents.length
      ? t.parents.map(pid => {
          const p = getTask(pid);
          const label = p ? `${pid}: ${p.title}` : pid;
          return `<span class="dep-tag" title="${escapeAttr(label)}">${escapeHtml(label)}</span>`;
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

    const warnHtml = warnMap.has(t.id)
      ? `<span class="warn-icon" title="A descendant task is already Released while this task is not">⚠</span>`
      : '';

    return `<tr>
      <td class="id-tag">${t.id}</td>
      <td class="task-title-cell" data-open="${t.id}">${escapeHtml(t.title)}</td>
      <td>${statusBadge(t.status)}${warnHtml}</td>
      <td>${parentsHtml}</td>
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
}

function statusBadge(status) {
  const meta = STATUS_META[status] || { label: status };
  return `<span class="badge-status status-${status}">${meta.label}</span>`;
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

  const warnMap = computeUnreleasedParentWarnings();
  const { positions, maxLevel, maxCount } = computeTreeLayout();

  const canvasW = maxCount * (TREE_BOX_W + TREE_H_GAP) - TREE_H_GAP + TREE_PAD * 2;
  const canvasH = (maxLevel + 1) * (TREE_BOX_H + TREE_V_GAP) - TREE_V_GAP + TREE_PAD * 2;

  const px = (id) => TREE_PAD + positions[id].order * (TREE_BOX_W + TREE_H_GAP);
  const py = (id) => TREE_PAD + positions[id].level * (TREE_BOX_H + TREE_V_GAP);

  let edges = '';
  state.tasks.forEach(t => {
    t.parents.forEach(pid => {
      if (!positions[pid]) return;
      const parentTask = getTask(pid);
      const x1 = px(pid) + TREE_BOX_W / 2, y1 = py(pid) + TREE_BOX_H;
      const x2 = px(t.id) + TREE_BOX_W / 2, y2 = py(t.id);
      const midY = (y1 + y2) / 2;
      edges += `<path class="tree-edge" style="stroke:var(--status-${parentTask.status});" d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" marker-end="url(#tree-arrow-${parentTask.status})"></path>`;
    });
  });

  let boxes = '';
  state.tasks.forEach(t => {
    const badge = t.parents.length > 1 ? `<span class="tree-multi-badge" title="Depends on ${t.parents.length} parent tasks">⛓ ${t.parents.length}</span>` : '';
    const warnCls = warnMap.has(t.id) ? ' warn-not-released' : '';
    const warnTitle = warnMap.has(t.id) ? ` title="Not yet Released, but ${warnMap.get(t.id).map(c => c.id).join(', ')} already is/are."` : '';
    boxes += `<div class="tree-box status-${t.status}${warnCls}" style="left:${px(t.id)}px;top:${py(t.id)}px;width:${TREE_BOX_W}px;height:${TREE_BOX_H}px;" data-id="${t.id}"${warnTitle}>
      <div class="tree-box-top">
        <span class="id-tag">${t.id}</span>
        <span class="tree-box-title">${escapeHtml(t.title)}</span>
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
        ${STATUS_ORDER.map(s => `
        <marker id="tree-arrow-${s}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" style="fill:var(--status-${s});"></path>
        </marker>`).join('')}
      </defs>
      ${edges}
    </svg>
    ${boxes}`;

  canvas.querySelectorAll('.tree-box').forEach(el => {
    el.onclick = () => openTaskModal(el.dataset.id);
  });
}

/* =========================================================
   RENDER: KANBAN (planning tab)
   ========================================================= */
function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  const warnMap = computeUnreleasedParentWarnings();
  board.innerHTML = STATUS_ORDER.map(status => {
    const tasks = state.tasks.filter(t => t.status === status)
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    return `<div class="kanban-col" data-status="${status}">
      <div class="kanban-col-header" style="color:var(--status-${status});">
        <span>${STATUS_META[status].label}</span>
        <span class="kanban-col-count">${tasks.length}</span>
      </div>
      <div class="kanban-col-body" data-status="${status}">
        ${tasks.map(t => kanbanCardHtml(t, warnMap)).join('') || ''}
      </div>
    </div>`;
  }).join('');

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
}

function kanbanCardHtml(t, warnMap) {
  const childCount = getDescendants(t.id).length;
  const warnCls = warnMap.has(t.id) ? ' warn-not-released' : '';
  return `<div class="kanban-card status-${t.status}${warnCls}" draggable="true" data-id="${t.id}">
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
  if (applied) toast(`${task.id} → ${STATUS_META[newStatus].label}`);
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
    const isMilestone = !(task.duration != null && task.duration > 0);
    const left = daysBetween(minDate, sched.start || sched.finish) * pxPerDay;
    let innerHtml;

    if (isMilestone) {
      innerHtml = `<div class="timeline-milestone status-${task.status}" style="left:${left}px;" data-id="${task.id}" title="${escapeAttr(task.title)}: ${formatDate(sched.finish)}"></div>`;
    } else {
      const derived = sched.finishSource === 'derived';
      const runs = computeBusinessRuns(sched.start, sched.finish);
      const tooltip = `${task.title}: ${formatDate(sched.start)} → ${formatDate(sched.finish)}${derived ? ' (calculated)' : ''}${sched.conflict ? ' — deadline conflict' : ''}`;
      const cls = ['timeline-bar', `status-${task.status}`, derived ? 'derived' : '', sched.conflict ? 'conflict' : ''];

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
        return `<div class="${segCls}" style="left:${segLeft}px;width:${segWidth}px;" data-id="${task.id}" title="${escapeAttr(tooltip)}">${label}</div>`;
      }).join('');

      const bridgeHtml = runs.slice(0, -1).map(([, runEnd], i) => {
        const nextStart = runs[i + 1][0];
        const bLeft = daysBetween(minDate, runEnd) * pxPerDay + pxPerDay - 1;
        const bWidth = daysBetween(runEnd, nextStart) * pxPerDay - pxPerDay + 2;
        return `<div class="timeline-bar-bridge status-${task.status}" style="left:${bLeft}px;width:${Math.max(0, bWidth)}px;"></div>`;
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
      <span style="color:var(--status-rework);">Red outline = deadline conflict</span>
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
  renderList();
  renderTree();
  renderKanban();
  renderTimeline();
  renderSidebar();
  document.getElementById('projectNameInput').value = state.meta.projectName;
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

async function handleFirebaseSave() {
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
    await db.collection('taskchain_projects').doc(cfg.docId).set({
      json: JSON.stringify(workspace),
      projectCount: workspace.projects.length,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    setFirebaseStatus(`Saved ${workspace.projects.length} project(s) to Firebase as "${cfg.docId}".`, false);
    toast('Workspace saved to Firebase.');
  } catch (e) {
    setFirebaseStatus('Save failed: ' + (e.message || e), true);
  }
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
  const project = {
    id: generateProjectId(),
    meta: { projectName: 'Example — Mechanical component', lastModified: nowISO() },
    nextIdNum: 7,
    tasks: [
      {
        id: 'T-1', title: 'Component design', link: 'https://example.com/design-doc',
        status: 'working', deadline: null, duration: 5, parents: [],
        history: [{ date: addDays(t, -20), note: 'Task created' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-2', title: 'Component calculations', link: '',
        status: 'released', deadline: addDays(t, -3), duration: 4, parents: ['T-1'],
        history: [
          { date: addDays(t, -18), note: 'Task created' },
          { date: addDays(t, -3), note: 'Status changed: Working → Released' },
        ],
        createdAt: nowISO(),
      },
      {
        id: 'T-3', title: 'Test validation', link: '',
        status: 'release_process', deadline: addDays(t, 4), duration: 3, parents: ['T-2'],
        history: [{ date: addDays(t, -5), note: 'Task created' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-4', title: 'Housing design', link: '',
        status: 'working', deadline: addDays(t, 10), duration: 6, parents: [],
        history: [{ date: addDays(t, -2), note: 'Task created' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-5', title: 'Final bill of materials', link: '',
        status: 'working', deadline: addDays(t, 16), duration: 2, parents: ['T-3', 'T-4'],
        history: [{ date: addDays(t, -1), note: 'Task created' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-6', title: 'Assembly drawings', link: '',
        status: 'working', deadline: null, duration: 4, parents: ['T-1'],
        history: [{ date: addDays(t, -1), note: 'Task created — has no deadline of its own; scheduled forward once T-1 gets a calculated finish date from T-2.' }],
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
  document.getElementById('btnNewTask').onclick = () => openTaskModal(null);
  document.getElementById('btnEmptyNewTask').onclick = () => openTaskModal(null);

  document.getElementById('btnExport').onclick = exportWorkspaceJSON;
  document.getElementById('btnImport').onclick = () => document.getElementById('fileImport').click();
  document.getElementById('fileImport').onchange = e => {
    if (e.target.files[0]) importJSONFile(e.target.files[0]);
    e.target.value = '';
  };
  document.getElementById('btnLoadExample').onclick = () => loadExampleData();
  document.getElementById('btnReset').onclick = async () => {
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
    state.meta.projectName = e.target.value;
    saveState();
    renderSidebar();
  };

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
  document.querySelectorAll('#statusFilterChips .chip').forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll('#statusFilterChips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ui.statusFilter = chip.dataset.status;
      renderList();
    };
  });
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
}

function initModal() {
  document.getElementById('taskModalClose').onclick = closeTaskModal;
  document.getElementById('btnCancelTask').onclick = closeTaskModal;
  document.getElementById('btnSaveTask').onclick = handleSaveTask;
  document.getElementById('btnDeleteTask').onclick = handleDeleteTask;
  document.getElementById('taskModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'taskModalOverlay') closeTaskModal();
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

  document.getElementById('historyNoteInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnAddHistory').click(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeTaskModal();
      document.getElementById('confirmOverlay').classList.remove('open');
      document.getElementById('statusChangeOverlay').classList.remove('open');
      document.getElementById('promptOverlay').classList.remove('open');
      closeFirebaseModal();
    }
  });
}

function init() {
  document.getElementById('versionBadge').textContent = APP_VERSION;
  initTabs();
  initToolbar();
  initListFilters();
  initTreeControls();
  initModal();
  initSidebar();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
