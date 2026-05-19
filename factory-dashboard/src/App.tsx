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

// Embedded-Consoles design note (UI-F):
//   We only embed services that natively support a basePath matching the
//   nginx proxy prefix. n8n is configured with N8N_PATH=/n8n/ so it
//   generates HTML with /n8n/-prefixed asset URLs that nginx routes back
//   to n8n. Paperclip / Langfuse / LiteLLM all serve HTML with absolute
//   paths starting at /, which the browser then loads from
//   dev-hub.agentryx.dev/... → routed to the Dev-Hub itself → iframe
//   ends up rendering Dev-Hub recursively (the "image of itself" bug).
//   Plus Langfuse explicitly sets `frame-ancestors 'none'` and
//   X-Frame-Options: SAMEORIGIN — even with correct paths it would
//   refuse to embed.
//
//   So: Paperclip / Langfuse / LiteLLM live in External Links (open in
//   new tab works perfectly). n8n stays embedded.
type Page =
  | 'pre-dev' | 'factory' | 'post-dev' | 'architect' | 'replay'
  | 'customer-portal' | 'notifications'
  | 'analytics' | 'skills' | 'cost-panel'
  | 'system' | 'settings' | 'admin-keys' | 'services-health'
  | 'console-n8n' | 'console-hermes';

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
      case 'console-n8n':
        return <EmbeddedConsole
          title="n8n — Workflow Editor"
          description="Visual workflow builder (Docker container factory-n8n on port 5678; N8N_PATH=/n8n/ ensures asset URLs respect the proxy prefix)"
          url="/n8n/"
        />;
      case 'console-hermes':
        return <EmbeddedConsole
          title="Hermes Agent — Dashboard (Lab evaluation)"
          description="NousResearch Hermes Agent web dashboard (config, API keys, sessions, skills). Phase 2.75 Lab profile — evaluating for adoption beyond R1. Container factory-hermes (port 9119); nginx sub_filter rewrites absolute /api/ + /assets/ paths into /hermes/-prefixed ones."
          url="/hermes/"
          warning="Lab-profile service. The dashboard exposes Hermes config + API keys; current access requires the dev-hub.agentryx.dev TLS. v0.0.1 acceptable, but Phase 22 hardening should add basic-auth in front of /hermes/. Capabilities here will inform pipeline integration post-R1."
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
