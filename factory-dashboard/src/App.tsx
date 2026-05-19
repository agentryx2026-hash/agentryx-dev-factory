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

type Page =
  | 'pre-dev' | 'factory' | 'post-dev' | 'architect' | 'replay'
  | 'customer-portal' | 'notifications'
  | 'analytics' | 'skills' | 'cost-panel'
  | 'system' | 'settings' | 'admin-keys';

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
