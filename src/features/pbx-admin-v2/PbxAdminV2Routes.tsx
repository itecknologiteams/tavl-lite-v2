import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAdminAuthStore, PbxAdminLogin } from '@features/pbx-admin';
import { PbxAdminShellV2 } from './PbxAdminShellV2';

const lazyPage = <T extends { [key: string]: React.ComponentType<any> }>(
  loader: () => Promise<T>,
  exportName: keyof T,
) =>
  React.lazy(() =>
    loader().then((m) => ({ default: m[exportName] as React.ComponentType<any> })),
  );

const DashboardPageV2 = lazyPage(() => import('./pages/DashboardPageV2'), 'DashboardPageV2');
const ExtensionsPageV2 = lazyPage(() => import('./pages/ExtensionsPageV2'), 'ExtensionsPageV2');
const TrunksPageV2 = lazyPage(() => import('./pages/TrunksPageV2'), 'TrunksPageV2');
const QueuesPageV2 = lazyPage(() => import('./pages/QueuesPageV2'), 'QueuesPageV2');
const QueueMonitorPageV2 = lazyPage(() => import('./pages/QueueMonitorPageV2'), 'QueueMonitorPageV2');
const RingGroupsPageV2 = lazyPage(() => import('./pages/RingGroupsPageV2'), 'RingGroupsPageV2');
const IvrPageV2 = lazyPage(() => import('./pages/IvrPageV2'), 'IvrPageV2');
const TimeConditionsPageV2 = lazyPage(() => import('./pages/TimeConditionsPageV2'), 'TimeConditionsPageV2');
const VoicemailPageV2 = lazyPage(() => import('./pages/VoicemailPageV2'), 'VoicemailPageV2');
const ConferencesPageV2 = lazyPage(() => import('./pages/ConferencesPageV2'), 'ConferencesPageV2');
const FaxPageV2 = lazyPage(() => import('./pages/FaxPageV2'), 'FaxPageV2');
const MohPageV2 = lazyPage(() => import('./pages/MohPageV2'), 'MohPageV2');
const CdrPageV2 = lazyPage(() => import('./pages/CdrPageV2'), 'CdrPageV2');
const RoutingPageV2 = lazyPage(() => import('./pages/RoutingPageV2'), 'RoutingPageV2');
const BlacklistPageV2 = lazyPage(() => import('./pages/BlacklistPageV2'), 'BlacklistPageV2');
const SipProfilesPageV2 = lazyPage(() => import('./pages/SipProfilesPageV2'), 'SipProfilesPageV2');
const ScriptsPageV2 = lazyPage(() => import('./pages/ScriptsPageV2'), 'ScriptsPageV2');
const BackupsPageV2 = lazyPage(() => import('./pages/BackupsPageV2'), 'BackupsPageV2');
const SystemPageV2 = lazyPage(() => import('./pages/SystemPageV2'), 'SystemPageV2');

function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-64">
      <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
      <p className="text-slate-400 text-sm font-medium">Loading page…</p>
    </div>
  );
}

export function PbxAdminV2Routes() {
  const isAuthenticated = useAdminAuthStore((state) => state.isAuthenticated);

  return (
    <Routes>
      <Route
        path="/"
        element={
          isAuthenticated ? (
            <Navigate to="/pbx-admin-v2/dashboard" replace />
          ) : (
            <PbxAdminLogin redirectTo="/pbx-admin-v2/dashboard" />
          )
        }
      />
      <Route
        path="/*"
        element={
          isAuthenticated ? (
            <PbxAdminShellV2>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="dashboard" element={<DashboardPageV2 />} />
                  <Route path="extensions" element={<ExtensionsPageV2 />} />
                  <Route path="trunks" element={<TrunksPageV2 />} />
                  <Route path="queues" element={<QueuesPageV2 />} />
                  <Route path="queue-monitor" element={<QueueMonitorPageV2 />} />
                  <Route path="ring-groups" element={<RingGroupsPageV2 />} />
                  <Route path="ivr" element={<IvrPageV2 />} />
                  <Route path="time-conditions" element={<TimeConditionsPageV2 />} />
                  <Route path="voicemail" element={<VoicemailPageV2 />} />
                  <Route path="conferences" element={<ConferencesPageV2 />} />
                  <Route path="fax" element={<FaxPageV2 />} />
                  <Route path="moh" element={<MohPageV2 />} />
                  <Route path="cdr" element={<CdrPageV2 />} />
                  <Route path="routing" element={<RoutingPageV2 />} />
                  <Route path="blacklist" element={<BlacklistPageV2 />} />
                  <Route path="sip-profiles" element={<SipProfilesPageV2 />} />
                  <Route path="scripts" element={<ScriptsPageV2 />} />
                  <Route path="backups" element={<BackupsPageV2 />} />
                  <Route path="system" element={<SystemPageV2 />} />
                  <Route path="*" element={<Navigate to="/pbx-admin-v2/dashboard" replace />} />
                </Routes>
              </Suspense>
            </PbxAdminShellV2>
          ) : (
            <Navigate to="/pbx-admin-v2" replace />
          )
        }
      />
    </Routes>
  );
}
