import express, { Router } from 'express';
import { receiveInbound } from '../controllers/inboundController.js';

// Mounted BEFORE express.json() (spec/27 §5): providers sign the exact bytes
// they send, and a JSON parser would throw those bytes away. Outside requireAuth
// - the token in the path is the credential, like a workflow webhook's (spec/13).
const router = Router({ mergeParams: true });

router.post('/:integration/:inboundToken', express.raw({ type: () => true, limit: '1mb' }), receiveInbound);

export default router;
