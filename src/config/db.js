import pg from 'pg';
import { DATABASE_URL } from './env.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Log on first successful connection
pool.query('SELECT 1').then(() => {
  console.log('Database connected');
}).catch((err) => {
  console.error('Database connection failed:', err.message);
  process.exit(1);
});

export default pool;
