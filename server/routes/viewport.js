import { Router } from 'express';
import pool from '../db.js';
import { auth } from './auth.js';

const router = Router();

// GET /api/viewport
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM user_viewports WHERE user_id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.json({ offsetX: 0, offsetY: 60, scale: 1 });
    }
    const vp = result.rows[0];
    res.json({ offsetX: vp.offset_x, offsetY: vp.offset_y, scale: vp.scale });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/viewport
router.put('/', auth, async (req, res) => {
  try {
    const { offsetX, offsetY, scale } = req.body;
    await pool.query(
      `INSERT INTO user_viewports (user_id, offset_x, offset_y, scale, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET offset_x = $2, offset_y = $3, scale = $4, updated_at = NOW()`,
      [req.user.id, offsetX, offsetY, scale]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
