import { Router } from 'express';
import pool from '../db.js';
import { auth } from './auth.js';

const router = Router();

// GET /api/activity
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 30'
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/activity
router.post('/', auth, async (req, res) => {
  try {
    const { msg, projectName, taskId } = req.body;
    if (!msg) return res.status(400).json({ error: 'msg required' });

    const result = await pool.query(
      'INSERT INTO activity_log (msg, project_name, user_name, task_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [msg, projectName || null, req.user.name, taskId || null]
    );

    const io = req.app.get('io');
    io.emit('activity:new', result.rows[0]);

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
