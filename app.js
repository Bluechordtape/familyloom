// app.js — Main application controller
import { api, setToken, getToken, saveViewport, initSocket } from './data.js';
import { Graph, STATUS } from './graph.js';

// ─── State ───────────────────────────────────────────────────────────────────

let currentUser = null;
let graph       = null;
let socket      = null;
let appData     = { nodes: {}, edges: [], members: [] };
let activityLog = [];
let onlineUsers = [];
let editingId   = null;   // node id currently in edit panel
let activeTab   = 'graph'; // mobile tab

// Visible project set (null = all)
let visibleProjects = null;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

(async () => {
  const token = getToken();
  if (token) {
    try {
      currentUser = await api.get('/api/auth/me');
      await startApp();
    } catch {
      showLogin();
    }
  } else {
    showLogin();
  }
})();

// ─── Auth screens ─────────────────────────────────────────────────────────────

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function hideLogin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

// Login form
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name     = document.getElementById('loginName').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    setLoginError('');
    const res = await api.post('/api/auth/login', { name, password });
    setToken(res.token);
    currentUser = res.user;
    await startApp();
  } catch (err) {
    setLoginError(err.message);
  }
});

document.getElementById('showRegister').addEventListener('click', () => {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'flex';
  setLoginError('');
});

document.getElementById('showLogin').addEventListener('click', () => {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'flex';
  setLoginError('');
});

document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name       = document.getElementById('regName').value.trim();
  const email      = document.getElementById('regEmail').value.trim();
  const password   = document.getElementById('regPassword').value;
  const inviteCode = document.getElementById('regInvite').value.trim();
  try {
    setLoginError('');
    const res = await api.post('/api/auth/register', { name, email, password, inviteCode });
    setToken(res.token);
    currentUser = res.user;
    await startApp();
  } catch (err) {
    setLoginError(err.message);
  }
});

function setLoginError(msg) {
  document.getElementById('loginError').textContent = msg;
}

// ─── App Init ────────────────────────────────────────────────────────────────

async function startApp() {
  hideLogin();
  window.currentUser = currentUser;

  // Init socket
  socket = initSocket({
    onData:     handleDataUpdate,
    onActivity: handleNewActivity,
    onUsers:    handleUsersOnline,
  });
  socket.emit('user:join', { id: currentUser.id, name: currentUser.name });

  // Load data
  [appData, activityLog] = await Promise.all([
    api.get('/api/data'),
    api.get('/api/activity'),
  ]);

  // Build UI
  renderToolbar();
  renderSidebar();
  initGraph();
  renderStatusBar();
  renderActivityLog();
  setupSidebarResize();
  setupMobileTabs();

  // Admin-only elements
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = currentUser.role === 'admin' ? '' : 'none';
  });

  // Load saved viewport
  try {
    const vp = await api.get('/api/viewport');
    graph.setViewport(vp.offsetX, vp.offsetY, vp.scale);
  } catch {
    graph.fitToView();
  }
}

// ─── Graph Init ───────────────────────────────────────────────────────────────

