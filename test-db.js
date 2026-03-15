import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres:zqCPYwElkodlOmkUoJhowbmLQZtwdrcT@metro.proxy.rlwy.net:42822/railway' });

async function run() {
  await client.connect();
  const res = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='order_items'`);
  console.log(JSON.stringify(res.rows.map(r => r.column_name), null, 2));
  await client.end();
}

run().catch(console.error);
