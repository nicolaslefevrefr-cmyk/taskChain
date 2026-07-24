/* =========================================================
   TaskChain — app.js
   Vanilla JS, no dependencies. Single source of truth: `state`.
   ========================================================= */

/* ---------- Status metadata ---------- */
const STATUS_ORDER = ['working', 'release_process', 'released', 'rework'];
const STATUS_META = {
  working:         { label: 'Working',             short: 'Working' },
  release_process: { label: 'In Release Process',   short: 'Release Proc.' },
  released:        { label: 'Released',             short: 'Released' },
  rework:          { label: 'Rework',               short: 'Rework' },
};

const STORAGE_KEY = 'taskchain_state_v1';

/* ---------- State ---------- */
let state = loadState() || createEmptyState();
let ui = {
  activeTab: 'list',
  search: '',
  statusFilter: 'all',
  collapsedNodes: new Set(),   // tree node ids collapsed
  editingTaskId: null,         // task currently open in modal (null = new)
  draftHistory: [],            // history array being edited in modal (copy)
  dragTaskId: null,
};

function createEmptyState() {
  return {
    meta: { projectName: 'Projet sans titre', lastModified: nowISO() },
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
    flashSaveIndicator();
  } catch (e) { /* storage unavailable — ignore silently */ }
}

let saveIndicatorTimer = null;
function flashSaveIndicator() {
  const el = document.getElementById('saveIndicator');
  el.textContent = 'Enregistré';
  el.classList.remove('saving');
  clearTimeout(saveIndicatorTimer);
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
function formatDateFR(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* =========================================================
   CRUD
   ========================================================= */
function upsertTaskFromForm() {
  const id = document.getElementById('taskFormId').value || null;
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { toast('Le titre est requis.'); return null; }

  const status = document.getElementById('taskStatus').value;
  const link = document.getElementById('taskLink').value.trim();
  const deadline = document.getElementById('taskDeadline').value || null;
  const durationRaw = document.getElementById('taskDuration').value;
  const duration = durationRaw === '' ? null : Math.max(0, parseInt(durationRaw, 10));
  const parents = Array.from(document.querySelectorAll('#parentPicker input[type=checkbox]:checked')).map(cb => cb.value);
  const history = ui.draftHistory.slice();

  if (id) {
    const task = getTask(id);
    const oldStatus = task.status;
    task.title = title;
    task.link = link;
    task.deadline = deadline;
    task.duration = duration;
    task.parents = parents.filter(p => p !== id);
    task.history = history;

    if (status !== oldStatus) {
      const propagate = document.getElementById('propagateCheckbox').checked;
      applyStatusChange(task, status, propagate, true);
    } else {
      task.status = status;
    }
    saveState();
    toast(`Tâche ${id} mise à jour.`);
    return id;
  } else {
    const newId = generateId();
    const task = {
      id: newId,
      title, link, status, deadline, duration,
      parents: parents,
      history: history.length ? history : [{ date: todayStr(), note: 'Création de la tâche' }],
      createdAt: nowISO(),
    };
    state.tasks.push(task);
    saveState();
    toast(`Tâche ${newId} créée.`);
    return newId;
  }
}

// Applies a status change to `task`, optionally cascading to descendants.
function applyStatusChange(task, newStatus, propagate, addHistoryNote) {
  const oldStatus = task.status;
  task.status = newStatus;
  if (addHistoryNote && oldStatus !== newStatus) {
    task.history.push({
      date: todayStr(),
      note: `Statut changé : ${STATUS_META[oldStatus]?.label || oldStatus} → ${STATUS_META[newStatus].label}`,
    });
  }
  if (propagate) {
    const descendants = getDescendants(task.id);
    for (const d of descendants) {
      if (d.status !== newStatus) {
        d.status = newStatus;
        d.history.push({
          date: todayStr(),
          note: `Statut mis à jour automatiquement (${STATUS_META[newStatus].label}) suite à la modification de la tâche parente "${task.title}" (${task.id})`,
        });
      }
    }
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
  // buttons: [{label, value, primary, danger}]
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
   TASK MODAL
   ========================================================= */
function openTaskModal(taskId) {
  ui.editingTaskId = taskId;
  const task = taskId ? getTask(taskId) : null;

  document.getElementById('taskModalTitle').textContent = task ? `Modifier ${task.id}` : 'Nouvelle tâche';
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

  // Parent picker: exclude self and own descendants (avoid cycles)
  const excluded = new Set(task ? [task.id, ...getDescendants(task.id).map(t => t.id)] : []);
  const picker = document.getElementById('parentPicker');
  picker.innerHTML = '';
  const candidates = state.tasks.filter(t => !excluded.has(t.id));
  if (!candidates.length) {
    picker.innerHTML = '<div class="parent-picker-empty">Aucune autre tâche disponible.</div>';
  } else {
    candidates.forEach(t => {
      const row = document.createElement('label');
      row.className = 'parent-picker-item';
      const checked = task && task.parents.includes(t.id) ? 'checked' : '';
      row.innerHTML = `<input type="checkbox" value="${t.id}" ${checked}> <span class="id-tag">${t.id}</span> ${escapeHtml(t.title)}`;
      picker.appendChild(row);
    });
  }

  // Propagate checkbox only relevant when editing an existing task that has children
  document.getElementById('propagateRow').hidden = !task || getDescendants(task.id).length === 0;

  document.getElementById('taskModalOverlay').classList.add('open');
  document.getElementById('taskTitle').focus();
}

function closeTaskModal() {
  document.getElementById('taskModalOverlay').classList.remove('open');
  ui.editingTaskId = null;
}

function renderHistoryList() {
  const wrap = document.getElementById('historyList');
  const sorted = ui.draftHistory.slice().sort((a, b) => a.date < b.date ? 1 : -1);
  if (!sorted.length) {
    wrap.innerHTML = '<div class="history-empty">Aucune entrée d\'historique.</div>';
    return;
  }
  wrap.innerHTML = sorted.map((h, i) => {
    const realIndex = ui.draftHistory.indexOf(h);
    return `<div class="history-item">
      <span class="h-date">${formatDateFR(h.date)}</span>
      <span class="h-note">${escapeHtml(h.note)}</span>
      <button class="h-del" data-index="${realIndex}" title="Supprimer">&times;</button>
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
  const id = document.getElementById('taskFormId').value || null;
  const newStatus = document.getElementById('taskStatus').value;

  if (id) {
    const task = getTask(id);
    const descendants = getDescendants(id);
    if (task.status !== newStatus && descendants.length > 0) {
      // propagateCheckbox already reflects the user's choice in the form; nothing extra to do here.
    }
  }
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
      `"${task.title}" (${id}) a ${children.length} tâche(s) enfant. Voulez-vous rattacher ces tâches aux parents de "${task.title}" ou les détacher (elles deviendront racines) ?`,
      [
        { label: 'Annuler', value: 'cancel' },
        { label: 'Détacher', value: 'detach' },
        { label: 'Rattacher aux parents', value: 'reparent', primary: true },
      ]
    );
    if (choice === 'cancel') return;
    reparent = choice === 'reparent';
  } else {
    const choice = await showConfirm(`Supprimer définitivement "${task.title}" (${id}) ?`, [
      { label: 'Annuler', value: 'cancel' },
      { label: 'Supprimer', value: 'delete', danger: true, primary: true },
    ]);
    if (choice !== 'delete') return;
  }
  deleteTaskById(id, reparent);
  closeTaskModal();
  renderAll();
  toast('Tâche supprimée.');
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
  document.getElementById('listEmptyState').hidden = state.tasks.length > 0;
  document.getElementById('taskTableBody').closest('table').style.display = state.tasks.length ? '' : 'none';

  tbody.innerHTML = list.map(t => {
    const parentsHtml = t.parents.length
      ? t.parents.map(pid => `<span class="dep-tag">${pid}</span>`).join('')
      : '<span class="label-hint">—</span>';
    const linkHtml = t.link ? `<a class="link-icon" href="${escapeAttr(t.link)}" target="_blank" rel="noopener" title="${escapeAttr(t.link)}">🔗</a>` : '<span class="label-hint">—</span>';
    return `<tr>
      <td class="id-tag">${t.id}</td>
      <td class="task-title-cell" data-open="${t.id}">${escapeHtml(t.title)}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${parentsHtml}</td>
      <td>${t.deadline ? formatDateFR(t.deadline) : '<span class="label-hint">—</span>'}</td>
      <td>${t.duration != null ? t.duration + ' j' : '<span class="label-hint">—</span>'}</td>
      <td>${linkHtml}</td>
      <td class="row-actions">
        <button class="icon-btn" data-open="${t.id}" title="Modifier">✏️</button>
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

  if (!state.tasks.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Aucune tâche à afficher.</p></div>';
    return;
  }
  if (!roots.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Toutes les tâches ont un parent (boucle possible). Vérifiez vos liens.</p></div>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'tree-root-list';
  roots.forEach(r => container.appendChild(renderTreeNode(r, new Set())));
  wrap.innerHTML = '';
  wrap.appendChild(container);
}

function renderTreeNode(task, ancestryPath) {
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
  card.className = `tree-node-card status-${task.status}`;
  card.innerHTML = `
    <span class="id-tag">${task.id}</span>
    <span class="tree-node-title">${escapeHtml(task.title)}</span>
    <span class="tree-node-meta">
      ${task.deadline ? `<span class="label-hint">${formatDateFR(task.deadline)}</span>` : ''}
      ${statusBadge(task.status)}
    </span>`;
  card.onclick = () => openTaskModal(task.id);
  row.appendChild(card);
  node.appendChild(row);

  // secondary parents note (for children with >1 parent, shown once at root display; here just indicate count)
  if (task.parents.length > 1) {
    const note = document.createElement('div');
    note.className = 'tree-extra-parent';
    note.textContent = `également lié à : ${task.parents.filter(p => p).join(', ')}`;
    node.appendChild(note);
  }

  if (children.length && !isCycle && !collapsed) {
    const childWrap = document.createElement('div');
    childWrap.className = 'tree-children';
    const newPath = new Set(ancestryPath); newPath.add(task.id);
    children.forEach(c => childWrap.appendChild(renderTreeNode(c, newPath)));
    node.appendChild(childWrap);
  } else if (isCycle) {
    const warn = document.createElement('div');
    warn.className = 'tree-extra-parent';
    warn.textContent = '⚠ boucle détectée, arrêt de l\'affichage ici';
    node.appendChild(warn);
  }

  return node;
}

/* =========================================================
   RENDER: KANBAN (planning tab)
   ========================================================= */
function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = STATUS_ORDER.map(status => {
    const tasks = state.tasks.filter(t => t.status === status)
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    return `<div class="kanban-col" data-status="${status}">
      <div class="kanban-col-header status-${status}" style="color:var(--status-${status});">
        <span>${STATUS_META[status].label}</span>
        <span class="kanban-col-count">${tasks.length}</span>
      </div>
      <div class="kanban-col-body" data-status="${status}">
        ${tasks.map(t => kanbanCardHtml(t)).join('') || ''}
      </div>
    </div>`;
  }).join('');

  // Drag & drop wiring
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

function kanbanCardHtml(t) {
  const childCount = getDescendants(t.id).length;
  return `<div class="kanban-card status-${t.status}" draggable="true" data-id="${t.id}">
    <div class="kanban-card-title">${escapeHtml(t.title)}</div>
    <div class="kanban-card-meta">
      <span class="kanban-card-id">${t.id}</span>
      ${t.deadline ? `<span>· ${formatDateFR(t.deadline)}</span>` : ''}
      ${childCount ? `<span class="kanban-card-children">· ${childCount} enfant(s)</span>` : ''}
    </div>
  </div>`;
}

async function handleStatusDrop(taskId, newStatus) {
  const task = getTask(taskId);
  if (!task || task.status === newStatus) { renderKanban(); return; }
  const descendants = getDescendants(taskId);
  let propagate = false;
  if (descendants.length) {
    const choice = await showConfirm(
      `Propager le nouveau statut "${STATUS_META[newStatus].label}" aux ${descendants.length} tâche(s) enfant de "${task.title}" ?`,
      [
        { label: 'Ne pas propager', value: 'no' },
        { label: 'Propager', value: 'yes', primary: true },
      ]
    );
    propagate = choice === 'yes';
  }
  applyStatusChange(task, newStatus, propagate, true);
  saveState();
  renderAll();
  toast(`${task.id} → ${STATUS_META[newStatus].label}`);
}

/* =========================================================
   RENDER: TIMELINE (simple gantt bars)
   ========================================================= */
function renderTimeline() {
  const wrap = document.getElementById('timelineWrap');
  const scheduled = state.tasks.filter(t => t.deadline && t.duration != null);
  if (!scheduled.length) {
    wrap.innerHTML = '<div class="timeline-empty">Ajoutez une deadline et une durée à vos tâches pour les voir apparaître ici.</div>';
    return;
  }

  const bars = scheduled.map(t => ({
    task: t,
    start: addDays(t.deadline, -t.duration),
    end: t.deadline,
  }));

  let minDate = bars.reduce((m, b) => b.start < m ? b.start : m, bars[0].start);
  let maxDate = bars.reduce((m, b) => b.end > m ? b.end : m, bars[0].end);
  // pad a bit
  minDate = addDays(minDate, -2);
  maxDate = addDays(maxDate, 4);
  const totalDays = Math.max(1, daysBetween(minDate, maxDate));
  const pxPerDay = 28;
  const totalWidth = totalDays * pxPerDay;

  bars.sort((a, b) => a.start.localeCompare(b.start));

  const ruler = buildRuler(minDate, totalDays, pxPerDay);
  const todayOffset = daysBetween(minDate, todayStr()) * pxPerDay;

  const rows = bars.map(b => {
    const left = daysBetween(minDate, b.start) * pxPerDay;
    const width = Math.max(pxPerDay * 0.6, daysBetween(b.start, b.end) * pxPerDay);
    return `<div class="timeline-row">
      <div class="timeline-label">
        <span class="id-tag">${b.task.id}</span>
        <span>${escapeHtml(b.task.title)}</span>
      </div>
      <div class="timeline-track" style="width:${totalWidth}px;">
        <div class="timeline-bar status-${b.task.status}" style="left:${left}px;width:${width}px;" title="${escapeAttr(b.task.title)}: ${formatDateFR(b.start)} → ${formatDateFR(b.end)}">
          ${formatDateFR(b.start)} → ${formatDateFR(b.end)}
        </div>
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `<div class="timeline-inner">
    <div class="timeline-ruler">
      <div class="timeline-label">Tâche</div>
      <div class="timeline-ruler-track" style="width:${totalWidth}px;">${ruler}${todayOffset >= 0 && todayOffset <= totalWidth ? `<div class="timeline-today-line" style="left:${todayOffset}px;"></div>` : ''}</div>
    </div>
    ${rows}
  </div>`;

  wrap.querySelectorAll('.timeline-bar').forEach((el, i) => {
    el.onclick = () => openTaskModal(bars[i].task.id);
    el.style.cursor = 'pointer';
  });
}

function buildRuler(minDate, totalDays, pxPerDay) {
  let ticks = '';
  // weekly ticks
  for (let d = 0; d <= totalDays; d += 7) {
    const dateStr = addDays(minDate, d);
    ticks += `<div class="timeline-tick" style="left:${d * pxPerDay}px;">${formatDateFR(dateStr)}</div>`;
  }
  return ticks;
}

/* =========================================================
   RENDER: RETRO PLANNING
   ========================================================= */
function computeRequiredDates() {
  // required[id] = { finish, start, conflict }
  const memo = {};
  function computeFinish(id, visiting) {
    if (memo[id] !== undefined) return memo[id];
    if (visiting.has(id)) { memo[id] = null; return null; } // cycle guard
    visiting.add(id);
    const task = getTask(id);
    let required = task.deadline || null;
    for (const child of getChildren(id)) {
      const childFinish = computeFinish(child.id, visiting);
      if (childFinish) {
        const childDur = child.duration || 0;
        const candidate = addDays(childFinish, -childDur);
        if (required === null || candidate < required) required = candidate;
      }
    }
    memo[id] = required;
    return required;
  }
  const result = {};
  state.tasks.forEach(t => {
    const finish = computeFinish(t.id, new Set());
    const start = finish != null && t.duration != null ? addDays(finish, -t.duration) : null;
    const conflict = !!(t.deadline && finish && finish < t.deadline);
    result[t.id] = { finish, start, conflict };
  });
  return result;
}

function renderRetro() {
  const required = computeRequiredDates();

  // Chain selector: leaf tasks (no children) make sense as "final" tasks of a chain
  const select = document.getElementById('chainSelect');
  const prevValue = select.value;
  const leafTasks = state.tasks.filter(t => getChildren(t.id).length === 0);
  const options = (leafTasks.length ? leafTasks : state.tasks);
  select.innerHTML = options.map(t => `<option value="${t.id}">${t.id} — ${escapeHtml(t.title)}</option>`).join('');
  if (options.some(o => o.id === prevValue)) select.value = prevValue;

  renderChainView(select.value, required);

  // Full table
  const tbody = document.getElementById('retroTableBody');
  const list = getFilteredTasksForRetro();
  tbody.innerHTML = list.map(t => {
    const r = required[t.id];
    let stateHtml = '<span class="state-none">—</span>';
    if (r.conflict) stateHtml = '<span class="state-conflict">⚠ Deadline trop tardive</span>';
    else if (t.deadline || r.finish) stateHtml = '<span class="state-ok">OK</span>';
    return `<tr>
      <td class="id-tag">${t.id}</td>
      <td class="task-title-cell" data-open="${t.id}">${escapeHtml(t.title)}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${t.deadline ? formatDateFR(t.deadline) : '<span class="label-hint">—</span>'}</td>
      <td>${r.finish ? formatDateFR(r.finish) : '<span class="label-hint">—</span>'}</td>
      <td>${r.start ? formatDateFR(r.start) : '<span class="label-hint">—</span>'}</td>
      <td>${stateHtml}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-open]').forEach(el => { el.onclick = () => openTaskModal(el.dataset.open); });
}

function getFilteredTasksForRetro() {
  return state.tasks.slice().sort((a, b) => {
    const na = parseInt(a.id.split('-')[1], 10), nb = parseInt(b.id.split('-')[1], 10);
    return na - nb;
  });
}

function renderChainView(targetId, required) {
  const view = document.getElementById('chainView');
  const target = getTask(targetId);
  if (!target) { view.innerHTML = '<div class="chain-empty">Aucune tâche à afficher.</div>'; return; }

  const ancestors = getAncestors(targetId);
  const chainTasks = [...ancestors, target];
  // sort by required start ascending (earliest work first), fallback to nothing
  chainTasks.sort((a, b) => {
    const ra = required[a.id].start, rb = required[b.id].start;
    if (ra && rb) return ra.localeCompare(rb);
    if (ra) return -1;
    if (rb) return 1;
    return 0;
  });

  view.innerHTML = chainTasks.map((t, i) => {
    const r = required[t.id];
    const isLast = i === chainTasks.length - 1;
    return `<div class="chain-step">
      <div class="chain-step-connector">
        <div class="chain-step-dot" style="background:var(--status-${t.status});"></div>
        ${!isLast ? '<div class="chain-step-line"></div>' : ''}
      </div>
      <div class="chain-step-card ${r.conflict ? 'conflict' : ''}" data-open="${t.id}">
        <div class="chain-step-top">
          <span class="id-tag">${t.id}</span>
          <span class="chain-step-title">${escapeHtml(t.title)}</span>
          ${statusBadge(t.status)}
        </div>
        <div class="chain-step-dates">
          <span>Deadline actuelle : <b>${t.deadline ? formatDateFR(t.deadline) : '—'}</b></span>
          <span>Début requis : <b>${r.start ? formatDateFR(r.start) : '—'}</b></span>
          <span>Fin requise : <b>${r.finish ? formatDateFR(r.finish) : '—'}</b></span>
        </div>
        ${r.conflict ? `<div class="chain-conflict-msg">⚠ Cette tâche doit finir au plus tard le ${formatDateFR(r.finish)} pour respecter les deadlines en aval, mais sa deadline actuelle est le ${formatDateFR(t.deadline)}.</div>` : ''}
      </div>
    </div>`;
  }).join('');

  view.querySelectorAll('[data-open]').forEach(el => { el.onclick = () => openTaskModal(el.dataset.open); });
}

/* =========================================================
   MASTER RENDER
   ========================================================= */
function renderAll() {
  renderList();
  renderTree();
  renderKanban();
  renderTimeline();
  renderRetro();
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
  const safeName = (state.meta.projectName || 'projet').trim().replace(/[^a-z0-9\-_]+/gi, '_').toLowerCase() || 'projet';
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
      if (!Array.isArray(parsed.tasks)) throw new Error('format invalide');
      // basic normalization
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
      if (!parsed.meta) parsed.meta = { projectName: 'Projet importé', lastModified: nowISO() };
      state = parsed;
      saveState();
      renderAll();
      toast('Projet chargé.');
    } catch (e) {
      toast('Fichier JSON invalide.');
    }
  };
  reader.readAsText(file);
}

/* =========================================================
   EXAMPLE DATA
   ========================================================= */
function loadExampleData() {
  const t = todayStr();
  state = {
    meta: { projectName: 'Exemple — Composant mécanique', lastModified: nowISO() },
    nextIdNum: 6,
    tasks: [
      {
        id: 'T-1', title: 'Design du composant', link: 'https://example.com/design-doc',
        status: 'released', deadline: addDays(t, -10), duration: 5, parents: [],
        history: [
          { date: addDays(t, -20), note: 'Création de la tâche' },
          { date: addDays(t, -10), note: 'Statut changé : Working → Released' },
        ],
        createdAt: nowISO(),
      },
      {
        id: 'T-2', title: 'Calcul du composant', link: '',
        status: 'released', deadline: addDays(t, -3), duration: 4, parents: ['T-1'],
        history: [
          { date: addDays(t, -18), note: 'Création de la tâche' },
          { date: addDays(t, -3), note: 'Statut changé : Working → Released' },
        ],
        createdAt: nowISO(),
      },
      {
        id: 'T-3', title: 'Validation essais', link: '',
        status: 'release_process', deadline: addDays(t, 4), duration: 3, parents: ['T-2'],
        history: [{ date: addDays(t, -5), note: 'Création de la tâche' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-4', title: 'Design carter', link: '',
        status: 'working', deadline: addDays(t, 6), duration: 6, parents: [],
        history: [{ date: addDays(t, -2), note: 'Création de la tâche' }],
        createdAt: nowISO(),
      },
      {
        id: 'T-5', title: 'Nomenclature finale', link: '',
        status: 'working', deadline: addDays(t, 12), duration: 2, parents: ['T-3', 'T-4'],
        history: [{ date: addDays(t, -1), note: 'Création de la tâche' }],
        createdAt: nowISO(),
      },
    ],
  };
  saveState();
  renderAll();
  toast('Exemple chargé.');
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
      const choice = await showConfirm('Charger l\'exemple remplacera le projet actuel. Continuer ?', [
        { label: 'Annuler', value: 'no' }, { label: 'Charger', value: 'yes', primary: true },
      ]);
      if (choice !== 'yes') return;
    }
    loadExampleData();
  };
  document.getElementById('btnReset').onclick = async () => {
    const choice = await showConfirm('Créer un nouveau projet vide ? Les données non exportées seront perdues.', [
      { label: 'Annuler', value: 'no' }, { label: 'Nouveau projet', value: 'yes', danger: true, primary: true },
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

  document.getElementById('taskStatus').addEventListener('change', () => {
    const id = document.getElementById('taskFormId').value;
    if (!id) return;
    const descendants = getDescendants(id);
    document.getElementById('propagateRow').hidden = descendants.length === 0;
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
    }
  });
}

function initRetroControls() {
  document.getElementById('chainSelect').addEventListener('change', () => renderRetro());
}

function init() {
  initTabs();
  initToolbar();
  initListFilters();
  initTreeControls();
  initModal();
  initRetroControls();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
