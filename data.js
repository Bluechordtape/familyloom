// data.js — API client + Socket.io helpers

let _token = localStorage.getItem('fl_token');

export function setToken(t) {
  _token = t;
  if (t) localStorage.setItem('fl_token', t);
  else localStorage.removeItem('fl_token');
}

export function getToken() {
  return _token;
}

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (_token) opts.headers['Authorization'] = `Bearer ${_token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get:    (p)    => req('GET',    p),
  post:   (p, b) => req('POST',   p, b),
  put:    (p, b) => req('PUT',    p, b),
  patch:  (p, b) => req('PATCH',  p, b),
  delete: (p)    => req('DELETE', p),
};

// Debounce viewport saves (500ms)
let _vpTimer = null;
export function saveViewport(vp) {
  clearTimeout(_vpTimer);
  _vpTimer = setTimeout(() => {
    api.put('/api/viewport', vp).catch(() => {});
  }, 500);
}

export function initSocket(handlers = {}) {
  const socket = window.io();

  if (handlers.onData)     socket.on('data:updated',  handlers.onData);
  if (handlers.onActivity) socket.on('activity:new',  handlers.onActivity);
  if (handlers.onUsers)    socket.on('users:online',  handlers.onUsers);

  return socket;
}
