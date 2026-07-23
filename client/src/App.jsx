import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import GradientBackdrop from './components/GradientBackdrop';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Builder from './pages/Builder';
import RunMonitor from './pages/RunMonitor';
import RunHistory from './pages/RunHistory';

export default function App() {
  return (
    <>
    <GradientBackdrop />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/workflows/:id" element={<Builder />} />
          <Route path="/workflows/:id/runs" element={<RunHistory />} />
          <Route path="/runs/:runId" element={<RunMonitor />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </>
  );
}
