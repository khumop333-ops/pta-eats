import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-pta-eats-please-change-in-prod',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8080',
  ikhokha: {
    appId: process.env.IKHOKHA_APP_ID || '',
    appSecret: process.env.IKHOKHA_APP_SECRET || '',
    mode: process.env.IKHOKHA_MODE || 'test',
  },
  dataFile: process.env.DATA_FILE || './data/db.json',
};
