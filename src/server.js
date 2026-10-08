import 'dotenv/config';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { createSupabaseDatabase } from './supabase-db.js';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('Set JWT_SECRET to a random value of at least 32 characters');
}

const hasSupabaseConfig = process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY;
const database = hasSupabaseConfig
  ? createSupabaseDatabase({
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
  : createDatabase(process.env.DATABASE_PATH || './data/blog.sqlite');
const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const app = createApp({ database, jwtSecret, clientOrigins });
const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
  console.log(`Blog API listening on http://localhost:${port}`);
});

function shutDown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);