function initGraph() {
  const canvas = document.getElementById('canvas');
  graph = new Graph(canvas, { user: currentUser });
  graph.setData(appData);

  graph.onNodeMove = async (id, x, y, w, h) => {
    appData.nodes[id].x = x;
    appData.nodes[id].y = y;
    if (w !== undefined) appData.nodes[id].width  = w;
    if (h !== undefined) appData.nodes[id].height = h;
    await saveData();
  };

  graph.onConnect = async (from, to) => {
    const exists = appData.edges.some(e => e.from === from && e.to === to);
    if (!exists) {
      appData.edges.push({ from, to });
      await saveData();
      logActivity(`연결 추가: ${appData.nodes[from]?.name} → ${appData.nodes[to]?.name}`, null, from);
    }
  };

  graph.onEdgeRemove = async (from, to) => {
    appData.edges = appData.edges.filter(e => !(e.from === from && e.to === to));
    await saveData();
  };

  graph.onNodeClick = id => openEditPanel(id);

  graph.onStatusChange = async (taskId, newStatus) => {
    const task = appData.nodes[taskId];
    if (!task) return;
    const oldLabel = STATUS[task.status]?.label;
    const newLabel = STATUS[newStatus]?.label;
    try {
      await api.patch('/api/data/task-status', { taskId, status: newStatus });
      task.status = newStatus;
      graph.render();
      renderStatusBar();
      renderSidebarProjects();
      logActivity(
        `[${task.name}] ${oldLabel} → ${newLabel}`,
        _projectName(task.projectId),
        taskId
      );
    } catch (err) {
      alert(err.message);
    }
  };

  graph.onViewportChange = vp => {
    saveViewport({ offsetX: vp.x, offsetY: vp.y, scale: vp.scale });
  };
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function saveData(silent = false) {
  try {
    await api.put('/api/data', appData);
  } catch (err) {
    if (!silent) alert('저장 실패: ' + err.message);
  }
}

function handleDataUpdate(data) {
  appData = data;
  graph.setData(data);
  renderStatusBar();
  renderSidebarProjects();
  if (editingId && appData.nodes[editingId]) {
    openEditPanel(editingId); // refresh edit panel
  }
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function renderToolbar() {
  const tb = document.getElementById('toolbar');
  const members = appData.members || [];

  tb.innerHTML = `
    <div class="tb-left">
      <div class="logo">
        <svg width="28" height="28" viewBox="0 0 24 24">
          ${grid4x4()}
        </svg>
        <span class="logo-text">Family Loom</span>
        <span class="logo-ver">v1.0</span>
      </div>
    </div>
    <div class="tb-center">
      <select class="tb-select" id="filterAssignee">
        <option value="">담당자 전체</option>
        ${members.map(m => `<option value="${m}">${m}</option>`).join('')}
      </select>
      <select class="tb-select" id="filterStatus">
        <option value="">상태 전체</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
      </select>
    </div>
    <div class="tb-right">
      <div class="tb-btns admin-only" style="display:${currentUser.role==='admin'?'flex':'none'}">
        <button class="tb-btn" id="btnAddProject">+ 프로젝트</button>
        <button class="tb-btn" id="btnAddGroup">+ 묶음</button>
        <button class="tb-btn primary" id="btnAddTask">+ 업무</button>
      </div>
      <button class="tb-icon-btn" id="btnFit" title="뷰 초기화">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
      </button>
      <div class="online-avatars" id="onlineAvatars"></div>
      <button class="tb-icon-btn logout-btn" id="btnLogout" title="로그아웃">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
        </svg>
      </button>
    </div>
  `;

  document.getElementById('filterAssignee').addEventListener('change', e => {
    graph.setFilter(e.target.value, document.getElementById('filterStatus').value);
  });
  document.getElementById('filterStatus').addEventListener('change', e => {
    graph.setFilter(document.getElementById('filterAssignee').value, e.target.value);
  });
  document.getElementById('btnFit').addEventListener('click', () => graph.fitToView());
  document.getElementById('btnLogout').addEventListener('click', logout);

  if (currentUser.role === 'admin') {
    document.getElementById('btnAddProject').addEventListener('click', () => openModal('project'));
    document.getElementById('btnAddGroup').addEventListener('click',   () => openModal('group'));
    document.getElementById('btnAddTask').addEventListener('click',    () => openModal('task'));
  }
}

function handleUsersOnline(users) {
  onlineUsers = users;
  const el = document.getElementById('onlineAvatars');
  if (!el) return;
  el.innerHTML = users.slice(0, 5).map(u =>
    `<div class="avatar" title="${u.name}">${u.name[0]}</div>`
  ).join('');
}

function logout() {
  setToken(null);
  socket?.disconnect();
  location.reload();
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function renderStatusBar() {
  const bar = document.getElementById('statusBar');
  const tasks = Object.values(appData.nodes).filter(n =>
    n.type === 'task' && (n.status === 'doing' || n.status === 'review')
  );

  if (!tasks.length) {
    bar.innerHTML = '<span class="sb-empty">진행 중인 업무 없음</span>';
    return;
  }

  const byMember = {};
  tasks.forEach(t => {
    const key = t.assignee || '미배정';
    (byMember[key] = byMember[key] || []).push(t);
  });

  bar.innerHTML = Object.entries(byMember).map(([name, ts]) => `
    <div class="sb-group">
      <span class="sb-name">${name}</span>
      ${ts.map(t => `
        <span class="sb-pill s-${t.status}" data-id="${t.id}" title="${t.name}">
          ${t.name.length > 10 ? t.name.slice(0, 10) + '…' : t.name}
        </span>
      `).join('')}
    </div>
  `).join('');

  bar.querySelectorAll('.sb-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      graph.animateTo(pill.dataset.id);
      graph.highlightNode(pill.dataset.id);
    });
  });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar() {
  const sb = document.getElementById('sidebar');
  sb.innerHTML = `
    <div class="sb-section">
      <div class="sb-sec-title">VIEWS</div>
      <div class="sb-item active" id="viewAll">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
        전체 보기
      </div>
    </div>
    <div class="sb-section">
      <div class="sb-sec-title">PROJECTS</div>
      <div id="sbProjects"></div>
    </div>
    <div class="sb-section">
      <div class="sb-sec-title">ACTIVITY</div>
      <div id="sbActivity" class="sb-activity"></div>
    </div>
  `;

  document.getElementById('viewAll').addEventListener('click', () => {
    visibleProjects = null;
    graph.setData(appData);
    document.querySelectorAll('.sb-proj-item').forEach(el => el.classList.remove('solo'));
    document.getElementById('viewAll').classList.add('active');
  });

  renderSidebarProjects();
}

function renderSidebarProjects() {
  const cont = document.getElementById('sbProjects');
  if (!cont) return;
  const projects = Object.values(appData.nodes).filter(n => n.type === 'project');

  cont.innerHTML = projects.map(p => `
    <div class="sb-proj-item" data-id="${p.id}">
      <input type="checkbox" class="proj-check" data-id="${p.id}" checked>
      <span class="proj-name" data-id="${p.id}" style="color:${p.color||'#374151'}">${p.name}</span>
    </div>
  `).join('') || '<div class="sb-empty-note">프로젝트 없음</div>';

  cont.querySelectorAll('.proj-check').forEach(cb => {
    cb.addEventListener('change', () => updateProjectVisibility());
  });

  cont.querySelectorAll('.proj-name').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      // Toggle solo view
      if (visibleProjects?.length === 1 && visibleProjects[0] === id) {
        visibleProjects = null;
        cont.querySelectorAll('.proj-check').forEach(c => c.checked = true);
      } else {
        visibleProjects = [id];
        cont.querySelectorAll('.proj-check').forEach(c => {
          c.checked = (c.dataset.id === id);
        });
      }
      updateProjectVisibility();
    });
  });
}

