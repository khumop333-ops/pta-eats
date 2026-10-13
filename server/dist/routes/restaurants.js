import { Router } from 'express';
import { z } from 'zod';
import { getDb, saveDb, nextRestaurantId } from '../db/store.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
const router = Router();
const restaurantSchema = z.object({
    name: z.string().min(1).max(120),
    cuisine: z.string().min(1).max(80),
    rating: z.number().min(0).max(5).optional().default(4.5),
    delivery_time: z.string().min(1).max(50).optional().default('20-30 min'),
    image_url: z.string().min(1).max(500).optional().default('/placeholder.svg'),
    owner_id: z.string().nullable().optional(),
});
router.get('/', (_req, res) => {
    const db = getDb();
    res.json(db.restaurants);
});
router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id))
        return res.status(400).json({ error: 'Invalid id' });
    const db = getDb();
    const restaurant = db.restaurants.find(r => r.id === id);
    if (!restaurant)
        return res.status(404).json({ error: 'Restaurant not found' });
    const menu = db.menu_items.filter(m => m.restaurant_id === id);
    res.json({ ...restaurant, menu });
});
router.get('/:id/menu', (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id))
        return res.status(400).json({ error: 'Invalid id' });
    const db = getDb();
    const items = db.menu_items.filter(m => m.restaurant_id === id);
    res.json(items);
});
// Admin only
router.post('/', authMiddleware, requireRole('admin'), (req, res) => {
    const parsed = restaurantSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const newId = nextRestaurantId();
    const now = new Date().toISOString();
    const newRestaurant = {
        id: newId,
        name: parsed.data.name,
        cuisine: parsed.data.cuisine,
        rating: parsed.data.rating ?? 4.5,
        delivery_time: parsed.data.delivery_time ?? '20-30 min',
        image_url: parsed.data.image_url ?? '/placeholder.svg',
        owner_id: parsed.data.owner_id ?? null,
        created_at: now,
        updated_at: now,
    };
    db.restaurants.push(newRestaurant);
    saveDb();
    res.status(201).json(newRestaurant);
});
router.put('/:id', authMiddleware, requireRole('admin', 'restaurant_owner'), (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id))
        return res.status(400).json({ error: 'Invalid id' });
    const db = getDb();
    const idx = db.restaurants.findIndex(r => r.id === id);
    if (idx === -1)
        return res.status(404).json({ error: 'Not found' });
    // Owner can only update own restaurant
    if (req.user.role === 'restaurant_owner' && db.restaurants[idx].owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Not your restaurant' });
    }
    const parsed = restaurantSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const updated = {
        ...db.restaurants[idx],
        ...parsed.data,
        updated_at: new Date().toISOString(),
    };
    db.restaurants[idx] = updated;
    saveDb();
    res.json(updated);
});
router.delete('/:id', authMiddleware, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const idx = db.restaurants.findIndex(r => r.id === id);
    if (idx === -1)
        return res.status(404).json({ error: 'Not found' });
    db.restaurants.splice(idx, 1);
    // cascade delete menu items
    db.menu_items = db.menu_items.filter(m => m.restaurant_id !== id);
    saveDb();
    res.json({ success: true });
});
export default router;
