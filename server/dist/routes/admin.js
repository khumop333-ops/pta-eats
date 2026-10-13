import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDb, findUserByEmail } from '../db/store.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
const router = Router();
const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    full_name: z.string().min(1).max(120).optional(),
    role: z.enum(['deliverer', 'restaurant_owner']),
    restaurant_id: z.number().optional(),
});
router.post('/users', authMiddleware, requireRole('admin'), async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    if (findUserByEmail(parsed.data.email)) {
        return res.status(400).json({ error: 'Email already exists' });
    }
    const hash = await bcrypt.hash(parsed.data.password, 10);
    const now = new Date().toISOString();
    const userId = uuidv4();
    const newUser = {
        id: userId,
        email: parsed.data.email,
        password_hash: hash,
        full_name: parsed.data.full_name || null,
        phone_number: null,
        role: parsed.data.role,
        created_at: now,
    };
    db.users.push(newUser);
    if (parsed.data.role === 'restaurant_owner' && parsed.data.restaurant_id) {
        const rest = db.restaurants.find(r => r.id === parsed.data.restaurant_id);
        if (rest) {
            rest.owner_id = userId;
            rest.updated_at = now;
        }
    }
    saveDb();
    res.status(201).json({ user_id: userId });
});
router.get('/stats', authMiddleware, requireRole('admin'), (_req, res) => {
    const db = getDb();
    res.json({
        totalOrders: db.orders.length,
        totalRestaurants: db.restaurants.length,
        totalMenuItems: db.menu_items.length,
        totalUsers: db.users.length,
        ordersByStatus: db.orders.reduce((acc, o) => {
            acc[o.status] = (acc[o.status] || 0) + 1;
            return acc;
        }, {}),
        revenue: db.orders.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + o.total, 0),
    });
});
export default router;
