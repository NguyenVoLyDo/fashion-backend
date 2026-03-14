import pg from 'pg';

const { Client } = pg;
const connectionString = 'postgresql://postgres:zqCPYwElkodlOmkUoJhowbmLQZtwdrcT@metro.proxy.rlwy.net:42822/railway';

async function verify() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to remote database for verification');

    // Check users table columns
    const { rows: userCols } = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name IN ('gender', 'birth_year', 'avatar_url');
    `);
    console.log('Columns found in users table:', userCols.map(r => r.column_name));

    // Check addresses table
    const { rows: tableExists } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'addresses'
      );
    `);
    console.log('Addresses table exists:', tableExists[0].exists);

  } catch (err) {
    console.error('Verification failed:', err);
  } finally {
    await client.end();
  }
}

verify();
