import { createClient } from '@supabase/supabase-js';

const blogFields = 'id,title,content,excerpt,created_at,author_id,users!blogs_author_id_fkey(id,name)';

function withAuthor(blog) {
  if (!blog) return null;
  const { users, ...fields } = blog;
  return {
    ...fields,
    author_id: users.id,
    author_name: users.name,
  };
}

export function createSupabaseDatabase({ url, serviceRoleKey }) {
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase URL and service-role key are required');
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async findUserByEmail(email) {
      const { data, error } = await client
        .from('users')
        .select('id,name,email,password_hash')
        .eq('email', email)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async createUser({ name, email, passwordHash }) {
      const { data, error } = await client
        .from('users')
        .insert({ name, email, password_hash: passwordHash })
        .select('id,name,email')
        .single();
      if (error) throw error;
      return data;
    },
    async listBlogs() {
      const { data, error } = await client
        .from('blogs')
        .select(blogFields)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data.map(withAuthor);
    },
    async getBlogById(id) {
      const { data, error } = await client
        .from('blogs')
        .select(blogFields)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return withAuthor(data);
    },
    async createBlog({ authorId, title, content, excerpt }) {
      const { data, error } = await client
        .from('blogs')
        .insert({ author_id: authorId, title, content, excerpt })
        .select('id')
        .single();
      if (error) throw error;
      return this.getBlogById(data.id);
    },
    close() {},
  };
}