const net = require('net');

function testPort(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const startTime = Date.now();

    socket.setTimeout(5000);

    socket.connect(port, host, () => {
      const duration = Date.now() - startTime;
      console.log(`[OK] Reachable: ${host}:${port} (took ${duration}ms)`);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', (err) => {
      console.log(`[FAIL] Unreachable: ${host}:${port} - Error: ${err.message}`);
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      console.log(`[TIMEOUT] Unreachable: ${host}:${port} - Timeout after 5s`);
      socket.destroy();
      resolve(false);
    });
  });
}

async function run() {
  console.log('--- Testing Network Ports ---');
  await testPort('aws-1-ap-southeast-1.pooler.supabase.com', 6543);
  await testPort('aws-1-ap-southeast-1.pooler.supabase.com', 5432);
  await testPort('db.wbiumzxlfvlzenyuykxe.supabase.co', 5432);
}

run();
