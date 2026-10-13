import { Router } from 'express';
import { z } from 'zod';
import { getDb, saveDb } from '../db/store.js';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';
const router = Router();
const createPaymentSchema = z.object({
    orderId: z.string().uuid(),
    returnOrigin: z.string().url(),
});
function mockPaylinkUrl(orderId, origin) {
    // In production this would call iKhokha API
    // For dev we return a URL that simulates payment and redirects to success
    return `${origin}/order-confirmation/${orderId}?payment=success&mock=true`;
}
// Mirrors Supabase edge function create-ikhokha-payment
router.post('/create-ikhokha-payment', authMiddleware, async (req, res) => {
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const order = db.orders.find(o => o.id === parsed.data.orderId);
    if (!order)
        return res.status(404).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id)
        return res.status(403).json({ error: 'Forbidden' });
    if (order.payment_status === 'paid')
        return res.status(400).json({ error: 'Order already paid' });
    // If iKhokha creds are configured, attempt real call, otherwise mock
    const { appId, appSecret } = config.ikhokha;
    if (appId && appSecret) {
        // Real iKhokha integration would go here - for now we still mock but log
        console.log('iKhokha creds present, would call real API for order', order.id);
    }
    // Update order to pending card
    order.payment_method = 'card';
    order.payment_status = 'pending';
    order.payment_reference = `roma-${order.id}`.slice(0, 32);
    order.updated_at = new Date().toISOString();
    saveDb();
    const paylinkUrl = mockPaylinkUrl(order.id, parsed.data.returnOrigin);
    res.json({ paylinkUrl, mock: true, message: 'Mock payment link - in production this would be iKhokha URL' });
});
// Webhook - mirrors ikhokha-webhook
router.post('/ikhokha-webhook', (req, res) => {
    const body = req.body;
    console.log('Webhook received:', body);
    // Support both our mock and real iKhokha payloads
    const externalId = body.externalTransactionID || body.externalTransactionId || body.externalEntityID || '';
    const orderId = externalId.startsWith('roma-') ? externalId.slice(5) : body.orderId || '';
    if (!orderId) {
        return res.status(400).json({ error: 'Unknown transaction' });
    }
    const db = getDb();
    const order = db.orders.find(o => o.id === orderId);
    if (!order)
        return res.status(400).json({ error: 'Order not found' });
    const status = String(body.status || body.transactionStatus || '').toUpperCase();
    const paid = ['SUCCESS', 'COMPLETE', 'COMPLETED', 'PAID', 'SETTLED'].includes(status);
    if (paid) {
        order.payment_status = 'paid';
        order.paid_at = new Date().toISOString();
        order.updated_at = new Date().toISOString();
        saveDb();
    }
    res.json({ received: true, orderId, paid });
});
// Simple endpoint to simulate payment success for dev
router.post('/mock-confirm/:orderId', authMiddleware, (req, res) => {
    const db = getDb();
    const order = db.orders.find(o => o.id === req.params.orderId);
    if (!order)
        return res.status(404).json({ error: 'Not found' });
    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    order.payment_status = 'paid';
    order.paid_at = new Date().toISOString();
    order.updated_at = new Date().toISOString();
    saveDb();
    res.json({ success: true, order });
});
export default router;
