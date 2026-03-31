// graph.js — SVG + HTML hybrid graph engine

export const STATUS = {
  pending: { label: '착수전',   color: '#6B7280' },
  doing:   { label: '진행 중',  color: '#7C3AED' },
  delayed: { label: '지연',     color: '#EF4444' },
  review:  { label: '완료요청', color: '#EAB308' },
  done:    { label: '완료',     color: '#22C55E' },
};

const NODE_W = 204;   // task card width
const NODE_H = 130;   // task card approx height

export class Graph {
  constructor(container, opts = {}) {
    this.container = container;
    this.user = opts.user || null;
    this.data = { nodes: {}, edges: [], members: [] };
    this.vp = { x: 0, y: 0, scale: 1 };

    // Filters
    this.filterAssignee = '';
    this.filterStatus   = '';

    // Interaction state
    this._dragging   = null;
    this._panning    = null;
    this._connecting = null;

    // Callbacks
    this.onNodeMove      = null;
    this.onConnect       = null;
    this.onEdgeRemove    = null;
    this.onNodeClick     = null;
    this.onStatusChange  = null;
    this.onViewportChange = null;

    this._build();
    this._bindPanZoom();
    this._applyVP();
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  _build() {
    this.world = document.createElement('div');
    this.world.id = 'graphWorld';
    this.world.style.cssText =
      'position:absolute;top:0;left:0;width:0;height:0;transform-origin:0 0;';

    // SVG layer for edges (behind nodes)
    const svgNS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(svgNS, 'svg');
    this.svg.style.cssText =
      'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;';
    this.svg.setAttribute('width', '1');
    this.svg.setAttribute('height', '1');
    this.svg.innerHTML = `
      <defs>
        <marker id="arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#9CA3AF"/>
        </marker>
        <marker id="arr-hover" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#EF4444"/>
        </marker>
      </defs>
      <g id="edgeLayer"></g>
    `;

    this.world.appendChild(this.svg);
    this.container.appendChild(this.world);
  }

  _applyVP() {
    this.world.style.transform =
      `translate(${this.vp.x}px,${this.vp.y}px) scale(${this.vp.scale})`;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  setUser(user) {
    this.user = user;
  }

  setViewport(x, y, scale) {
    this.vp = { x, y, scale };
    this._applyVP();
  }

  setFilter(assignee, status) {
    this.filterAssignee = assignee;
    this.filterStatus   = status;
    this._applyFilters();
  }

  setData(data) {
    this.data = data;
    this.render();
  }

  render() {
    // Remove existing node elements only
    this.world.querySelectorAll('.gn').forEach(el => el.remove());

    const { nodes } = this.data;
    const projects = [];
    const groups   = [];
    const tasks    = [];

    for (const n of Object.values(nodes)) {
      if (n.type === 'project') projects.push(n);
      else if (n.type === 'group') groups.push(n);
      else tasks.push(n);
    }

    // Render back→front
    projects.forEach(n => this._renderProject(n));
    groups.forEach(n   => this._renderGroup(n));
    tasks.forEach(n    => this._renderTask(n));
    this._renderEdges();
    this._applyFilters();
  }

  // ─── Node Renderers ───────────────────────────────────────────────────────

  _renderProject(n) {
    const el = document.createElement('div');
    el.className = 'gn project-node';
    el.dataset.id = n.id;
    const w = n.width  || 700;
    const h = n.height || 460;
    el.style.cssText = `
      position:absolute;
      left:${n.x}px; top:${n.y}px;
      width:${w}px; min-height:${h}px;
      border:2px solid ${n.color || '#374151'};
      border-radius:14px;
      background:rgba(255,255,255,0.04);
    `;
    el.innerHTML = `
      <div class="proj-header" data-id="${n.id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span>${_esc(n.name)}</span>
        ${this.user?.role === 'admin' ? `<button class="node-edit-btn" data-id="${n.id}" title="편집">✏️</button>` : ''}
      </div>
      ${this.user?.role === 'admin' ? `<div class="resize-handle" data-id="${n.id}" title="크기 조절"></div>` : ''}
    `;

    if (this.user?.role === 'admin') {
      this._bindDrag(el, n, '.proj-header');
      this._bindResize(el, n);
      el.querySelector('.node-edit-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        if (this.onNodeClick) this.onNodeClick(n.id);
      });
    }

    this.world.appendChild(el);
  }

  _renderGroup(n) {
    const el = document.createElement('div');
    el.className = 'gn group-node';
    el.dataset.id = n.id;
    const w = n.width  || 380;
    const h = n.height || 280;
    const c = n.color || '#6B7280';
    el.style.cssText = `
      position:absolute;
      left:${n.x}px; top:${n.y}px;
      width:${w}px; min-height:${h}px;
      border:2px dashed ${c};
      border-radius:10px;
      background:${c}12;
    `;
    el.innerHTML = `
      <div class="group-header" data-id="${n.id}" style="color:${c}">
        <span>${_esc(n.name)}</span>
        ${this.user?.role === 'admin' ? `<button class="node-edit-btn" data-id="${n.id}" title="편집">✏️</button>` : ''}
      </div>
      ${this.user?.role === 'admin' ? `<div class="resize-handle" data-id="${n.id}" title="크기 조절"></div>` : ''}
    `;

    if (this.user?.role === 'admin') {
      this._bindDrag(el, n, '.group-header');
      this._bindResize(el, n);
      el.querySelector('.node-edit-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        if (this.onNodeClick) this.onNodeClick(n.id);
      });
    }

    this.world.appendChild(el);
  }

