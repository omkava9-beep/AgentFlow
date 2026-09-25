/** Pure helpers for the MCP connection form (spec/37 §1), kept apart from the component. */

/** Splits the MCP form into spec/25's `{ config, credentials }` (only the auth header is secret). */
export function mcpPayload(values, connection) {
  const transport = values.transport || 'http';
  const config = { transport };
  const credentials = {};
  if (transport === 'http') {
    config.url = (values.url || '').trim();
    if (values.headerName?.trim()) config.headerName = values.headerName.trim();
    else if (connection?.config?.headerName) config.headerName = null;
    if (values.authHeader === null) credentials.authHeader = null;
    else if (values.authHeader) credentials.authHeader = values.authHeader;
    if (connection?.config?.allowlistId) config.allowlistId = null;
  } else {
    config.allowlistId = values.allowlistId || '';
    if (connection?.config?.url) config.url = null;
    if (connection?.config?.headerName) config.headerName = null;
    if (connection?.credentialHints?.authHeader) credentials.authHeader = null;
  }
  return { config, credentials };
}

/** Why the form can't be saved yet, or null. */
export function mcpFormError(values) {
  const transport = values.transport || 'http';
  if (transport === 'http') {
    const url = (values.url || '').trim();
    if (!url) return 'Enter the server URL.';
    if (!/^https?:\/\//i.test(url)) return 'The URL must start with http:// or https://.';
  } else if (!values.allowlistId) {
    return 'Pick a local server from the allowlist.';
  }
  return null;
}
