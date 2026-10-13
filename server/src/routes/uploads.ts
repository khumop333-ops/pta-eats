import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

const uploadDir = path.resolve(process.cwd(), 'uploads', 'restaurant-images');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// Serve uploaded images statically
// This will be mounted at /uploads

router.post('/restaurant-image', authMiddleware, requireRole('admin', 'restaurant_owner'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const publicUrl = `/uploads/restaurant-images/${req.file.filename}`;
  res.json({ url: publicUrl, publicUrl });
});

// For compatibility with frontend expecting publicUrl
router.post('/restaurant-images', authMiddleware, requireRole('admin', 'restaurant_owner'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const publicUrl = `/uploads/restaurant-images/${req.file.filename}`;
  res.json({ url: publicUrl, publicUrl });
});

export default router;
