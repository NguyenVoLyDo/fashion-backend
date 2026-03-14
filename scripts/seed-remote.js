import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;
const connectionString = 'postgresql://postgres:zqCPYwElkodlOmkUoJhowbmLQZtwdrcT@metro.proxy.rlwy.net:42822/railway';

async function runSeeds() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to remote database for seeding');

    const seeds = ['../sql/seeds/010_more_products.sql', '../sql/seeds/011_diverse_products.sql'];
    
    for (const seedFile of seeds) {
      const seedPath = path.join(__dirname, seedFile);
      if (fs.existsSync(seedPath)) {
        console.log(`Running ${seedFile}...`);
        const sql = fs.readFileSync(seedPath, 'utf8');
        await client.query(sql);
        console.log(`${seedFile} executed successfully`);
      }
    }

    console.log('Seeding completed successfully!');
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSeeds();