function updateProjectVisibility() {
  const checks = document.querySelectorAll('.proj-check');
  const visible = [...checks].filter(c => c.checked).map(c => c.dataset.id);
  visibleProjects = visible.length === document.querySelectorAll('.proj-check').length
    ? null : visible;

  // Filter nodes for graph
  const filtered = filterDataByProjects(appData);
  graph.setData(filtered);
}

function filterDataByProjects(data) {
  if (!visibleProjects) return data;
  const vp = new Set(visibleProjects);
  const nodes = {};
  for (const [id, n] of Object.entries(data.nodes)) {
    if (n.type === 'project' && vp.has(id)) { nodes[id] = n; continue; }
    if (n.type === 'group'   && vp.has(n.projectId)) { nodes[id] = n; continue; }
    if (n.type === 'task'    && vp.has(n.projectId)) { nodes[id] = n; continue; }
  }
  return { ...data, nodes };
}

function renderActivityLog() {
  const el = document.getElementById('sbActivity');
  if (!el) return;

  if (!activityLog.length) {
    el.innerHTML = '<div class="sb-empty-note">활동 없음</div>';
    return;
  }

  el.innerHTML = activityLog.slice(0, 10).map(a => `
    <div class="act-item ${a.task_id ? 'has-link' : ''}" data-task="${a.task_id || ''}">
      <div class="act-msg">${a.msg}</div>
      <div class="act-meta">
        ${a.user_name ? `<span>${a.user_name}</span> · ` : ''}
        <span>${_timeAgo(a.created_at)}</span>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.act-item.has-link').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.task;
      if (id && appData.nodes[id]) {
        graph.animateTo(id);
        graph.highlightNode(id);
      }
    });
  });
}

function handleNewActivity(entry) {
  activityLog.unshift(entry);
  if (activityLog.length > 30) activityLog.pop();
  renderActivityLog();
}

async function logActivity(msg, projectName, taskId) {
  try {
    await api.post('/api/activity', { msg, projectName, taskId });
  } catch { /* ignore */ }
}

// ─── Sidebar resize ──────────────────────────────────────────────────────────

function setupSidebarResize() {
  const resizer = document.getElementById('sidebarResizer');
  const sidebar = document.getElementById('sidebar');
  let startX, startW;

  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    e.preventDefault();
  });

  const onMove = e => {
    const w = Math.max(180, Math.min(400, startW + (e.clientX - startX)));
    sidebar.style.width = `${w}px`;
    localStorage.setItem('fl_sidebarW', w);
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  };

  const saved = localStorage.getItem('fl_sidebarW');
  if (saved) sidebar.style.width = `${saved}px`;
}

// ─── Edit Panel ───────────────────────────────────────────────────────────────

function openEditPanel(id) {
  const n = appData.nodes[id];
  if (!n) return;
  editingId = id;

  const panel = document.getElementById('editPanel');
  panel.style.display = 'flex';

  const isAdmin = currentUser.role === 'admin';
  const isMine  = n.assignee === currentUser.name;
  const canFull = isAdmin;
  const canMemo = canFull || isMine;

  const projects = Object.values(appData.nodes).filter(x => x.type === 'project');
  const groups   = Object.values(appData.nodes).filter(x => x.type === 'group');

  if (n.type === 'task') {
    panel.innerHTML = `
      <div class="ep-header">
        <span class="ep-title">업무 편집</span>
        <button class="ep-close" id="epClose">✕</button>
      </div>
      <div class="ep-body">
        <label>업무명
          <input id="epName" value="${_esc(n.name)}" ${canFull?'':'disabled'}>
        </label>
        <label>프로젝트
          <select id="epProject" ${canFull?'':'disabled'}>
            <option value="">없음</option>
            ${projects.map(p => `<option value="${p.id}" ${n.projectId===p.id?'selected':''}>${p.name}</option>`).join('')}
          </select>
        </label>
        <label>묶음
          <select id="epGroup" ${canFull?'':'disabled'}>
            <option value="">없음</option>
            ${groups.map(g => `<option value="${g.id}" ${n.groupId===g.id?'selected':''}>${g.name}</option>`).join('')}
          </select>
        </label>
        <label>담당자
          <select id="epAssignee" ${canFull?'':'disabled'}>
            <option value="">미배정</option>
            ${(appData.members||[]).map(m => `<option ${n.assignee===m?'selected':''}>${m}</option>`).join('')}
          </select>
        </label>
        <label>상태
          <select id="epStatus" ${canMemo?'':'disabled'}>
            ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${n.status===k?'selected':''}>${v.label}</option>`).join('')}
          </select>
        </label>
        <label>마감일
          <input type="date" id="epDue" value="${n.dueDate||''}" ${canFull?'':'disabled'}>
        </label>
        <label>메모
          <textarea id="epMemo" rows="4" ${canMemo?'':'disabled'}>${n.memo||''}</textarea>
        </label>
        ${canFull ? `
          <div class="ep-actions">
            <button class="ep-save" id="epSave">저장</button>
            <button class="ep-del" id="epDel">삭제</button>
          </div>
        ` : `
          <div class="ep-actions">
            <button class="ep-save" id="epSaveMemo">메모 저장</button>
          </div>
        `}
      </div>
    `;

    if (canFull) {
      document.getElementById('epSave').addEventListener('click', () => saveTaskFull(id));
      document.getElementById('epDel').addEventListener('click', () => deleteNode(id));
    } else if (canMemo) {
      document.getElementById('epSaveMemo').addEventListener('click', () => saveMemo(id));
    }

  } else {
    // Project / Group edit (admin only)
    if (!isAdmin) { closeEditPanel(); return; }

    const isProject = n.type === 'project';
    panel.innerHTML = `
      <div class="ep-header">
        <span class="ep-title">${isProject ? '프로젝트' : '묶음'} 편집</span>
        <button class="ep-close" id="epClose">✕</button>
      </div>
      <div class="ep-body">
        <label>이름
          <input id="epName" value="${_esc(n.name)}">
        </label>
        ${!isProject ? `
          <label>프로젝트
            <select id="epProject">
              <option value="">없음</option>
              ${projects.map(p=>`<option value="${p.id}" ${n.projectId===p.id?'selected':''}>${p.name}</option>`).join('')}
            </select>
          </label>
        ` : ''}
        <label>색상
          <input type="color" id="epColor" value="${n.color||'#374151'}">
        </label>
        <div class="ep-actions">
          <button class="ep-save" id="epSave">저장</button>
          <button class="ep-del" id="epDel">삭제</button>
        </div>
      </div>
    `;

    document.getElementById('epSave').addEventListener('click', () => saveContainer(id));
    document.getElementById('epDel').addEventListener('click', () => deleteNode(id));
  }

  document.getElementById('epClose').addEventListener('click', closeEditPanel);
}

