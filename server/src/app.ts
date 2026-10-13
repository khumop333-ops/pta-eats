import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import restaurantRoutes from './routes/restaurants.js';
import menuRoutes from './routes/menu.js';
import orderRoutes from './routes/orders.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payments.js';

const app = express();

app.use(cors({
  origin: [config.frontendUrl, 'http://localhost:8080', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));

// Serve frontend dist if exists (for production single-server deploy)
const possibleDistPaths = [
  path.resolve(process.cwd(), '../dist'),
  path.resolve(process.cwd(), 'dist'),
  path.resolve(process.cwd(), '../pta-eats/dist'),
];
for (const distPath of possibleDistPaths) {
  if (fs.existsSync(distPath)) {
    console.log(`Serving frontend from ${distPath}`);
    app.use(express.static(distPath));
    break;
  }
}

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'pta-eats-backend' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'pta-eats-backend' });
});

// API routes
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/menu-items', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);

// Also mount without /api prefix for compatibility
app.use('/restaurants', restaurantRoutes);
app.use('/orders', orderRoutes);

// SPA fallback - serve index.html for non-API routes if frontend dist exists
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
    return next();
  }
  const possibleIndexPaths = [
    path.resolve(process.cwd(), '../dist/index.html'),
    path.resolve(process.cwd(), 'dist/index.html'),
  ];
  for (const indexPath of possibleIndexPaths) {
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }
  // If no frontend build, return 404 JSON for API-like requests, otherwise let next handle
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
});

// 404 for remaining API routes
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return res.status(404).json({ error: 'Not found', path: req.path });
  }
  res.status(404).send('Not found - frontend not built. Run npm run build in root.');
});

// Error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
