import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { hashPassword, requireAuth, verifyPassword } from './auth.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createApp({ database, jwtSecret, clientOrigins = [] }) {
  if (!database || !jwtSecret) {
    throw new Error('A database and JWT secret are required');
  }

  const app = express();
  const origins = new Set(clientOrigins);

  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.size === 0 || origins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed by CORS'));
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use((request, response, next) => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      request.body = {};
    }
    next();
  });

  app.get('/api/health', (request, response) => {
    response.json({ status: 'ok' });
  });

  app.post('/api/auth/register', async (request, response, next) => {
    try {
      const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
      const email = typeof request.body.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
      const password = request.body.password;

      if (!name || name.length > 80 || !emailPattern.test(email) || email.length > 254) {
        return response.status(400).json({ error: 'Enter a valid name and email address' });
      }
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return response.status(400).json({ error: 'Password must be 8 to 128 characters' });
      }

      const passwordHash = await hashPassword(password);
      let result;
      try {
        result = database.prepare(
          'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
        ).run(name, email, passwordHash);
      } catch (error) {
        if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE constraint failed')) {
          return response.status(409).json({ error: 'An account with this email already exists' });
        }
        throw error;
      }

      const user = { id: Number(result.lastInsertRowid), name, email };
      return response.status(201).json({
        user,
        token: jwt.sign({}, jwtSecret, { subject: String(user.id), expiresIn: '2h' }),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/login', async (request, response, next) => {
    try {
      const email = typeof request.body.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
      const password = request.body.password;
      const userRecord = database.prepare(
        'SELECT id, name, email, password_hash FROM users WHERE email = ?',
      ).get(email);

      if (!userRecord || typeof password !== 'string'
        || !(await verifyPassword(password, userRecord.password_hash))) {
        return response.status(401).json({ error: 'Email or password is incorrect' });
      }

      const user = { id: userRecord.id, name: userRecord.name, email: userRecord.email };
      return response.json({
        user,
        token: jwt.sign({}, jwtSecret, { subject: String(user.id), expiresIn: '2h' }),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/blogs', (request, response) => {
    const blogs = database.prepare(`
      SELECT blogs.id, blogs.title, blogs.content, blogs.excerpt, blogs.created_at,
             users.id AS author_id, users.name AS author_name
      FROM blogs JOIN users ON users.id = blogs.author_id
      ORDER BY blogs.id DESC LIMIT 50
    `).all();
    response.json({ blogs });
  });

  app.get('/api/blogs/:id', (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return response.status(404).json({ error: 'Blog post not found' });
    }

    const blog = database.prepare(`
      SELECT blogs.id, blogs.title, blogs.content, blogs.excerpt, blogs.created_at,
             users.id AS author_id, users.name AS author_name
      FROM blogs JOIN users ON users.id = blogs.author_id
      WHERE blogs.id = ?
    `).get(id);

    if (!blog) return response.status(404).json({ error: 'Blog post not found' });
    return response.json({ blog });
  });

  app.post('/api/blogs', requireAuth(jwtSecret), (request, response) => {
    const title = typeof request.body.title === 'string' ? request.body.title.trim() : '';
    const content = typeof request.body.content === 'string' ? request.body.content.trim() : '';
    const suppliedExcerpt = typeof request.body.excerpt === 'string'
      ? request.body.excerpt.trim()
      : '';

    if (!title || title.length > 160 || !content || content.length > 50000) {
      return response.status(400).json({ error: 'Title and content are required and must be within the size limits' });
    }
    if (suppliedExcerpt.length > 240) {
      return response.status(400).json({ error: 'Excerpt must be 240 characters or fewer' });
    }

    const excerpt = suppliedExcerpt || content.slice(0, 240);
    const result = database.prepare(
      'INSERT INTO blogs (author_id, title, content, excerpt) VALUES (?, ?, ?, ?)',
    ).run(request.user.id, title, content, excerpt);
    const blog = database.prepare(`
      SELECT blogs.id, blogs.title, blogs.content, blogs.excerpt, blogs.created_at,
             users.id AS author_id, users.name AS author_name
      FROM blogs JOIN users ON users.id = blogs.author_id
      WHERE blogs.id = ?
    `).get(Number(result.lastInsertRowid));

    return response.status(201).json({ blog });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error.message === 'Origin is not allowed by CORS') {
      return response.status(403).json({ error: error.message });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({ error: 'Request body must be valid JSON' });
    }
    console.error(error);
    return response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}