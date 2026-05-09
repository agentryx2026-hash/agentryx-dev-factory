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

type Page = 'pre-dev' | 'factory' | 'post-dev' | 'architect' | 'replay' | 'analytics' | 'settings' | 'skills' | 'system' | 'admin-keys' | 'cost-panel';

function App() {
  const [activePage, setActivePage] = useState<Page>('pre-dev');

  const renderPage = () => {
    switch (activePage) {
      case 'pre-dev':
        return <PreDev />;
      case 'factory':
        return <FactoryFloor />;
      case 'post-dev':
        return <PostDev />;
      case 'architect':
        return <MasterArchitect />;
      case 'replay':
        return <Replay />;
      case 'analytics':
        return <AnalyticsInsights />;
      case 'skills':
        return <SkillMemory />;
      case 'system':
        return <SystemResources />;
      case 'settings':
        return <AdminConfig />;
      case 'admin-keys':
        return <AdminKeys />;
      case 'cost-panel':
        return <CostPanel />;
      default:
        return <PreDev />;
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
