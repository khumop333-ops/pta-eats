import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDb } from '../db/store.js';
import { authMiddleware, requireRole, AuthRequest, optionalAuth } from '../middleware/auth.js';

const router = Router();

const DELIVERY_FEE = 15;

const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(30),
  address: z.string().trim().min(5).max(300),
  instructions: z.string().trim().max(500).optional().nullable(),
  paymentMethod: z.enum(['card', 'cash']),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
  })).min(1).max(50),
});

// Create order - mirrors Supabase edge function create-order
router.post('/', authMiddleware, (req: AuthRequest, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const db = getDb();
  const body = parsed.data;

  // Validate menu items exist and belong to same restaurant
  const ids = [...new Set(body.items.map(i => i.menuItemId))];
  const menuItems = db.menu_items.filter(m => ids.includes(m.id));

  if (menuItems.length !== ids.length) {
    return res.status(400).json({ error: 'Some items are no longer available' });
  }

  const restaurantIds = [...new Set(menuItems.map(m => m.restaurant_id))];
  if (restaurantIds.length !== 1) {
    return res.status(400).json({ error: 'All items must come from the same restaurant' });
  }

  const restaurantId = restaurantIds[0];
  const restaurant = db.restaurants.find(r => r.id === restaurantId);
  if (!restaurant) return res.status(400).json({ error: 'Restaurant not found' });

  const priceById = new Map(menuItems.map(m => [m.id, m]));
  const orderItems = body.items.map(i => {
    const m = priceById.get(i.menuItemId)!;
    return {
      item_name: m.name,
      item_price: Number(m.price),
      quantity: i.quantity,
    };
  });

  const subtotal = orderItems.reduce((sum, i) => sum + i.item_price * i.quantity, 0);
  const roundedSubtotal = Math.round(subtotal * 100) / 100;
  const total = Math.round((roundedSubtotal + DELIVERY_FEE) * 100) / 100;

  const now = new Date().toISOString();
  const orderId = uuidv4();

  const order = {
    id: orderId,
    customer_name: body.customerName,
    phone_number: body.phone,
    delivery_address: body.address,
    special_instructions: body.instructions || null,
    restaurant_id: restaurant.id,
    restaurant_name: restaurant.name,
    subtotal: roundedSubtotal,
    delivery_fee: DELIVERY_FEE,
    total,
    status: 'New',
    user_id: req.user!.id,
    deliverer_id: null,
    payment_method: body.paymentMethod,
    payment_status: 'pending',
    payment_reference: null,
    paid_at: null,
    created_at: now,
    updated_at: now,
  };

  db.orders.push(order);

  for (const oi of orderItems) {
    db.order_items.push({
      id: uuidv4(),
      order_id: orderId,
      item_name: oi.item_name,
      item_price: oi.item_price,
      quantity: oi.quantity,
      created_at: now,
    });
  }

  saveDb();
  res.status(201).json({ orderId, subtotal: roundedSubtotal, deliveryFee: DELIVERY_FEE, total });
});

// Get orders - with role filtering
router.get('/', authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const user = req.user!;
  let orders = db.orders;

  if (user.role === 'user') {
    orders = orders.filter(o => o.user_id === user.id);
  } else if (user.role === 'restaurant_owner') {
    const ownedRestaurantIds = db.restaurants.filter(r => r.owner_id === user.id).map(r => r.id);
    orders = orders.filter(o => ownedRestaurantIds.includes(o.restaurant_id));
  } else if (user.role === 'deliverer') {
    // deliverer sees all orders? or assigned? For now all
    // could filter by status ready etc
  }
  // admin sees all

  // Enrich with order_items
  const enriched = orders
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(o => ({
      ...o,
      order_items: db.order_items.filter(oi => oi.order_id === o.id),
    }));

  res.json(enriched);
});

router.get('/:id', authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const user = req.user!;
  if (user.role === 'user' && order.user_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (user.role === 'restaurant_owner') {
    const owned = db.restaurants.find(r => r.id === order.restaurant_id && r.owner_id === user.id);
    if (!owned) return res.status(403).json({ error: 'Not your restaurant order' });
  }

  const items = db.order_items.filter(oi => oi.order_id === order.id);
  res.json({ ...order, order_items: items });
});

router.patch('/:id/status', authMiddleware, requireRole('admin', 'deliverer', 'restaurant_owner'), (req: AuthRequest, res) => {
  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { status } = req.body;
  if (!status || typeof status !== 'string') return res.status(400).json({ error: 'Invalid status' });

  // Owner can only update own restaurant orders
  if (req.user!.role === 'restaurant_owner') {
    const owned = db.restaurants.find(r => r.id === order.restaurant_id && r.owner_id === req.user!.id);
    if (!owned) return res.status(403).json({ error: 'Not your restaurant' });
  }

  order.status = status;
  order.updated_at = new Date().toISOString();

  // Auto mark cash as paid when delivered
  if (status === 'Delivered' && order.payment_method === 'cash' && order.payment_status !== 'paid') {
    order.payment_status = 'paid';
    order.paid_at = new Date().toISOString();
  }

  saveDb();
  res.json(order);
});

router.post('/:id/mark-paid', authMiddleware, requireRole('admin'), (req, res) => {
  const db = getDb();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  order.payment_status = 'paid';
  order.paid_at = new Date().toISOString();
  order.updated_at = new Date().toISOString();
  saveDb();
  res.json(order);
});

export default router;
