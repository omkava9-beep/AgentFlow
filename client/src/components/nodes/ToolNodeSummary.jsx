import { useIntegrationStore, connectionById } from '../../store/integrationStore';
import { normalizeToolConfig } from '../../utils/normalizeToolConfig';
import { findIntegration, integrationIcon, predictMode } from '../../utils/integrationCatalog';

const BADGE = {
  live: 'bg-emerald-600 text-white',
  sandbox: 'bg-slate-500 text-white dark:bg-slate-600',
};

/**
 * The tool node's second line: integration icon, `Integration · Action`, and a
 * LIVE / SANDBOX badge (spec/26 §8). In the builder the badge is *predicted*
 * from the config; on a run view it shows the node result's *actual* mode
 * (`data.runMode`), and nothing until the node has run.
 */
export default function ToolNodeSummary({ data }) {
  const catalog = useIntegrationStore((s) => s.catalog);
  const connections = useIntegrationStore((s) => s.connections);
  const liveEnabled = useIntegrationStore((s) => s.liveEnabled);

  const config = normalizeToolConfig(data.config || {});
  if (!config.integration) {
    return <div className="mt-0.5 text-xs italic text-slate-400">No integration selected</div>;
  }

  const integration = findIntegration(catalog, config.integration);
  const action = integration?.actions?.find((a) => a.id === config.action) || null;
  const integrationName = integration?.name || config.integration;
  const actionName = action?.name || config.action || '—';

  const onRunView = data.runStatus !== undefined;
  let mode = data.runMode || null;
  if (!mode && !onRunView && integration && action) {
    const connection =
      config.connectionId && config.connectionId !== 'sandbox' ? connectionById(connections, config.connectionId) : null;
    const predicted = predictMode({ integration, action, connectionId: config.connectionId, connection, liveEnabled });
    mode = predicted === 'unknown' ? null : predicted;
  }

  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span>{integrationIcon(integration?.icon || config.integration)}</span>
      <span className="max-w-[170px] truncate" title={`${integrationName} · ${actionName}`}>
        {integrationName} · {actionName}
      </span>
      {mode && (
        <span
          title={data.runMode ? `Ran ${mode}` : `Predicted: runs ${mode}`}
          className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${BADGE[mode]} ${
            data.runMode ? '' : 'opacity-70'
          }`}
        >
          {mode}
        </span>
      )}
    </div>
  );
}
