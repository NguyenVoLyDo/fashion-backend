
import pool from './src/config/db.js';
import * as authService from './src/services/auth.service.js';

async function test() {
  const email = `debug_${Date.now()}@example.com`;
  const password = "password123";
  const fullName = "Debug User";
  
  console.log('Testing registration for:', email);
  try {
    const result = await authService.register({
      email,
      password,
      fullName,
      phone: null
    });
    console.log('Registration successful:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Registration failed!');
    console.error('Error:', err.message);
    console.error('Code:', err.code);
    console.error('Stack:', err.stack);
  } finally {
    await pool.end();
  }
}

test();
