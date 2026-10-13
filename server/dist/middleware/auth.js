import { verifyToken } from '../utils/jwt.js';
import { getDb } from '../db/store.js';
export function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    const token = header.replace('Bearer ', '');
    try {
        const payload = verifyToken(token);
        const db = getDb();
        const user = db.users.find(u => u.id === payload.userId);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: user not found' });
        }
        req.user = { id: user.id, email: user.email, role: user.role };
        next();
    }
    catch (e) {
        return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
}
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: `Forbidden: requires ${roles.join(' or ')}` });
        }
        next();
    };
}
export function optionalAuth(req, _res, next) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        try {
            const token = header.replace('Bearer ', '');
            const payload = verifyToken(token);
            req.user = { id: payload.userId, email: payload.email, role: payload.role };
        }
        catch {
            // ignore
        }
    }
    next();
}
