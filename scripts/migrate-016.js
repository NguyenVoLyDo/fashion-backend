import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;
const connectionString = 'postgresql://postgres:zqCPYwElkodlOmkUoJhowbmLQZtwdrcT@metro.proxy.rlwy.net:42822/railway';

async function migrate() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to remote database');

    const sqlPath = path.join(__dirname, '../sql/migrations/016_context_feedback.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Running migration 016...');
    await client.query(sql);
    console.log('016_context_feedback.sql executed successfully');
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

migrate();
