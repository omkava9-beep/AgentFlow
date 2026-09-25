import { useEffect } from 'react';
import { Route, Outlet, Navigate, createBrowserRouter, createRoutesFromElements, RouterProvider, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import WorkspaceRoute from './components/WorkspaceRoute';
import LegacyRedirect from './components/LegacyRedirect';
import WorkspaceFallback from './components/WorkspaceFallback';
import GradientBackdrop from './components/GradientBackdrop';
import Toaster from './components/Toaster';
import ConfirmHost from './components/ui/ConfirmDialog';
import { RouteErrorBoundary } from './components/ui/ErrorBoundary';
import NotFound from './pages/NotFound';
import { setNavigate } from './navigation';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Builder from './pages/Builder';
import RunMonitor from './pages/RunMonitor';
import RunHistory from './pages/RunHistory';
import Templates from './pages/Templates';
import Analytics from './pages/Analytics';
import SharedWorkflow from './pages/SharedWorkflow';
import SharedRun from './pages/SharedRun';
import Runs from './pages/Runs';
import InvitePage from './pages/InvitePage';
import Outbox from './pages/Outbox';
import Notifications from './pages/Notifications';
import Connections from './pages/Connections';
import Integrations from './pages/Integrations';
import KnowledgeBase from './pages/KnowledgeBase';
import Approvals from './pages/Approvals';
import ApprovePage from './pages/ApprovePage';
import SettingsLayout from './pages/settings/SettingsLayout';
import GeneralTab from './pages/settings/GeneralTab';
import MembersTab from './pages/settings/MembersTab';
import ApiKeysTab from './pages/settings/ApiKeysTab';
import UsageTab from './pages/settings/UsageTab';
import AuditTab from './pages/settings/AuditTab';
import ProfileTab from './pages/settings/ProfileTab';
import Status from './pages/Status';

function Root() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigate(navigate);
    return () => setNavigate(null);
  }, [navigate]);

  return (
    <>
      <GradientBackdrop />
      <Outlet />
      <Toaster />
      <ConfirmHost />
    </>
  );
}

// A data router (rather than <BrowserRouter>) because the Builder's
// unsaved-changes guard uses `useBlocker`, which only works with one.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Root />} errorElement={<RouteErrorBoundary />}>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      {/* Public on purpose: a share link has to work for someone who isn't
          signed in, so it sits outside ProtectedRoute. */}
      <Route path="/shared/:shareToken" element={<SharedWorkflow />} />
      <Route path="/shared/:shareToken/runs/:runId" element={<SharedRun />} />
      {/* Public too: the invitee may not have an account yet (spec/23). */}
      <Route path="/invite/:token" element={<InvitePage />} />
      {/* spec/32: signed approval links work signed-out, so no app shell. */}
      <Route path="/approve/:token" element={<ApprovePage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          {/* The URL decides the workspace (spec/22), so a link pasted between
              teammates opens in the right one. */}
          <Route path="/w/:slug" element={<WorkspaceRoute />} errorElement={<RouteErrorBoundary />}>
            <Route index element={<WorkspaceFallback />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="templates" element={<Templates />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="analytics/workflows/:workflowId" element={<Analytics />} />
            <Route path="runs" element={<Runs />} />
            <Route path="connections" element={<Connections />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="integrations/:id" element={<Integrations />} />
            <Route path="knowledge" element={<KnowledgeBase />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="status" element={<Status />} />
            <Route path="workflows/:id" element={<Builder />} />
            <Route path="workflows/:id/runs" element={<RunHistory />} />
            <Route path="runs/:runId" element={<RunMonitor />} />
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general" element={<GeneralTab />} />
              <Route path="members" element={<MembersTab />} />
              <Route path="api-keys" element={<ApiKeysTab />} />
              <Route path="usage" element={<UsageTab />} />
              <Route path="audit" element={<AuditTab />} />
              <Route path="profile" element={<ProfileTab />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
          {/* Dev mail is per user, not per workspace, so it sits outside /w/:slug. */}
          <Route path="/outbox" element={<Outbox />} />
          {/* The bell spans every workspace (spec/29), so it lives outside /w/:slug too. */}
          <Route path="/notifications" element={<Notifications />} />
        </Route>

        {/* Pre-workspace URLs: same page, last-used or personal workspace. */}
        <Route path="/dashboard" element={<LegacyRedirect />} />
        <Route path="/templates" element={<LegacyRedirect />} />
        <Route path="/analytics" element={<LegacyRedirect />} />
        <Route path="/workflows/:id" element={<LegacyRedirect />} />
        <Route path="/workflows/:id/runs" element={<LegacyRedirect />} />
        <Route path="/runs/:runId" element={<LegacyRedirect />} />
        <Route path="/" element={<LegacyRedirect to="/dashboard" />} />
        {/* A real 404 inside the app shell rather than a silent redirect (spec/36 §6). */}
        <Route element={<Layout />}>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Route>,
  ),
);

export default function App() {
  return <RouterProvider router={router} />;
}
