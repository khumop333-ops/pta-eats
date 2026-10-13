import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { User, Restaurant, MenuItem, Order, OrderItem } from '../types/index.js';

export interface DbShape {
  users: User[];
  restaurants: Restaurant[];
  menu_items: MenuItem[];
  orders: Order[];
  order_items: OrderItem[];
}

const defaultDb: DbShape = {
  users: [],
  restaurants: [],
  menu_items: [],
  orders: [],
  order_items: [],
};

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveDataPath(): string {
  const p = config.dataFile;
  if (path.isAbsolute(p)) return p;
  // server/ is cwd when running from server folder, but also handle root
  const fromServer = path.resolve(process.cwd(), p);
  const fromRoot = path.resolve(process.cwd(), '..', p);
  // If running from server dir, fromServer is correct
  // If running from root, we still want server/data/db.json
  if (fs.existsSync(fromServer) || process.cwd().endsWith('server')) {
    return fromServer;
  }
  if (process.cwd().endsWith('pta-eats')) {
    return path.resolve(process.cwd(), 'server', p.replace('./', ''));
  }
  return fromServer;
}

let dbPath = resolveDataPath();
let db: DbShape = { ...defaultDb };

export function loadDb(): DbShape {
  dbPath = resolveDataPath();
  ensureDir(dbPath);
  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf-8');
      const parsed = JSON.parse(raw);
      db = {
        users: parsed.users || [],
        restaurants: parsed.restaurants || [],
        menu_items: parsed.menu_items || [],
        orders: parsed.orders || [],
        order_items: parsed.order_items || [],
      };
    } catch (e) {
      console.error('Failed to load db file, using default', e);
      db = { ...defaultDb };
    }
  } else {
    db = { ...defaultDb };
    saveDb();
  }
  return db;
}

export function saveDb() {
  ensureDir(dbPath);
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

export function getDb(): DbShape {
  return db;
}

// Helpers
export function findUserByEmail(email: string) {
  return db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

export function findUserById(id: string) {
  return db.users.find(u => u.id === id);
}

export function nextRestaurantId(): number {
  const max = db.restaurants.reduce((m, r) => Math.max(m, r.id), 0);
  return max + 1;
}
