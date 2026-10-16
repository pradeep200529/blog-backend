import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const database = createDatabase(':memory:');
const app = createApp({ database, jwtSecret: 'test-secret-that-is-long-enough-for-tests' });
let token;

after(() => database.close());

test('serves the full-stack app and its static assets', async () => {
  const page = await request(app).get('/');
  const stylesheet = await request(app).get('/styles.css');
  const script = await request(app).get('/app.js');

  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.text, /Margin Notes/);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers['content-type'], /text\/css/);
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
});

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

  const detail = await request(app).get(`/api/blogs/${created.body.blog.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.blog.content, 'A longer story starts here.');
});

test('updates and deletes a blog only for its authenticated author', async () => {
  const created = await request(app)
    .post('/api/blogs')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Editable post', content: 'The original content.' });
  const blogId = created.body.blog.id;

  const unauthorizedUpdate = await request(app)
    .put(`/api/blogs/${blogId}`)
    .send({ title: 'Changed post', content: 'Changed content.' });
  const unauthorizedDelete = await request(app).delete(`/api/blogs/${blogId}`);
  assert.equal(unauthorizedUpdate.status, 401);
  assert.equal(unauthorizedDelete.status, 401);

  const otherUser = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Jordan Reader', email: 'jordan@example.com', password: 'another-horse-8' });
  const forbiddenUpdate = await request(app)
    .put(`/api/blogs/${blogId}`)
    .set('Authorization', `Bearer ${otherUser.body.token}`)
    .send({ title: 'Changed post', content: 'Changed content.' });
  const forbiddenDelete = await request(app)
    .delete(`/api/blogs/${blogId}`)
    .set('Authorization', `Bearer ${otherUser.body.token}`);
  assert.equal(forbiddenUpdate.status, 404);
  assert.equal(forbiddenDelete.status, 404);

  const updated = await request(app)
    .put(`/api/blogs/${blogId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Updated post', content: 'The revised content.' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.blog.title, 'Updated post');
  assert.equal(updated.body.blog.content, 'The revised content.');
  assert.equal(updated.body.blog.excerpt, 'The revised content.');

  const deleted = await request(app)
    .delete(`/api/blogs/${blogId}`)
    .set('Authorization', `Bearer ${token}`);
  const missing = await request(app).get(`/api/blogs/${blogId}`);
  assert.equal(deleted.status, 204);
  assert.equal(missing.status, 404);
});

test('serves a private profile and dashboard and revokes the token on logout', async () => {
  const unauthorizedProfile = await request(app).get('/api/auth/me');
  const unauthorizedDashboard = await request(app).get('/api/dashboard');
  assert.equal(unauthorizedProfile.status, 401);
  assert.equal(unauthorizedDashboard.status, 401);

  const profile = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.name, 'Avery Writer');
  assert.equal(profile.body.user.email, 'avery@example.com');
  assert.equal(Object.hasOwn(profile.body.user, 'password_hash'), false);

  const otherUser = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Morgan Reader', email: 'morgan@example.com', password: 'secure-reader-9' });
  const otherPost = await request(app)
    .post('/api/blogs')
    .set('Authorization', `Bearer ${otherUser.body.token}`)
    .send({ title: 'Another user post', content: 'This is not Avery\'s post.' });
  assert.equal(otherPost.status, 201);

  const dashboard = await request(app)
    .get('/api/dashboard')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.user.id, profile.body.user.id);
  assert.ok(dashboard.body.blogs.length > 0);
  assert.ok(dashboard.body.blogs.every((blog) => blog.author_id === profile.body.user.id));
  assert.equal(dashboard.body.blogs.some((blog) => blog.id === otherPost.body.blog.id), false);

  const logout = await request(app)
    .post('/api/auth/logout')
    .set('Authorization', `Bearer ${token}`);
  const afterLogout = await request(app)
    .get('/api/dashboard')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(logout.status, 204);
  assert.equal(afterLogout.status, 401);
});