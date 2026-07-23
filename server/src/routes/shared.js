import { Router } from 'express';

// Coming soon: read-only share links (spec/18-rbac.md).
const router = Router();

router.get('/:shareToken', (req, res) => {
  res.status(404).json({ error: 'Shared read-only links are coming soon' });
});

export default router;
