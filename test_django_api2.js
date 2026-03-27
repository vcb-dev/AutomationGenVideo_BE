const fetch = require('node-fetch');

async function main() {
  const url = 'http://localhost:8001/api/search/user-videos/';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'facebook', username: '61581376858588' }) // <--- Dùng chữ thường cho platform
  });
  const text = await response.text();
  console.log('Status code:', response.status);
  console.log('Response body:', text.length > 500 ? text.substring(0, 500) + '... (truncated)' : text);
}
main().catch(console.error);
