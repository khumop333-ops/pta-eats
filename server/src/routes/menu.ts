import { Router } from 'express';
import { z } from 'zod';
import { getDb, saveDb } from '../db/store.js';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const menuSchema = z.object({
  restaurant_id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  price: z.number().positive(),
  category: z.string().min(1).max(80),
});

router.get('/', (req, res) => {
  const db = getDb();
  const restaurantId = req.query.restaurant_id ? Number(req.query.restaurant_id) : null;
  if (restaurantId) {
    const items = db.menu_items.filter(m => m.restaurant_id === restaurantId);
    return res.json(items);
  }
  res.json(db.menu_items);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const item = db.menu_items.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Menu item not found' });
  res.json(item);
});

router.post('/', authMiddleware, requireRole('admin', 'restaurant_owner'), (req: AuthRequest, res) => {
  const parsed = menuSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const db = getDb();
  const restaurant = db.restaurants.find(r => r.id === parsed.data.restaurant_id);
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  if (req.user!.role === 'restaurant_owner' && restaurant.owner_id !== req.user!.id) {
    return res.status(403).json({ error: 'Not your restaurant' });
  }

  const now = new Date().toISOString();
  const newItem = {
    id: uuidv4(),
    restaurant_id: parsed.data.restaurant_id,
    name: parsed.data.name,
    description: parsed.data.description,
    price: parsed.data.price,
    category: parsed.data.category,
    created_at: now,
    updated_at: now,
  };
  db.menu_items.push(newItem);
  saveDb();
  res.status(201).json(newItem);
});

router.put('/:id', authMiddleware, requireRole('admin', 'restaurant_owner'), (req: AuthRequest, res) => {
  const db = getDb();
  const idx = db.menu_items.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const restaurant = db.restaurants.find(r => r.id === db.menu_items[idx].restaurant_id);
  if (req.user!.role === 'restaurant_owner' && restaurant?.owner_id !== req.user!.id) {
    return res.status(403).json({ error: 'Not your restaurant' });
  }

  const parsed = menuSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updated = {
    ...db.menu_items[idx],
    ...parsed.data,
    updated_at: new Date().toISOString(),
  };
  db.menu_items[idx] = updated as any;
  saveDb();
  res.json(updated);
});

router.delete('/:id', authMiddleware, requireRole('admin', 'restaurant_owner'), (req: AuthRequest, res) => {
  const db = getDb();
  const idx = db.menu_items.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const restaurant = db.restaurants.find(r => r.id === db.menu_items[idx].restaurant_id);
  if (req.user!.role === 'restaurant_owner' && restaurant?.owner_id !== req.user!.id) {
    return res.status(403).json({ error: 'Not your restaurant' });
  }

  db.menu_items.splice(idx, 1);
  saveDb();
  res.json({ success: true });
});

export default router;
