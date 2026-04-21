# 🖖 Agentryx Dev Factory

> **An autonomous AI software development factory powered by a Star Trek bridge crew.**

Agentryx Dev Factory is a multi-agent AI system that autonomously triages, researches, writes, reviews, tests, and deploys code — controlled from a real-time visual dashboard.

![Live Pipeline](docs/dashboard-preview.png)

---

## 🚀 Quick Start (One Command)

```bash
git clone https://github.com/microaistudio/Agentryx-Dev-Factory.git
cd Agentryx-Dev-Factory
chmod +x bootstrap.sh
./bootstrap.sh
```

This will:
1. Install Node.js dependencies
2. Set up the cognitive engine
3. Create the agent workspace
4. Start all services (Dashboard, Telemetry, Metrics)
5. Optionally start infrastructure via Docker (Redis, PostgreSQL, ChromaDB)

> **After install:** Open `http://localhost:5173` → Go to **Configuration** → Add your API keys → Start building!

---

## 🧠 Architecture

```
┌─────────────────────────────────────────────────────┐
│                   PIXEL FACTORY UI                   │
│              (React + Vite Dashboard)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Factory  │  │   Skill  │  │  System  │          │
│  │  Floor    │  │  Memory  │  │ Resources│          │
│  └────┬─────┘  └──────────┘  └──────────┘          │
│       │ SSE Stream                                   │
├───────┼─────────────────────────────────────────────┤
│       ▼                                              │
│  ┌──────────────────────────────────────────────┐   │
│  │        TELEMETRY BROKER (Port 4401)           │   │
│  │   SSE • Config API • Workspace • Factory Run  │   │
│  └──────────┬───────────────────────────────────┘   │
│             │ Spawns                                 │
│             ▼                                        │
│  ┌──────────────────────────────────────────────┐   │
│  │      COGNITIVE ENGINE (LangGraph StateGraph)  │   │
│  │                                               │   │
│  │  Jane → Spock → Torres → Data → Tuvok → O'Brien │
│  │   PM    Research   Dev   Architect  QA     SRE │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │            INFRASTRUCTURE STACK               │   │
│  │  Redis • PostgreSQL • ChromaDB • n8n • LangFuse│  │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 👥 The Star Trek Crew

| Agent | Role | Model | Series |
|-------|------|-------|--------|
| **Jane** (Janeway) | PM / Triage | Gemini 2.5 Flash | Voyager |
| **Spock** | Auto-Research | Gemini 3.1 Pro | SNW |
| **Torres** (B'Elanna) | Junior Dev | Gemini 3.1 Pro* | Voyager |
| **Data** | Sr. Architect | Gemini 3.1 Pro* | TNG |
| **Tuvok** | QA / Security | Gemini 3.1 Pro | Voyager |
| **O'Brien** (Miles) | SRE / Deploy | Gemini 2.5 Flash | DS9 |

*\* In production, Torres and Data can be swapped to Claude Opus 4.6 for superior code generation.*

---

## 📁 Project Structure

```
Agentryx-Dev-Factory/
├── bootstrap.sh              # One-command installer
├── docker-compose.yml         # Infrastructure stack
├── .env.example               # API key template
├── .env.factory               # Your active config (gitignored)
├── package.json               # Dashboard dependencies
├── vite.config.ts             # Vite build config
│
├── server/
│   ├── telemetry.mjs          # SSE Broker + Factory API
│   └── metrics.mjs            # System resource metrics
│
├── src/
│   ├── App.tsx                # Main app router
│   ├── index.css              # Design system
│   └── components/
│       ├── FactoryFloor.tsx   # Live pipeline visualization
│       ├── AdminConfig.tsx    # Configuration hub
│       ├── SkillMemory.tsx    # Agent skill tracking
│       ├── SystemResources.tsx # Server monitoring
│       └── Sidebar.tsx        # Navigation
│
├── ../cognitive-engine/       # LangGraph brain (separate repo)
│   ├── factory_graph.js       # StateGraph with 6 agents
│   ├── tools.js               # File/terminal/git tools
│   └── .env                   # Gemini API key
│
└── ../agent-workspace/        # Where agents write code
    └── (generated files)
```

---

## ⚙️ Configuration

### API Keys Required

| Key | Purpose | Where to Get |
|-----|---------|-------------|
| **Gemini API Key** | Powers all AI agents | [Google AI Studio](https://aistudio.google.com/apikey) |
| **GitHub PAT** | Git push, PRs, CI/CD | [GitHub Settings](https://github.com/settings/tokens) |

### Setting Keys

**Option A — Dashboard UI:**
1. Open the dashboard → Navigate to **Configuration**
2. Enter your keys in the secure fields
3. Click **Commit Architecture to Factory**
4. Click **⚡ Test Connectivity** to verify

**Option B — Environment File:**
```bash
cp .env.example .env.factory
nano .env.factory  # Add your keys
```

---

## 🔧 Services & Ports

| Service | Port | Description |
|---------|------|-------------|
| Dashboard (Vite) | 5173 | React visual interface |
| Telemetry Broker | 4401 | SSE stream + Factory API |
| Metrics API | 4400 | System resource monitoring |
| Redis | 6379 | Message queue |
| PostgreSQL | 5432 | Agent memory |
| ChromaDB | 8000 | Vector/RAG storage |
| n8n | 5678 | Webhook automation |
| LangFuse | 3000 | Observability/tracing |

---

## 🏃 Running

### Start All Services
```bash
./bootstrap.sh
```

### Start Individual Services
```bash
# Dashboard only
npm run dev

# Telemetry only
node server/telemetry.mjs

# Cognitive Engine (CLI)
node ../cognitive-engine/factory_graph.js "Build a REST API with Express"

# Infrastructure
docker compose up -d
```

### Stop All Services
```bash
pkill -f telemetry.mjs
pkill -f metrics.mjs
pkill -f vite
docker compose down
```

---

## 🧪 Testing the Factory

### From the Dashboard
1. Go to **Factory Floor**
2. Type a task in the command bar: `Create a Node.js script that prints Hello World`
3. Click **🚀 Engage**
4. Watch the agents process in real-time
5. Scroll down to **Agent Workspace** → Click **🔄 Refresh Files**
6. Click a file to view source → Click **▶ Run** to execute

### From the Terminal
```bash
node ../cognitive-engine/factory_graph.js "Create a simple Express REST API"
ls ../agent-workspace/    # See generated files
node ../agent-workspace/app.js  # Run the output
```

---

## 📦 Deploying to Production

### With Nginx (recommended)
```nginx
# Add to your Nginx server block:
location /telemetry/ {
    proxy_pass http://127.0.0.1:4401/api/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400;
}
```

### With Docker (coming soon)
```bash
docker compose -f docker-compose.full.yml up -d
```

---

## 🗺️ Roadmap

- [x] Phase 1: Infrastructure Stack
- [x] Phase 2: Agent Persona Architecture
- [x] Phase 3: Pixel Factory Dashboard
- [x] Phase 4: LangGraph Cognitive Engine
- [ ] Phase 5: Multi-file project generation
- [ ] Phase 6: Automated testing pipeline
- [ ] Phase 7: GitHub PR auto-creation
- [ ] Phase 8: Full CI/CD integration
- [ ] Phase 9: Multi-model support (Claude, GPT, Llama)
- [ ] Phase 10: Self-improving agent skills

---

## 📄 License

MIT License — Built with 🖖 by the Agentryx team.