  _renderTask(n) {
    const st = STATUS[n.status] || STATUS.pending;
    const dday = _dday(n.dueDate);
    const isAdmin = this.user?.role === 'admin';
    const isMine  = this.user?.name === n.assignee;
    const canAct  = isAdmin || isMine;
    const actionHtml = canAct ? this._actionBtn(n) : '';

    const el = document.createElement('div');
    el.className = 'gn task-node';
    el.dataset.id = n.id;
    el.style.cssText = `
      position:absolute;
      left:${n.x}px; top:${n.y}px;
      width:${NODE_W}px;
      border-left:4px solid ${st.color};
    `;
    el.innerHTML = `
      <div class="task-top">
        <span class="task-name">${_esc(n.name)}</span>
        <span class="status-badge" style="background:${st.color}22;color:${st.color}">${st.label}</span>
      </div>
      <div class="task-meta">
        <span class="task-assignee">${_esc(n.assignee || '미배정')}</span>
        ${dday ? `<span class="dday ${dday.cls}">${dday.text}</span>` : ''}
      </div>
      ${actionHtml ? `<div class="task-actions">${actionHtml}</div>` : ''}
      ${isAdmin ? `<div class="conn-handle" data-id="${n.id}" title="연결"></div>` : ''}
    `;

    // Click → open edit panel
    el.addEventListener('click', e => {
      if (e.target.closest('.conn-handle,.task-act-btn')) return;
      if (this.onNodeClick) this.onNodeClick(n.id);
    });

    // Action button
    const btn = el.querySelector('.task-act-btn');
    if (btn) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (this.onStatusChange) this.onStatusChange(n.id, btn.dataset.to);
      });
    }

    // Connection handle (admin only)
    const handle = el.querySelector('.conn-handle');
    if (handle) {
      handle.addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        this._startConnect(n.id, e);
      });
    }

    if (isAdmin) this._bindDrag(el, n, '.task-top');

    this.world.appendChild(el);
  }

  _actionBtn(n) {
    const isAdmin = this.user?.role === 'admin';
    if (n.status === 'pending' || n.status === 'delayed') {
      return `<button class="task-act-btn start" data-to="doing">시작</button>`;
    }
    if (n.status === 'doing') {
      return `<button class="task-act-btn request" data-to="review">완료요청</button>`;
    }
    if (n.status === 'review' && isAdmin) {
      return `<button class="task-act-btn confirm" data-to="done">완료확정</button>`;
    }
    return '';
  }

  // ─── Edge Renderer ────────────────────────────────────────────────────────

  _renderEdges() {
    const layer = this.svg.querySelector('#edgeLayer');
    layer.innerHTML = '';

    for (const edge of this.data.edges) {
      const a = this.data.nodes[edge.from];
      const b = this.data.nodes[edge.to];
      if (!a || !b) continue;

      const x1 = a.x + _nw(a);
      const y1 = a.y + _nh(a) / 2;
      const x2 = b.x;
      const y2 = b.y + _nh(b) / 2;
      const cx = (x2 - x1) / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} C${x1+cx},${y1} ${x2-cx},${y2} ${x2},${y2}`);
      path.setAttribute('stroke', '#9CA3AF');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#arr)');
      path.dataset.from = edge.from;
      path.dataset.to   = edge.to;
      path.style.pointerEvents = 'stroke';
      path.style.cursor = 'pointer';

      if (this.user?.role === 'admin') {
        path.addEventListener('mouseenter', () => {
          path.setAttribute('stroke', '#EF4444');
          path.setAttribute('stroke-width', '2.5');
          path.setAttribute('marker-end', 'url(#arr-hover)');
        });
        path.addEventListener('mouseleave', () => {
          path.setAttribute('stroke', '#9CA3AF');
          path.setAttribute('stroke-width', '1.5');
          path.setAttribute('marker-end', 'url(#arr)');
        });
        path.addEventListener('click', () => {
          if (confirm('연결선을 삭제할까요?')) {
            if (this.onEdgeRemove) this.onEdgeRemove(edge.from, edge.to);
          }
        });
      }

      layer.appendChild(path);
    }
  }

  // ─── Filters ──────────────────────────────────────────────────────────────

  _applyFilters() {
    this.world.querySelectorAll('.gn').forEach(el => {
      const id = el.dataset.id;
      const n  = this.data.nodes[id];
      if (!n || n.type !== 'task') { el.style.opacity = '1'; return; }

      const matchA = !this.filterAssignee || n.assignee === this.filterAssignee;
      const matchS = !this.filterStatus   || n.status   === this.filterStatus;
      el.style.opacity = (matchA && matchS) ? '1' : '0.2';
    });
  }

  // ─── Drag ────────────────────────────────────────────────────────────────

  _bindDrag(el, node, handleSel) {
    const handle = handleSel ? el.querySelector(handleSel) : el;
    if (!handle) return;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      this._dragging = {
        node, el,
        sx: e.clientX, sy: e.clientY,
        nx: node.x, ny: node.y,
      };
      handle.style.cursor = 'grabbing';
    });
  }

  _bindResize(el, node) {
    const handle = el.querySelector('.resize-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();

      const startW = node.width  || 700;
      const startH = node.height || 460;
      const sx = e.clientX, sy = e.clientY;

      const onMove = mv => {
        const dx = (mv.clientX - sx) / this.vp.scale;
        const dy = (mv.clientY - sy) / this.vp.scale;
        node.width  = Math.max(280, startW + dx);
        node.height = Math.max(180, startH + dy);
        el.style.width    = `${node.width}px`;
        el.style.minHeight = `${node.height}px`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        if (this.onNodeMove) this.onNodeMove(node.id, node.x, node.y, node.width, node.height);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ─── Connect ──────────────────────────────────────────────────────────────

  _startConnect(fromId, e) {
    const node = this.data.nodes[fromId];
    const x1   = node.x + NODE_W;
    const y1   = node.y + NODE_H / 2;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x1); line.setAttribute('y2', y1);
    line.setAttribute('stroke', '#0D9488');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6 4');
    this.svg.querySelector('#edgeLayer').appendChild(line);

    this._connecting = { fromId, line };
  }

  // ─── Pan / Zoom ───────────────────────────────────────────────────────────

  _bindPanZoom() {
    const c = this.container;

    c.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      this._panning = { sx: e.clientX, sy: e.clientY, ox: this.vp.x, oy: this.vp.y };
      c.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', e => {
      // Drag node
      if (this._dragging) {
        const dx = (e.clientX - this._dragging.sx) / this.vp.scale;
        const dy = (e.clientY - this._dragging.sy) / this.vp.scale;
        const nx = this._dragging.nx + dx;
        const ny = this._dragging.ny + dy;
        this._dragging.node.x = nx;
        this._dragging.node.y = ny;
        this._dragging.el.style.left = `${nx}px`;
        this._dragging.el.style.top  = `${ny}px`;
        this._renderEdges();
        return;
      }

      // Draw connect line
      if (this._connecting) {
        const rect = c.getBoundingClientRect();
        const wx = (e.clientX - rect.left - this.vp.x) / this.vp.scale;
        const wy = (e.clientY - rect.top  - this.vp.y) / this.vp.scale;
        this._connecting.line.setAttribute('x2', wx);
        this._connecting.line.setAttribute('y2', wy);
        return;
      }

      // Pan canvas
      if (this._panning) {
        this.vp.x = this._panning.ox + (e.clientX - this._panning.sx);
        this.vp.y = this._panning.oy + (e.clientY - this._panning.sy);
        this._applyVP();
      }
    });

    document.addEventListener('mouseup', e => {
      if (this._dragging) {
        const n = this._dragging.node;
        if (this.onNodeMove) this.onNodeMove(n.id, n.x, n.y, n.width, n.height);
        this._dragging = null;
        return;
      }

      if (this._connecting) {
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gn[data-id]');
        if (target && target.dataset.id !== this._connecting.fromId) {
          if (this.onConnect) this.onConnect(this._connecting.fromId, target.dataset.id);
        }
        this._connecting.line.remove();
        this._connecting = null;
        return;
      }

      if (this._panning) {
        if (this.onViewportChange) this.onViewportChange({ ...this.vp });
        this._panning = null;
        c.style.cursor = 'default';
      }
    });

    // Wheel zoom
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx   = e.clientX - rect.left;
      const my   = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const ns   = Math.min(3, Math.max(0.15, this.vp.scale * factor));
      const wx   = (mx - this.vp.x) / this.vp.scale;
      const wy   = (my - this.vp.y) / this.vp.scale;
      this.vp.x  = mx - wx * ns;
      this.vp.y  = my - wy * ns;
      this.vp.scale = ns;
      this._applyVP();
      if (this.onViewportChange) this.onViewportChange({ ...this.vp });
    }, { passive: false });

    // Touch: pan + pinch zoom
    let _touches = null;
    let _dist    = null;

    c.addEventListener('touchstart', e => {
      _touches = [...e.touches];
      if (e.touches.length === 2) {
        _dist = _touchDist(e.touches);
      }
    }, { passive: true });

    c.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && _dist) {
        e.preventDefault();
        const nd  = _touchDist(e.touches);
        const fac = nd / _dist;
        _dist = nd;

        const cx  = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy  = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = c.getBoundingClientRect();
        const mx  = cx - rect.left;
        const my  = cy - rect.top;

        const ns  = Math.min(3, Math.max(0.15, this.vp.scale * fac));
        const wx  = (mx - this.vp.x) / this.vp.scale;
        const wy  = (my - this.vp.y) / this.vp.scale;
        this.vp.x = mx - wx * ns;
        this.vp.y = my - wy * ns;
        this.vp.scale = ns;
        this._applyVP();
      } else if (e.touches.length === 1 && _touches?.length === 1) {
        const dx = e.touches[0].clientX - _touches[0].clientX;
        const dy = e.touches[0].clientY - _touches[0].clientY;
        this.vp.x += dx;
        this.vp.y += dy;
        this._applyVP();
        _touches = [...e.touches];
      }
    }, { passive: false });

    c.addEventListener('touchend', () => {
      _touches = null;
      _dist    = null;
      if (this.onViewportChange) this.onViewportChange({ ...this.vp });
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  fitToView() {
    const ns = Object.values(this.data.nodes);
    if (!ns.length) {
      this.vp = { x: 40, y: 60, scale: 1 };
      this._applyVP();
      return;
    }

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + _nw(n));
      y1 = Math.max(y1, n.y + _nh(n));
    }

    const pad = 80;
    const cw  = this.container.clientWidth;
    const ch  = this.container.clientHeight;
    const sc  = Math.min(1, Math.min(cw / (x1 - x0 + pad * 2), ch / (y1 - y0 + pad * 2)));

    this.vp = {
      x: (cw - (x0 + x1) * sc) / 2,
      y: (ch - (y0 + y1) * sc) / 2,
      scale: sc,
    };
    this._applyVP();
  }

  animateTo(nodeId) {
    const n = this.data.nodes[nodeId];
    if (!n) return;

    const cw  = this.container.clientWidth;
    const ch  = this.container.clientHeight;
    const tx  = cw / 2 - (n.x + _nw(n) / 2) * this.vp.scale;
    const ty  = ch / 2 - (n.y + _nh(n) / 2) * this.vp.scale;
    const sx  = this.vp.x, sy = this.vp.y;
    const t0  = performance.now();
    const dur = 500;

    const tick = now => {
      const p   = Math.min((now - t0) / dur, 1);
      const ep  = 1 - Math.pow(1 - p, 3);
      this.vp.x = sx + (tx - sx) * ep;
      this.vp.y = sy + (ty - sy) * ep;
      this._applyVP();
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  highlightNode(nodeId) {
    this.world.querySelectorAll('.gn').forEach(el => el.classList.remove('gn-highlight'));
    const el = this.world.querySelector(`.gn[data-id="${nodeId}"]`);
    if (el) {
      el.classList.add('gn-highlight');
      setTimeout(() => el.classList.remove('gn-highlight'), 2000);
    }
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _nw(n) {
  if (n.type === 'task') return NODE_W;
  return n.width || 700;
}

function _nh(n) {
  if (n.type === 'task') return NODE_H;
  return n.height || 460;
}

function _dday(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(dateStr); due.setHours(0, 0, 0, 0);
  const diff  = Math.round((due - today) / 86400000);
  if (diff === 0) return { text: 'D-day', cls: 'dday-today' };
  if (diff > 0)   return { text: `D-${diff}`, cls: diff <= 3 ? 'dday-urgent' : 'dday-ok' };
  return { text: `D+${Math.abs(diff)}`, cls: 'dday-over' };
}

function _touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
