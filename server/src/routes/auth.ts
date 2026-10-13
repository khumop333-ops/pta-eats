import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDb, findUserByEmail } from '../db/store.js';
import { signToken } from '../utils/jwt.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
  full_name: z.string().min(1).max(120).optional(),
  phone_number: z.string().max(30).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const db = getDb();
  const existing = findUserByEmail(parsed.data.email);
  if (existing) return res.status(400).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(parsed.data.password, 10);
  const now = new Date().toISOString();
  const newUser = {
    id: uuidv4(),
    email: parsed.data.email,
    password_hash: hash,
    full_name: parsed.data.full_name || null,
    phone_number: parsed.data.phone_number || null,
    role: 'user' as const,
    created_at: now,
  };

  db.users.push(newUser);
  saveDb();

  const token = signToken({ userId: newUser.id, email: newUser.email, role: newUser.role });
  res.status(201).json({
    user: { id: newUser.id, email: newUser.email, role: newUser.role, full_name: newUser.full_name },
    token,
  });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = findUserByEmail(parsed.data.email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  res.json({
    user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    token,
  });
});

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const user = db.users.find(u => u.id === req.user!.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    phone_number: user.phone_number,
  });
});

router.get('/users', authMiddleware, (req: AuthRequest, res) => {
  // admin only for now
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const db = getDb();
  const users = db.users.map(u => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    created_at: u.created_at,
  }));
  res.json(users);
});

export default router;