function closeEditPanel() {
  document.getElementById('editPanel').style.display = 'none';
  editingId = null;
}

async function saveTaskFull(id) {
  const n = appData.nodes[id];
  n.name      = document.getElementById('epName').value.trim() || n.name;
  n.projectId = document.getElementById('epProject').value || null;
  n.groupId   = document.getElementById('epGroup').value   || null;
  n.assignee  = document.getElementById('epAssignee').value || '';
  n.status    = document.getElementById('epStatus').value;
  n.dueDate   = document.getElementById('epDue').value || null;
  n.memo      = document.getElementById('epMemo').value;
  await saveData();
  graph.render();
  renderStatusBar();
  renderSidebarProjects();
  logActivity(`업무 편집: ${n.name}`, _projectName(n.projectId), id);
}

async function saveMemo(id) {
  const memo   = document.getElementById('epMemo')?.value ?? '';
  const status = document.getElementById('epStatus')?.value;
  try {
    await api.patch('/api/data/task-status', { taskId: id, memo, status });
    appData.nodes[id].memo   = memo;
    appData.nodes[id].status = status;
    graph.render();
    renderStatusBar();
  } catch (err) {
    alert(err.message);
  }
}

async function saveContainer(id) {
  const n = appData.nodes[id];
  n.name  = document.getElementById('epName').value.trim() || n.name;
  n.color = document.getElementById('epColor').value;
  if (n.type === 'group') {
    n.projectId = document.getElementById('epProject')?.value || null;
  }
  await saveData();
  graph.render();
  renderSidebarProjects();
}

