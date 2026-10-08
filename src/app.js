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
        result = await database.createUser({ name, email, passwordHash });
      } catch (error) {
        if ((error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE constraint failed'))
          || error.code === '23505') {
          return response.status(409).json({ error: 'An account with this email already exists' });
        }
        throw error;
      }

      const user = { id: result.id, name: result.name, email: result.email };
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
      const userRecord = await database.findUserByEmail(email);

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

  app.get('/api/blogs', async (request, response, next) => {
    try {
      const blogs = await database.listBlogs();
      return response.json({ blogs });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/blogs/:id', async (request, response, next) => {
    const id = request.params.id;
    if (!/^(?:[1-9]\d*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id)) {
      return response.status(404).json({ error: 'Blog post not found' });
    }

    try {
      const blog = await database.getBlogById(/^\d+$/.test(id) ? Number(id) : id);
      if (!blog) return response.status(404).json({ error: 'Blog post not found' });
      return response.json({ blog });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/blogs', requireAuth(jwtSecret), async (request, response, next) => {
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
    try {
      const blog = await database.createBlog({
        authorId: request.user.id,
        title,
        content,
        excerpt,
      });
      return response.status(201).json({ blog });
    } catch (error) {
      return next(error);
    }
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