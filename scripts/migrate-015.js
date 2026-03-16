import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;
const connectionString = 'postgresql://postgres:zqCPYwElkodlOmkUoJhowbmLQZtwdrcT@metro.proxy.rlwy.net:42822/railway';

async function runSpecificMigration() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to remote database');

    const migrationPath = path.join(__dirname, '../sql/migrations/015_conversation_context.sql');
    console.log('Running migration: 015_conversation_context.sql...');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await client.query(sql);
    console.log('015_conversation_context.sql executed successfully');

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

runSpecificMigration();
