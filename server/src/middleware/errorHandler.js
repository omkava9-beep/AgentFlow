export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, req, res, next) {
  console.error(err);

  // express.json() rejects a malformed body with a SyntaxError carrying status
  // 400 but no public message, which would otherwise surface as a bare 500-style
  // "Internal server error" on what is really a caller mistake.
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  const status = err.status || 500;
  res.status(status).json({ error: err.publicMessage || 'Internal server error' });
}

export class HttpError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}
