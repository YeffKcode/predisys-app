import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { FleetProvider, useFleet } from '../auth/FleetContext';
import MachineDrawer from '../pages/dashboard/MachineDrawer';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { SessionWarning } from './SessionGuard';

function GlobalDrawer() {
  const fleet = useFleet();
  if (!fleet?.openId) return null;
  return <MachineDrawer key={fleet.openId} machineId={fleet.openId} initialTab={fleet.openTab} threshold={fleet.threshold} onClose={fleet.closeMachine} onChanged={fleet.reload} />;
}

export default function Layout() {
  const [menu, setMenu] = useState(false);
  return (
    <FleetProvider>
      <div className="shell">
        <Sidebar open={menu} onNavigate={() => setMenu(false)} />
        <div className={`scrim${menu ? ' open' : ''}`} onClick={() => setMenu(false)} aria-hidden="true" />
        <div className="content">
          <Topbar onMenu={() => setMenu(true)} />
          <main id="contenido"><Outlet /></main>
        </div>
      </div>
      <GlobalDrawer />
      <SessionWarning />
    </FleetProvider>
  );
}
