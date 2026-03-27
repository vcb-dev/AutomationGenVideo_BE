const fetch = require('node-fetch');
const fs = require('fs');

async function main() {
  const url = 'http://localhost:8001/api/search/user-videos/';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'facebook', username: '61581376858588' }) // <--- platform in lower case
  });
  const text = await response.text();
  fs.writeFileSync('test_django_res.json', text);
  console.log('Status code:', response.status);
  console.log('Length:', text.length);
}
main().catch(console.error);