async function deleteNode(id) {
  const n = appData.nodes[id];
  if (!confirm(`"${n.name}"을(를) 삭제할까요?`)) return;

  delete appData.nodes[id];
  // Remove connected edges
  appData.edges = appData.edges.filter(e => e.from !== id && e.to !== id);
  // Remove child nodes if project/group deleted
  if (n.type === 'project') {
    for (const [nid, node] of Object.entries(appData.nodes)) {
      if (node.projectId === id) delete appData.nodes[nid];
    }
    appData.edges = appData.edges.filter(e =>
      appData.nodes[e.from] && appData.nodes[e.to]
    );
  }

  await saveData();
  closeEditPanel();
  graph.render();
  renderStatusBar();
  renderSidebarProjects();
  logActivity(`삭제: ${n.name}`, null, null);
}

// ─── Modal (Add nodes) ────────────────────────────────────────────────────────

function openModal(type) {
  const overlay = document.getElementById('modalOverlay');
  const modal   = document.getElementById('modal');
  const projects = Object.values(appData.nodes).filter(n => n.type === 'project');
  const groups   = Object.values(appData.nodes).filter(n => n.type === 'group');
  const members  = appData.members || [];

  let html = '';
  if (type === 'project') {
    html = `
      <h3>새 프로젝트</h3>
      <label>프로젝트명 <input id="mName" placeholder="이름" autofocus></label>
      <label>색상 <input type="color" id="mColor" value="#374151"></label>
      <div class="modal-btns">
        <button id="mConfirm" class="ep-save">추가</button>
        <button id="mCancel" class="ep-del">취소</button>
      </div>
    `;
  } else if (type === 'group') {
    html = `
      <h3>새 묶음</h3>
      <label>묶음명 <input id="mName" placeholder="이름" autofocus></label>
      <label>프로젝트
        <select id="mProject">
          <option value="">없음</option>
          ${projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </label>
      <label>색상 <input type="color" id="mColor" value="#7C3AED"></label>
      <div class="modal-btns">
        <button id="mConfirm" class="ep-save">추가</button>
        <button id="mCancel" class="ep-del">취소</button>
      </div>
    `;
  } else if (type === 'task') {
    html = `
      <h3>새 업무</h3>
      <label>업무명 <input id="mName" placeholder="이름" autofocus></label>
      <label>프로젝트
        <select id="mProject">
          <option value="">없음</option>
          ${projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </label>
      <label>묶음
        <select id="mGroup">
          <option value="">없음</option>
          ${groups.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
        </select>
      </label>
      <label>담당자
        <select id="mAssignee">
          <option value="">미배정</option>
          ${members.map(m=>`<option>${m}</option>`).join('')}
        </select>
      </label>
      <label>상태
        <select id="mStatus">
          ${Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
        </select>
      </label>
      <label>마감일 <input type="date" id="mDue"></label>
      <div class="modal-btns">
        <button id="mConfirm" class="ep-save">추가</button>
        <button id="mCancel" class="ep-del">취소</button>
      </div>
    `;
  }

  modal.innerHTML = html;
  overlay.style.display = 'flex';

  document.getElementById('mCancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.getElementById('mConfirm').addEventListener('click', () => confirmAdd(type));
  document.getElementById('mName').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

async function confirmAdd(type) {
  const name = document.getElementById('mName').value.trim();
  if (!name) { alert('이름을 입력하세요.'); return; }

  const id  = `${type}_${Date.now()}`;
  const vp  = graph.vp;
  // Place in visible center
  const cx  = (graph.container.clientWidth  / 2 - vp.x) / vp.scale;
  const cy  = (graph.container.clientHeight / 2 - vp.y) / vp.scale;

  if (type === 'project') {
    appData.nodes[id] = {
      id, type: 'project', name,
      color:  document.getElementById('mColor').value,
      x: cx - 350, y: cy - 230,
      width: 700, height: 460,
    };
  } else if (type === 'group') {
    appData.nodes[id] = {
      id, type: 'group', name,
      projectId: document.getElementById('mProject').value || null,
      color:     document.getElementById('mColor').value,
      x: cx - 190, y: cy - 140,
      width: 380, height: 280,
    };
  } else {
    appData.nodes[id] = {
      id, type: 'task', name,
      projectId: document.getElementById('mProject').value || null,
      groupId:   document.getElementById('mGroup').value   || null,
      assignee:  document.getElementById('mAssignee').value || '',
      status:    document.getElementById('mStatus').value,
      dueDate:   document.getElementById('mDue').value || null,
      memo: '',
      x: cx - 100, y: cy - 65,
    };
  }

  closeModal();
  await saveData();
  graph.render();
  renderStatusBar();
  renderSidebarProjects();

  // Animate to new node
  setTimeout(() => {
    graph.animateTo(id);
    graph.highlightNode(id);
  }, 100);

  logActivity(
    `추가: ${name}`,
    appData.nodes[id].projectId ? _projectName(appData.nodes[id].projectId) : null,
    type === 'task' ? id : null
  );
}

// ─── Mobile tabs ─────────────────────────────────────────────────────────────

function setupMobileTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));

      document.getElementById('canvas').style.display      = activeTab === 'graph'    ? 'block' : 'none';
      document.getElementById('mobileStatus').style.display = activeTab === 'status'  ? 'block' : 'none';
      document.getElementById('mobileActivity').style.display = activeTab === 'activity' ? 'block' : 'none';
      document.getElementById('mobileSidebar').style.display  = activeTab === 'menu'   ? 'block' : 'none';
    });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _projectName(projectId) {
  return projectId ? appData.nodes[projectId]?.name ?? null : null;
}

function _timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60)   return '방금 전';
  if (diff < 3600) return `${Math.floor(diff/60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff/3600)}시간 전`;
  return `${Math.floor(diff/86400)}일 전`;
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function grid4x4() {
  const cells = [];
  const s = 5, g = 1;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 1 + c * (s + g);
      const y = 1 + r * (s + g);
      const op = (r === 1 || r === 2) && (c === 1 || c === 2) ? '0.45' : '1';
      cells.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="1" fill="#0D9488" opacity="${op}"/>`);
    }
  }
  return cells.join('');
}
