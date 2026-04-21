// ═══════════════════════════════════════════════════════════
//  PIXEL FACTORY — System Metrics API Server
//  Lightweight Node.js server that exposes /api/metrics
//  Reading directly from Linux /proc and os module
//  Run with: node server/metrics.mjs
// ═══════════════════════════════════════════════════════════

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const PORT = 4400;

function getCpuUsage() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const line = stat.split('\n')[0]; // cpu aggregate line
    const parts = line.split(/\s+/).slice(1).map(Number);
    // user, nice, system, idle, iowait, irq, softirq, steal
    const idle = parts[3] + parts[4];
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

// Take two readings 200ms apart for actual CPU %
async function getCpuPercent() {
  const a = getCpuUsage();
  await new Promise(r => setTimeout(r, 200));
  const b = getCpuUsage();
  if (!a || !b) return 0;
  const idleDiff = b.idle - a.idle;
  const totalDiff = b.total - a.total;
  return totalDiff === 0 ? 0 : Math.round((1 - idleDiff / totalDiff) * 100);
}

function getMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalGB: (total / 1073741824).toFixed(1),
    usedGB: (used / 1073741824).toFixed(1),
    freeGB: (free / 1073741824).toFixed(1),
    percent: Math.round((used / total) * 100),
  };
}

function getDisk() {
  try {
    const output = execSync("df -B1 / | tail -1").toString().trim();
    const parts = output.split(/\s+/);
    const total = parseInt(parts[1]);
    const used = parseInt(parts[2]);
    const avail = parseInt(parts[3]);
    return {
      totalGB: (total / 1073741824).toFixed(1),
      usedGB: (used / 1073741824).toFixed(1),
      availGB: (avail / 1073741824).toFixed(1),
      percent: Math.round((used / total) * 100),
      mount: parts[5],
    };
  } catch {
    return { totalGB: '0', usedGB: '0', availGB: '0', percent: 0, mount: '/' };
  }
}

function getUptime() {
  const uptimeSeconds = os.uptime();
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  return {
    seconds: uptimeSeconds,
    formatted: days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`,
  };
}

function getLoadAverage() {
  const loads = os.loadavg();
  return {
    '1m': loads[0].toFixed(2),
    '5m': loads[1].toFixed(2),
    '15m': loads[2].toFixed(2),
  };
}

function getCpuInfo() {
  const cpus = os.cpus();
  return {
    model: cpus[0]?.model || 'Unknown',
    cores: cpus.length,
    speed: cpus[0]?.speed || 0,
  };
}

function getNetwork() {
  const interfaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (name === 'lo') continue;
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4') {
        result.push({ interface: name, ip: addr.address });
      }
    }
  }
  return result;
}

function getDockerContainers() {
  try {
    const output = execSync(
      'docker ps --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>/dev/null',
      { timeout: 3000 }
    ).toString().trim();
    if (!output) return [];
    return output.split('\n').map(line => {
      const [name, status, ports] = line.split('|');
      return { name, status, ports: ports || '' };
    });
  } catch {
    return [];
  }
}

function getGpuInfo() {
  try {
    execSync('which nvidia-smi', { timeout: 2000 });
    const output = execSync(
      'nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
      { timeout: 3000 }
    ).toString().trim();
    const parts = output.split(',').map(s => s.trim());
    return {
      available: true,
      name: parts[0],
      memoryTotalMB: parseInt(parts[1]),
      memoryUsedMB: parseInt(parts[2]),
      utilizationPercent: parseInt(parts[3]),
      temperatureC: parseInt(parts[4]),
    };
  } catch {
    return { available: false, name: 'No GPU detected', memoryTotalMB: 0, memoryUsedMB: 0, utilizationPercent: 0, temperatureC: 0 };
  }
}

function getProcessCount() {
  try {
    const output = execSync('ls -1d /proc/[0-9]* 2>/dev/null | wc -l').toString().trim();
    return parseInt(output) || 0;
  } catch {
    return 0;
  }
}

const server = http.createServer(async (req, res) => {
  // CORS headers for Vite dev server
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/metrics') {
    const cpuPercent = await getCpuPercent();
    const metrics = {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      os: 'Ubuntu 24.04.4 LTS',
      arch: os.arch(),
      cpu: {
        ...getCpuInfo(),
        usagePercent: cpuPercent,
      },
      memory: getMemory(),
      disk: getDisk(),
      gpu: getGpuInfo(),
      uptime: getUptime(),
      loadAverage: getLoadAverage(),
      network: getNetwork(),
      processes: getProcessCount(),
      docker: getDockerContainers(),
      nodeVersion: process.version,
    };
    res.writeHead(200);
    res.end(JSON.stringify(metrics));
  } else if (req.url === '/api/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', uptime: os.uptime() }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  📊 Pixel Factory Metrics API`);
  console.log(`  ➜  http://localhost:${PORT}/api/metrics\n`);
});
