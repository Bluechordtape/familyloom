import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'familyloom_secret_key_2026';

// ─── Middleware ───────────────────────────────────────────────────────────────

export function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  next();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요.' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, inviteCode } = req.body;
    const expectedCode = process.env.INVITE_CODE || 'familyloom2026';

    if (inviteCode !== expectedCode) {
      return res.status(400).json({ error: '초대 코드가 올바르지 않습니다.' });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ error: '모든 항목을 입력하세요.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const id = 'user_' + Date.now();

    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
      [id, name, email, hash, 'member']
    );

    // Add new member to workflow data members list
    const dataResult = await pool.query(
      'SELECT id, data FROM workflow_data ORDER BY id LIMIT 1'
    );
    if (dataResult.rows.length > 0) {
      const row = dataResult.rows[0];
      const data = row.data;
      if (!data.members.includes(name)) {
        data.members.push(name);
        await pool.query(
          'UPDATE workflow_data SET data = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(data), row.id]
        );
      }
    }

    const token = jwt.sign(
      { id, name, role: 'member', email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id, name, role: 'member', email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  res.json(req.user);
});

// GET /api/auth/users  (admin)
router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY created_at'
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/auth/users/:id  (admin)
router.delete('/users/:id', auth, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: '자신의 계정은 삭제할 수 없습니다.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
