import { Route, Navigate, Outlet, createBrowserRouter, createRoutesFromElements, RouterProvider } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import GradientBackdrop from './components/GradientBackdrop';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Builder from './pages/Builder';
import RunMonitor from './pages/RunMonitor';
import RunHistory from './pages/RunHistory';
import Templates from './pages/Templates';
import Analytics from './pages/Analytics';
import SharedWorkflow from './pages/SharedWorkflow';

function Root() {
  return (
    <>
      <GradientBackdrop />
      <Outlet />
    </>
  );
}

// A data router (rather than <BrowserRouter>) because the Builder's
// unsaved-changes guard uses `useBlocker`, which only works with one.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Root />}>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      {/* Public on purpose: a share link has to work for someone who isn't
          signed in, so it sits outside ProtectedRoute. */}
      <Route path="/shared/:shareToken" element={<SharedWorkflow />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/workflows/:id" element={<Builder />} />
          <Route path="/workflows/:id/runs" element={<RunHistory />} />
          <Route path="/runs/:runId" element={<RunMonitor />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Route>,
  ),
);

export default function App() {
  return <RouterProvider router={router} />;
}
