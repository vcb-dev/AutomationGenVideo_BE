const http = require('http');

http.get('http://127.0.0.1:3000/api/lark/user-activity', (res) => {
  let body = '';
  res.on('data', chunk => { body += chunk; });
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      console.log('Total length of reports:', data.reports?.length);
      const baoviet = data.reports?.find(r => r.name && r.name.toUpperCase().includes('BẢO VIỆT'));
      if (baoviet) {
          console.log('Bảo việt found in API response!');
          console.log(JSON.stringify(baoviet, null, 2));
      } else {
          console.log('Bảo việt NOT FOUND in API response!');
      }
    } catch (e) {
      console.error('Error parsing JSON:', e);
    }
  });
}).on('error', console.error);
