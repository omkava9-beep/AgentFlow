import { Router } from 'express';

// Coming soon: webhook triggers (spec/13-webhook-trigger.md). Kept as a real,
// mounted router (returning 404) so the route shape already exists for the
// frontend's "Coming Soon" trigger panel to point at.
const router = Router();

router.post('/:token', (req, res) => {
  res.status(404).json({ error: 'Webhook triggers are coming soon' });
});

export default router;
