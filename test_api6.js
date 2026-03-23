const http = require('http');

const email = 'haducbaoviet0911@gmail.com';
const today = new Date();
const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

const url = `/api/lark/user-activity?startDate=${dateStr}&endDate=${dateStr}&requesterEmail=${encodeURIComponent(email)}`;
console.log('Calling:', url);

http.get({
  host: '127.0.0.1',
  port: 3000,
  path: url
}, (res) => {
  let body = '';
  res.on('data', chunk => { body += chunk; });
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      console.log('Total reports from API:', data.reports?.length);
      const bv = data.reports?.find(r => r.name && r.name.toUpperCase().includes('BẢO VIỆT'));
      console.log('BẢO VIỆT in response:', bv ? 'YES!' : 'NO :(');
    } catch (e) {
      console.error('Error:', e);
      console.log('Raw response:', body.substring(0, 500));
    }
  });
}).on('error', console.error);
