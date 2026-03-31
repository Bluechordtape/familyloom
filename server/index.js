import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pool, { initDB } from './db.js';
import authRouter from './routes/auth.js';
import dataRouter from './routes/data.js';
import viewportRouter from './routes/viewport.js';
import activityRouter from './routes/activity.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Share io instance with route handlers
app.set('io', io);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(ROOT));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/data', dataRouter);
app.use('/api/viewport', viewportRouter);
app.use('/api/activity', activityRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(join(ROOT, 'index.html'));
  }
});

// ─── Socket.io ───────────────────────────────────────────────────────────────

const onlineUsers = new Map(); // socketId → { id, name }

io.on('connection', (socket) => {
  socket.on('user:join', (user) => {
    onlineUsers.set(socket.id, { id: user.id, name: user.name });
    io.emit('users:online', [...onlineUsers.values()]);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('users:online', [...onlineUsers.values()]);
  });
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function createDefaults() {
  // Default admin account
  const adminHash = await bcrypt.hash('admin1234!', 10);
  const adminRes = await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ('user_admin', '관리자', 'admin@familyloom.app', $1, 'admin')
     ON CONFLICT (id) DO NOTHING
     RETURNING name`,
    [adminHash]
  );
  if (adminRes.rowCount > 0) console.log('[Init] 기본 계정 생성:', adminRes.rows[0].name);

  // Default member account
  const memberHash = await bcrypt.hash('member1234', 10);
  const memberRes = await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ('user_member', '홍길동', 'member@familyloom.app', $1, 'member')
     ON CONFLICT (id) DO NOTHING
     RETURNING name`,
    [memberHash]
  );
  if (memberRes.rowCount > 0) console.log('[Init] 기본 계정 생성:', memberRes.rows[0].name);

  // Initial empty workflow data
  const existing = await pool.query('SELECT id FROM workflow_data LIMIT 1');
  if (existing.rows.length === 0) {
    const initial = {
      nodes: {},
      edges: [],
      members: ['관리자', '홍길동'],
    };
    await pool.query('INSERT INTO workflow_data (data) VALUES ($1)', [
      JSON.stringify(initial),
    ]);
    console.log('Created initial workflow data');
  }
}

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initDB();
    await createDefaults();
    httpServer.listen(PORT, () => {
      console.log(`\nFamily Loom running → http://localhost:${PORT}`);
      console.log('  admin@familyloom.app / admin1234!');
      console.log('  member@familyloom.app / member1234\n');
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

start();
