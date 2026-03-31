import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_data (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_viewports (
        user_id TEXT PRIMARY KEY,
        offset_x FLOAT DEFAULT 0,
        offset_y FLOAT DEFAULT 0,
        scale FLOAT DEFAULT 1,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        msg TEXT NOT NULL,
        project_name TEXT,
        user_name TEXT,
        task_id TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('DB initialized');
  } finally {
    client.release();
  }
}

export default pool;
