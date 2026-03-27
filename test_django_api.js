const fetch = require('node-fetch');

async function main() {
  const url = 'http://localhost:8001/api/search/user-videos/';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'FACEBOOK', username: '61581376858588' })
  });
  const data = await response.json();
  console.log('Success:', data.success);
  console.log('Count:', data.count);
  console.log('Profile:', data.profile);
}
main().catch(console.error);
