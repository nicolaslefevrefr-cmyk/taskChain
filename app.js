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

const ZOOM_LEVELS = [6, 9, 13, 18, 26, 36, 48, 64]; // px per day
const STORAGE_KEY = 'taskchain_state_v2';

/* ---------- State ---------- */
let state = loadState() || createEmptyState();
let ui = {
  activeTab: 'list',
  search: '',
  statusFilter: 'all',
  collapsedNodes: new Set(),
  editingTaskId: null,
  draftHistory: [],
  dragTaskId: null,
  zoomIndex: 4,
};

function createEmptyState() {
  return {
    meta: { projectName: 'Untitled project', lastModified: nowISO() },
    tasks: [],
    nextIdNum: 1,
  };
}

function nowISO() { return new Date().toISOString(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

/* =========================================================
   PERSISTENCE
   ========================================================= */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.tasks) return null;
    return parsed;
  } catch (e) { return null; }
}

function saveState() {
  state.meta.lastModified = nowISO();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    document.getElementById('saveIndicator').textContent = 'Saved';
  } catch (e) { /* storage unavailable — ignore silently */ }
}

/* =========================================================
   DATE HELPERS — calendar days (for pixel positioning)
   ========================================================= */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.round((d2 - d1) / 86400000);
}
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function dayOfWeek(dateStr) { return new Date(dateStr + 'T00:00:00').getDay(); } // 0=Sun..6=Sat
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
   - finish comes from the task's own deadline when set ("explicit"),
     otherwise it is inferred backward from its children's required
     start dates ("derived") — this is the retro-planning logic,
     now applied everywhere a chain allows it, not only to tasks that
     already carry their own deadline.
   - A task's own deadline that is later than what its descendants
     require is flagged as a conflict.
   All math is business-day aware (weekends excluded).
   ========================================================= */
function computeSchedule() {
  const memo = {};
  function resolve(id, visiting) {
    if (memo[id]) return memo[id];
    if (visiting.has(id)) {
      const r = { finish: null, finishSource: null, start: null, conflict: false, derivedFinish: null };
      memo[id] = r;
      return r;
    }
    visiting.add(id);
    const task = getTask(id);
    let derivedFinish = null;
    for (const child of getChildren(id)) {
      const childSched = resolve(child.id, visiting);
      if (childSched.start) {
        const candidate = previousBusinessDay(childSched.start);
        if (derivedFinish === null || candidate < derivedFinish) derivedFinish = candidate;
      }
    }
    let finish = null, finishSource = null, conflict = false;
    if (task.deadline) {
      finish = task.deadline;
      finishSource = 'explicit';
      if (derivedFinish && derivedFinish < finish) conflict = true;
    } else if (derivedFinish) {
      finish = derivedFinish;
      finishSource = 'derived';
    }
    let start = null;
    if (finish) {
      start = (task.duration != null && task.duration > 0)
        ? subtractBusinessDays(finish, task.duration - 1)
        : finish;
    }
    const result = { finish, finishSource, start, conflict, derivedFinish };
    memo[id] = result;
    return result;
  }
  const out = {};
  state.tasks.forEach(t => { out[t.id] = resolve(t.id, new Set()); });
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
   RENDER: TREE
   ========================================================= */
function renderTree() {
  const wrap = document.getElementById('treeWrap');
  const roots = state.tasks.filter(t => t.parents.length === 0)
    .sort((a, b) => a.title.localeCompare(b.title));
  const warnMap = computeUnreleasedParentWarnings();

  if (!state.tasks.length) {
    wrap.innerHTML = '<div class="empty-state"><p>No tasks to display yet.</p></div>';
    return;
  }
  if (!roots.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Every task has a parent (possible cycle). Check your links.</p></div>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'tree-root-list';
  roots.forEach(r => container.appendChild(renderTreeNode(r, new Set(), warnMap)));
  wrap.innerHTML = '';
  wrap.appendChild(container);
}

function renderTreeNode(task, ancestryPath, warnMap) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  const children = getChildren(task.id).sort((a, b) => a.title.localeCompare(b.title));
  const collapsed = ui.collapsedNodes.has(task.id);
  const isCycle = ancestryPath.has(task.id);

  const row = document.createElement('div');
  row.className = 'tree-node-row';

  const toggle = document.createElement('button');
  toggle.className = 'tree-toggle' + (children.length && !isCycle ? '' : ' leaf');
  toggle.textContent = collapsed ? '▶' : '▼';
  toggle.onclick = () => {
    if (collapsed) ui.collapsedNodes.delete(task.id); else ui.collapsedNodes.add(task.id);
    renderTree();
  };
  row.appendChild(toggle);

  const card = document.createElement('div');
  card.className = `tree-node-card status-${task.status}` + (warnMap.has(task.id) ? ' warn-not-released' : '');
  if (warnMap.has(task.id)) {
    card.title = `Not yet Released, but ${warnMap.get(task.id).map(c => c.id).join(', ')} already is/are.`;
  }
  card.innerHTML = `
    <span class="id-tag">${task.id}</span>
    <span class="tree-node-title">${escapeHtml(task.title)}</span>
    <span class="tree-node-meta">
      ${task.deadline ? `<span class="label-hint">${formatDate(task.deadline)}</span>` : ''}
      ${statusBadge(task.status)}
    </span>`;
  card.onclick = () => openTaskModal(task.id);
  row.appendChild(card);
  node.appendChild(row);

  if (task.parents.length > 1) {
    const note = document.createElement('div');
    note.className = 'tree-extra-parent';
    note.textContent = `also linked to: ${task.parents.join(', ')}`;
    node.appendChild(note);
  }

  if (children.length && !isCycle && !collapsed) {
    const childWrap = document.createElement('div');
    childWrap.className = 'tree-children';
    const newPath = new Set(ancestryPath); newPath.add(task.id);
    children.forEach(c => childWrap.appendChild(renderTreeNode(c, newPath, warnMap)));
    node.appendChild(childWrap);
  } else if (isCycle) {
    const warn = document.createElement('div');
    warn.className = 'tree-extra-parent';
    warn.textContent = '⚠ cycle detected, stopping here';
    node.appendChild(warn);
  }

  return node;
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
    let barHtml;

    if (isMilestone) {
      barHtml = `<div class="timeline-milestone status-${task.status}" style="left:${left}px;" data-id="${task.id}" title="${escapeAttr(task.title)}: ${formatDate(sched.finish)}"></div>`;
    } else {
      const width = Math.max(pxPerDay * 0.8, daysBetween(sched.start, sched.finish) * pxPerDay + pxPerDay * 0.6);
      const compact = width < 74;
      const hideText = width < 26;
      const derived = sched.finishSource === 'derived';
      const label = hideText ? '' : (compact ? task.id : `${task.id} · ${formatDate(sched.start)} → ${formatDate(sched.finish)}`);
      const cls = ['timeline-bar', `status-${task.status}`, derived ? 'derived' : '', sched.conflict ? 'conflict' : '', compact ? 'compact' : ''].filter(Boolean).join(' ');
      const tooltip = `${task.title}: ${formatDate(sched.start)} → ${formatDate(sched.finish)}${derived ? ' (calculated)' : ''}${sched.conflict ? ' — deadline conflict' : ''}`;
      barHtml = `<div class="${cls}" style="left:${left}px;width:${width}px;" data-id="${task.id}" title="${escapeAttr(tooltip)}">${label}</div>`;
    }

    return `<div class="timeline-row">
      <div class="timeline-label">
        <span class="id-tag">${task.id}</span>
        <span>${escapeHtml(task.title)}</span>
      </div>
      <div class="timeline-track" style="width:${totalWidth}px;">${barHtml}</div>
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
  document.getElementById('projectNameInput').value = state.meta.projectName;
}

/* =========================================================
   IMPORT / EXPORT
   ========================================================= */
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (state.meta.projectName || 'project').trim().replace(/[^a-z0-9\-_]+/gi, '_').toLowerCase() || 'project';
  a.download = `taskchain_${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.tasks)) throw new Error('invalid format');
      parsed.tasks.forEach(t => {
        t.parents = t.parents || [];
        t.history = t.history || [];
      });
      if (!parsed.nextIdNum) {
        const maxN = parsed.tasks.reduce((m, t) => {
          const n = parseInt(String(t.id).split('-')[1], 10);
          return isNaN(n) ? m : Math.max(m, n);
        }, 0);
        parsed.nextIdNum = maxN + 1;
      }
      if (!parsed.meta) parsed.meta = { projectName: 'Imported project', lastModified: nowISO() };
      state = parsed;
      saveState();
      renderAll();
      toast('Project loaded.');
    } catch (e) {
      toast('Invalid JSON file.');
    }
  };
  reader.readAsText(file);
}

