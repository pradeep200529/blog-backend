import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [salt, storedKey] = storedHash.split(':');
  if (!salt || !storedKey) return false;

  const key = await scrypt(password, salt, 64);
  const expected = Buffer.from(storedKey, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export function createToken(userId, secret) {
  return jwt.sign({}, secret, { subject: String(userId), expiresIn: '2h' });
}

export function requireAuth(secret) {
  return (request, response, next) => {
    const authorization = request.get('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : null;

    if (!token) {
      return response.status(401).json({ error: 'Authentication required' });
    }

    try {
      const payload = jwt.verify(token, secret);
      request.user = { id: Number(payload.sub) };
      return next();
    } catch {
      return response.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}