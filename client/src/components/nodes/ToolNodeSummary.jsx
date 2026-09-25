import { useIntegrationStore, connectionById } from '../../store/integrationStore';
import { normalizeToolConfig } from '../../utils/normalizeToolConfig';
import { findIntegration, predictMode } from '../../utils/integrationCatalog';
import IntegrationLogo from '../ui/IntegrationLogo';

const BADGE = {
  live: 'bg-success-subtle text-success-subtle-fg ring-1 ring-inset ring-success/25',
  sandbox: 'bg-bg-subtle text-muted ring-1 ring-inset ring-[rgb(var(--border))] dark:ring-white/10',
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
    return <div className="text-[12px] italic text-subtle">No integration selected</div>;
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
    <div className="flex items-center gap-1.5 text-[12px] leading-4 text-muted">
      <IntegrationLogo id={config.integration} name={integrationName} size="xs" />
      <span className="min-w-0 flex-1 truncate" title={`${integrationName} · ${actionName}`}>
        {integrationName} · {actionName}
      </span>
      {mode && (
        <span
          title={data.runMode ? `Ran ${mode}` : `Predicted: runs ${mode}`}
          className={`shrink-0 rounded px-1 text-[10px] font-semibold uppercase leading-4 tracking-wide ${BADGE[mode]} ${
            data.runMode ? '' : 'opacity-70'
          }`}
        >
          {mode}
        </span>
      )}
    </div>
  );
}
