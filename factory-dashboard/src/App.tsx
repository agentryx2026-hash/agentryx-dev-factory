import { useState } from 'react';
import './index.css';
import Sidebar from './components/Sidebar';
import PreDev from './components/PreDev';
import FactoryFloor from './components/FactoryFloor';
import PostDev from './components/PostDev';
import SkillMemory from './components/SkillMemory';
import SystemResources from './components/SystemResources';
import AdminConfig from './components/AdminConfig';
import AnalyticsInsights from './components/AnalyticsInsights';
import AdminKeys from './components/AdminKeys';
import CostPanel from './components/CostPanel';
import MasterArchitect from './components/MasterArchitect';
import Replay from './components/Replay';
import CustomerPortal from './components/CustomerPortal';
import Notifications from './components/Notifications';
import ServicesHealth from './components/ServicesHealth';
import EmbeddedConsole from './components/EmbeddedConsole';

type Page =
  | 'pre-dev' | 'factory' | 'post-dev' | 'architect' | 'replay'
  | 'customer-portal' | 'notifications'
  | 'analytics' | 'skills' | 'cost-panel'
  | 'system' | 'settings' | 'admin-keys' | 'services-health'
  | 'console-n8n' | 'console-langfuse' | 'console-paperclip' | 'console-litellm';

function App() {
  const [activePage, setActivePage] = useState<Page>('pre-dev');

  const renderPage = () => {
    switch (activePage) {
      case 'pre-dev':         return <PreDev />;
      case 'factory':         return <FactoryFloor />;
      case 'post-dev':        return <PostDev />;
      case 'architect':       return <MasterArchitect />;
      case 'replay':          return <Replay />;
      case 'customer-portal': return <CustomerPortal />;
      case 'notifications':   return <Notifications />;
      case 'analytics':       return <AnalyticsInsights />;
      case 'skills':          return <SkillMemory />;
      case 'system':          return <SystemResources />;
      case 'settings':        return <AdminConfig />;
      case 'admin-keys':      return <AdminKeys />;
      case 'cost-panel':      return <CostPanel />;
      case 'services-health': return <ServicesHealth />;
      // Embedded tool consoles — UI-E. Same-origin (served via nginx proxy)
      // so cookies + auth work. Each tool's own UI runs inside iframe.
      case 'console-n8n':
        return <EmbeddedConsole
          title="n8n — Workflow Editor"
          description="Visual workflow builder (Docker container factory-n8n on port 5678)"
          url="/n8n/"
        />;
      case 'console-langfuse':
        return <EmbeddedConsole
          title="Langfuse — LLM Observability"
          description="Trace + cost + latency analytics (Docker container factory-langfuse on port 3000)"
          url="/langfuse/"
        />;
      case 'console-paperclip':
        return <EmbeddedConsole
          title="Paperclip — Document Parser"
          description="Document ingestion + extraction console (own service on port 3101)"
          url="/paperclip/"
          warning={`Paperclip is a Vite dev server that currently blocks the dev-hub.agentryx.dev host. To allow embedding, add this to /home/subhash.thakur.india/Projects/paperclip/ui/vite.config.ts → server: { allowedHosts: ['dev-hub.agentryx.dev'] } and restart factory-paperclip.service. Until then, iframe stays blank — use "Open in new tab" against http://127.0.0.1:3101/ from a browser on the VM, or fix the config.`}
        />;
      case 'console-litellm':
        return <EmbeddedConsole
          title="LiteLLM — LLM Proxy Admin"
          description="Provider routing + key admin + spend monitor (Docker container factory-litellm on port 4000)"
          url="http://127.0.0.1:4000/ui"
          warning="LiteLLM admin UI loads from port 4000 directly (not yet proxied through nginx). If the iframe stays blank, use 'Open in new tab' — some browsers block mixed-origin iframes."
        />;
      default:                return <PreDev />;
    }
  };

  return (
    <div className="app-container">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
