async function run() {
    try {
        await fetch('http://localhost:4401/api/telemetry/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: "TORRES", room: 2, status: "Writing React components...", log: "Building HPSEDC frontend UI" })
        });
        await new Promise(r => setTimeout(r, 1000));
        await fetch('http://localhost:4401/api/telemetry/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: "DATA", room: 2, status: "Reviewing Vite structure...", log: "Validated Vite TS template" })
        });
        await new Promise(r => setTimeout(r, 1000));
        await fetch('http://localhost:4401/api/telemetry/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: "TORRES", room: 2, status: "Deploying Development Phase", log: "Development Phase Complete. 85%" })
        });
    } catch(e) {}
}
run();
