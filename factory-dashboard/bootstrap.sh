#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  🖖 AGENTRYX DEV FACTORY — One-Command Installer
#     Bootstrap script for deploying on any VM
# ═══════════════════════════════════════════════════════════
set -e

PURPLE='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

FACTORY_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$FACTORY_DIR/../agent-workspace"
ENGINE_DIR="$FACTORY_DIR/../cognitive-engine"

echo -e "${PURPLE}"
echo "  ═══════════════════════════════════════════════════"
echo "  🖖 AGENTRYX DEV FACTORY — Bootstrap Installer"
echo "  ═══════════════════════════════════════════════════"
echo -e "${NC}"

# ── Step 1: Check Prerequisites ──────────────────────────
echo -e "${CYAN}[1/7]${NC} Checking prerequisites..."

if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js not found. Installing via nvm...${NC}"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm use 22
else
    NODE_VER=$(node -v)
    echo -e "${GREEN}✓ Node.js ${NODE_VER} detected${NC}"
fi

if ! command -v git &>/dev/null; then
    echo -e "${RED}✗ Git not found. Please install git first.${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Git detected${NC}"
fi

if command -v docker &>/dev/null; then
    echo -e "${GREEN}✓ Docker detected${NC}"
    HAS_DOCKER=true
else
    echo -e "${YELLOW}⚠ Docker not found. Infrastructure services (Redis, PostgreSQL, ChromaDB) will not start.${NC}"
    echo -e "${YELLOW}  The factory dashboard will still work without them.${NC}"
    HAS_DOCKER=false
fi

# ── Step 2: Install Dashboard Dependencies ───────────────
echo ""
echo -e "${CYAN}[2/7]${NC} Installing Dashboard dependencies..."
cd "$FACTORY_DIR"
npm install --silent 2>/dev/null
echo -e "${GREEN}✓ Dashboard dependencies installed${NC}"

# ── Step 3: Install Cognitive Engine Dependencies ────────
echo ""
echo -e "${CYAN}[3/7]${NC} Installing Cognitive Engine dependencies..."
if [ -d "$ENGINE_DIR" ]; then
    cd "$ENGINE_DIR"
    npm install --silent 2>/dev/null
    echo -e "${GREEN}✓ Cognitive Engine dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠ Cognitive Engine not found at ${ENGINE_DIR}. Creating directory...${NC}"
    mkdir -p "$ENGINE_DIR"
    echo -e "${YELLOW}  You'll need to clone/copy the cognitive-engine separately.${NC}"
fi

# ── Step 4: Create Agent Workspace ───────────────────────
echo ""
echo -e "${CYAN}[4/7]${NC} Setting up Agent Workspace..."
mkdir -p "$WORKSPACE_DIR"
if [ ! -d "$WORKSPACE_DIR/.git" ]; then
    cd "$WORKSPACE_DIR"
    git init
    git config user.email "factory@agentryx.dev"
    git config user.name "Agentryx Factory"
    echo "# Agent Workspace" > README.md
    git add . && git commit -m "Initialize agent workspace" --quiet
fi
echo -e "${GREEN}✓ Agent Workspace ready at ${WORKSPACE_DIR}${NC}"

# ── Step 5: Configure Environment ────────────────────────
echo ""
echo -e "${CYAN}[5/7]${NC} Checking environment configuration..."
cd "$FACTORY_DIR"
if [ ! -f ".env.factory" ]; then
    cp .env.example .env.factory 2>/dev/null || cat > .env.factory <<EOF
# Agentryx Dev Factory Configuration
# Fill in your API keys below

# GitHub Personal Access Token (for git push/PR operations)
GITHUB_PAT=

# Google Gemini API Key (for AI agent inference)
GEMINI_API_KEY=

# Optional: WhatsApp Webhook URL
WHATSAPP_WEBHOOK=http://localhost:5678/webhook/factory-alert
EOF
    echo -e "${YELLOW}⚠ Created .env.factory — Please add your API keys via the Configuration UI${NC}"
else
    echo -e "${GREEN}✓ .env.factory exists${NC}"
fi

# ── Step 6: Start Infrastructure (if Docker available) ───
echo ""
echo -e "${CYAN}[6/7]${NC} Infrastructure services..."
if [ "$HAS_DOCKER" = true ]; then
    echo -e "  Starting Redis, PostgreSQL, ChromaDB, n8n, LangFuse..."
    docker compose up -d --quiet-pull 2>/dev/null || true
    echo -e "${GREEN}✓ Infrastructure services started${NC}"
else
    echo -e "${YELLOW}⚠ Skipping (Docker not available)${NC}"
fi

# ── Step 7: Start Factory Services ───────────────────────
echo ""
echo -e "${CYAN}[7/7]${NC} Starting factory services..."

# Kill any existing processes
pkill -f "telemetry.mjs" 2>/dev/null || true
pkill -f "metrics.mjs" 2>/dev/null || true

cd "$FACTORY_DIR"

# Start Telemetry Broker (port 4401)
nohup node server/telemetry.mjs > /tmp/agentryx-telemetry.log 2>&1 &
echo -e "${GREEN}✓ Telemetry Broker running on :4401${NC}"

# Start Metrics API (port 4400)
if [ -f "server/metrics.mjs" ]; then
    nohup node server/metrics.mjs > /tmp/agentryx-metrics.log 2>&1 &
    echo -e "${GREEN}✓ Metrics API running on :4400${NC}"
fi

# Start Vite Dashboard (port 5173)
nohup npm run dev -- --host 0.0.0.0 > /tmp/agentryx-dashboard.log 2>&1 &
echo -e "${GREEN}✓ Dashboard running on :5173${NC}"

# ── Done ─────────────────────────────────────────────────
echo ""
echo -e "${PURPLE}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ AGENTRYX DEV FACTORY — Successfully Deployed!${NC}"
echo -e "${PURPLE}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}📊 Dashboard:${NC}     http://localhost:5173"
echo -e "  ${CYAN}📡 Telemetry:${NC}     http://localhost:4401"
echo -e "  ${CYAN}📈 Metrics:${NC}       http://localhost:4400"
echo -e "  ${CYAN}📂 Workspace:${NC}     ${WORKSPACE_DIR}"
echo -e "  ${CYAN}⚙️  Config:${NC}        ${FACTORY_DIR}/.env.factory"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "  1. Open the dashboard and go to Configuration"
echo -e "  2. Add your GitHub PAT and Gemini API Key"
echo -e "  3. Click Test Connectivity to verify"
echo -e "  4. Go to Factory Floor and submit your first task!"
echo ""
echo -e "  ${PURPLE}Live long and prosper 🖖${NC}"
