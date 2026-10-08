import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDatabase(databasePath) {
  const resolvedPath = databasePath === ':memory:'
    ? databasePath
    : resolve(databasePath);

  if (resolvedPath !== ':memory:') {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return {
    async findUserByEmail(email) {
      return database.prepare(
        'SELECT id, name, email, password_hash FROM users WHERE email = ?',
      ).get(email) ?? null;
    },
    async createUser({ name, email, passwordHash }) {
      const result = database.prepare(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      ).run(name, email, passwordHash);
      return { id: Number(result.lastInsertRowid), name, email };
    },
    async listBlogs() {
      return database.prepare(`
        SELECT blogs.id, blogs.title, blogs.content, blogs.excerpt, blogs.created_at,
               users.id AS author_id, users.name AS author_name
        FROM blogs JOIN users ON users.id = blogs.author_id
        ORDER BY blogs.id DESC LIMIT 50
      `).all();
    },
    async getBlogById(id) {
      return database.prepare(`
        SELECT blogs.id, blogs.title, blogs.content, blogs.excerpt, blogs.created_at,
               users.id AS author_id, users.name AS author_name
        FROM blogs JOIN users ON users.id = blogs.author_id
        WHERE blogs.id = ?
      `).get(id) ?? null;
    },
    async createBlog({ authorId, title, content, excerpt }) {
      const result = database.prepare(
        'INSERT INTO blogs (author_id, title, content, excerpt) VALUES (?, ?, ?, ?)',
      ).run(authorId, title, content, excerpt);
      return this.getBlogById(Number(result.lastInsertRowid));
    },
    close() {
      database.close();
    },
  };
}