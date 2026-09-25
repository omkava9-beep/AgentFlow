import { useCallback, useEffect, useState } from 'react';
import { listWorkflows } from '../api/workflows';

/** This workspace's workflows (spec/31 §4, §6): loops and sub-workflows never cross workspaces. */
export function useWorkspaceWorkflows() {
  const [workflows, setWorkflows] = useState(null);
  const reload = useCallback(() => listWorkflows().then(setWorkflows).catch(() => setWorkflows([])), []);
  useEffect(() => { reload(); }, [reload]);
  return { workflows, reload };
}
