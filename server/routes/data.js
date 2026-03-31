import { Router } from 'express';
import pool from '../db.js';
import { auth, adminOnly } from './auth.js';

const router = Router();

// GET /api/data
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT data FROM workflow_data ORDER BY id LIMIT 1'
    );
    if (result.rows.length === 0) {
      return res.json({ nodes: {}, edges: [], members: [] });
    }
    res.json(result.rows[0].data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/data  (admin: full save)
router.put('/', auth, adminOnly, async (req, res) => {
  try {
    const io = req.app.get('io');
    const data = req.body;

    const existing = await pool.query('SELECT id FROM workflow_data ORDER BY id LIMIT 1');
    if (existing.rows.length === 0) {
      await pool.query('INSERT INTO workflow_data (data) VALUES ($1)', [JSON.stringify(data)]);
    } else {
      await pool.query(
        'UPDATE workflow_data SET data = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(data), existing.rows[0].id]
      );
    }

    // Broadcast to all connected clients
    io.emit('data:updated', data);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/data/task-status  (member: status + memo only)
router.patch('/task-status', auth, async (req, res) => {
  try {
    const io = req.app.get('io');
    const { taskId, status, memo } = req.body;

    if (!taskId) return res.status(400).json({ error: 'taskId required' });

    const result = await pool.query(
      'SELECT id, data FROM workflow_data ORDER BY id LIMIT 1'
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '데이터가 없습니다.' });
    }

    const row = result.rows[0];
    const data = row.data;

    if (!data.nodes[taskId] || data.nodes[taskId].type !== 'task') {
      return res.status(404).json({ error: '업무를 찾을 수 없습니다.' });
    }

    const task = data.nodes[taskId];

    // Members can only edit their own tasks
    if (req.user.role !== 'admin' && task.assignee !== req.user.name) {
      return res.status(403).json({ error: '담당자만 상태를 변경할 수 있습니다.' });
    }

    if (status !== undefined) task.status = status;
    if (memo !== undefined) task.memo = memo;

    await pool.query(
      'UPDATE workflow_data SET data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(data), row.id]
    );

    io.emit('data:updated', data);
    res.json({ ok: true, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
