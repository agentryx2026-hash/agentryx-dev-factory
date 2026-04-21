import http from 'http';

function send(body) {
  const req = http.request({
    hostname: 'localhost',
    port: 4401,
    path: '/api/telemetry/state',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  req.write(JSON.stringify(body));
  req.end();
}

async function loop() {
  while(true) {
    send({ agentId: 'charlie', room: 2, status: 'working', log: 'Starting Background Routine...' });
    await new Promise(r => setTimeout(r, 3000));
    send({ agentId: 'charlie', room: 3, status: 'working', log: 'Testing Routine...' });
    await new Promise(r => setTimeout(r, 3000));
    send({ agentId: 'charlie', room: 1, status: 'idle', log: 'Routine Complete. Resting.' });
    await new Promise(r => setTimeout(r, 6000));
  }
}
loop();