/* =========================================================
   EXAMPLE DATA
   Demonstrates: explicit deadlines, a calculated (derived) deadline
   on a parent task with none of its own, multiple parents, and a
   task already Released while a parent is not (release warning).
   ========================================================= */
function loadExampleData() {
  const t = todayStr();
  state = {
    meta: { projectName: 'Example — Mechanical component', lastModified: nowISO() },
    nextIdNum: 6,
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
    ],
  };
  saveState();
  renderAll();
  toast('Example loaded.');
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

  document.getElementById('btnExport').onclick = exportJSON;
  document.getElementById('btnImport').onclick = () => document.getElementById('fileImport').click();
  document.getElementById('fileImport').onchange = e => {
    if (e.target.files[0]) importJSONFile(e.target.files[0]);
    e.target.value = '';
  };
  document.getElementById('btnLoadExample').onclick = async () => {
    if (state.tasks.length) {
      const choice = await showConfirm('Loading the example will replace the current project. Continue?', [
        { label: 'Cancel', value: 'no' }, { label: 'Load example', value: 'yes', primary: true },
      ]);
      if (choice !== 'yes') return;
    }
    loadExampleData();
  };
  document.getElementById('btnReset').onclick = async () => {
    const choice = await showConfirm('Start a new empty project? Any unexported changes will be lost.', [
      { label: 'Cancel', value: 'no' }, { label: 'New project', value: 'yes', danger: true, primary: true },
    ]);
    if (choice !== 'yes') return;
    state = createEmptyState();
    saveState();
    renderAll();
  };

  document.getElementById('projectNameInput').oninput = e => {
    state.meta.projectName = e.target.value;
    saveState();
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
  document.getElementById('btnExpandAll').onclick = () => { ui.collapsedNodes.clear(); renderTree(); };
  document.getElementById('btnCollapseAll').onclick = () => {
    state.tasks.forEach(t => { if (getChildren(t.id).length) ui.collapsedNodes.add(t.id); });
    renderTree();
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
    }
  });
}

function init() {
  initTabs();
  initToolbar();
  initListFilters();
  initTreeControls();
  initModal();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
