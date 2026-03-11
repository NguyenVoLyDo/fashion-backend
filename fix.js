import fs from 'fs';
const file = 'tests/catalog.test.js';
let data = fs.readFileSync(file, 'utf8');
data = data.replace(/\/api\/v1\/catalog\//g, '/api/v1/');
fs.writeFileSync(file, data);
console.log('Done replacing routes');
