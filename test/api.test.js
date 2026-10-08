import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const database = createDatabase(':memory:');
const app = createApp({ database, jwtSecret: 'test-secret-that-is-long-enough-for-tests' });
let token;

after(() => database.close());

test('registers a user and returns an access token', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Avery Writer', email: 'AVERY@example.com', password: 'correct-horse-7' });

  assert.equal(response.status, 201);
  assert.equal(response.body.user.email, 'avery@example.com');
  assert.ok(response.body.token);
  token = response.body.token;
});

test('rejects duplicate registrations and invalid passwords', async () => {
  const duplicate = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Avery', email: 'avery@example.com', password: 'correct-horse-7' });
  const invalid = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Casey', email: 'casey@example.com', password: 'short' });

  assert.equal(duplicate.status, 409);
  assert.equal(invalid.status, 400);
});

test('rejects empty registration bodies and malformed blog IDs', async () => {
  const emptyRegistration = await request(app).post('/api/auth/register');
  const malformedBlogId = await request(app).get('/api/blogs/not-a-number');

  assert.equal(emptyRegistration.status, 400);
  assert.equal(malformedBlogId.status, 404);
});

test('logs in with the registered credentials', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'avery@example.com', password: 'correct-horse-7' });

  assert.equal(response.status, 200);
  assert.ok(response.body.token);
});

test('requires authentication to create a blog and returns it publicly', async () => {
  const unauthorized = await request(app)
    .post('/api/blogs')
    .send({ title: 'A first post', content: 'A longer story starts here.' });
  assert.equal(unauthorized.status, 401);

  const created = await request(app)
    .post('/api/blogs')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'A first post', content: 'A longer story starts here.' });
  assert.equal(created.status, 201);
  assert.equal(created.body.blog.author_name, 'Avery Writer');

  const listed = await request(app).get('/api/blogs');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.blogs.length, 1);
  assert.equal(listed.body.blogs[0].title, 'A first post');
});