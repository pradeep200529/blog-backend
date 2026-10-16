const state = {
  token: sessionStorage.getItem('blogToken'),
  user: null,
  view: 'public',
  posts: [],
  editingId: null,
};

const elements = {
  pageTitle: document.querySelector('#pageTitle'),
  feedEyebrow: document.querySelector('#feedEyebrow'),
  feedSubtitle: document.querySelector('#feedSubtitle'),
  postList: document.querySelector('#postList'),
  notice: document.querySelector('#notice'),
  accountContent: document.querySelector('#accountContent'),
  apiStatus: document.querySelector('#apiStatus'),
  authDialog: document.querySelector('#authDialog'),
  authForm: document.querySelector('#authForm'),
  authTitle: document.querySelector('#authTitle'),
  authDescription: document.querySelector('#authDescription'),
  authError: document.querySelector('#authError'),
  authSubmit: document.querySelector('#authSubmit'),
  authSwitchPrompt: document.querySelector('#authSwitchPrompt'),
  authSwitchButton: document.querySelector('#authSwitchButton'),
  nameField: document.querySelector('#nameField'),
  editorDialog: document.querySelector('#editorDialog'),
  editorForm: document.querySelector('#editorForm'),
  editorTitle: document.querySelector('#editorTitle'),
  editorSubmit: document.querySelector('#editorSubmit'),
  editorError: document.querySelector('#editorError'),
  postDialog: document.querySelector('#postDialog'),
  detailMeta: document.querySelector('#detailMeta'),
  detailTitle: document.querySelector('#detailTitle'),
  detailExcerpt: document.querySelector('#detailExcerpt'),
  detailContent: document.querySelector('#detailContent'),
};

let authMode = 'login';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function setNotice(message = '') {
  elements.notice.textContent = message;
  elements.notice.hidden = !message;
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'M';
}

function renderAccount() {
  const signedIn = Boolean(state.user && state.token);
  document.querySelector('#dashboardButton').hidden = !signedIn;
  document.querySelector('#logoutButton').hidden = !signedIn;
  document.querySelector('#signInButton').hidden = signedIn;
  document.querySelector('#newPostButton').hidden = !signedIn || state.view !== 'dashboard';

  if (!signedIn) {
    elements.accountContent.innerHTML = `
      <h2>A place for your words.</h2>
      <p class="side-copy">Sign in to write and keep your posts together.</p>
      <button class="text-button" id="sideSignInButton" type="button">Sign in to your account <span aria-hidden="true">&rarr;</span></button>`;
    document.querySelector('#sideSignInButton').addEventListener('click', openAuth);
    return;
  }

  elements.accountContent.innerHTML = `
    <div class="profile-head">
      <span class="avatar" aria-hidden="true">${escapeHtml(initials(state.user.name))}</span>
      <span><strong class="profile-name">${escapeHtml(state.user.name)}</strong><small class="profile-email">${escapeHtml(state.user.email)}</small></span>
    </div>
    <button class="text-button dashboard-shortcut" id="sideDashboardButton" type="button">Open my dashboard <span aria-hidden="true">&rarr;</span></button>`;
  document.querySelector('#sideDashboardButton').addEventListener('click', showDashboard);
}

function renderPosts() {
  elements.postList.setAttribute('aria-busy', 'false');
  if (!state.posts.length) {
    const isDashboard = state.view === 'dashboard';
    elements.postList.innerHTML = `
      <div class="empty-state">
        <h2>${isDashboard ? 'Your first post starts here.' : 'A quiet page.'}</h2>
        <p>${isDashboard ? 'Write something worth keeping.' : 'There are no posts to read just yet.'}</p>
      </div>`;
    return;
  }

  elements.postList.innerHTML = state.posts.map((post, index) => `
    <article class="post-item" style="animation-delay:${Math.min(index, 5) * 45}ms">
      <div class="post-kicker"><span class="status-dot is-online" aria-hidden="true"></span>${escapeHtml(formatDate(post.created_at))}<span aria-hidden="true">/</span>${escapeHtml(post.author_name || state.user?.name || 'Writer')}</div>
      <button class="post-title" type="button" data-open-post="${escapeHtml(post.id)}">${escapeHtml(post.title)}</button>
      <p class="post-excerpt">${escapeHtml(post.excerpt || '')}</p>
      <p class="post-byline">${escapeHtml((post.content || '').trim().split(/\s+/).filter(Boolean).length)} words</p>
      ${state.view === 'dashboard' ? `<div class="post-actions"><button class="small-action" type="button" data-edit-post="${escapeHtml(post.id)}">Edit</button><button class="small-action danger" type="button" data-delete-post="${escapeHtml(post.id)}">Delete</button></div>` : ''}
    </article>`).join('');
}

function setView(view) {
  state.view = view;
  const dashboard = view === 'dashboard';
  elements.pageTitle.textContent = dashboard ? 'Your dashboard' : 'Recent writing';
  elements.feedEyebrow.textContent = dashboard ? 'YOUR PRIVATE JOURNAL' : 'THE PUBLIC JOURNAL';
  elements.feedSubtitle.textContent = dashboard
    ? 'A home for everything you have written.'
    : 'A collection of notes, ideas, and stories.';
  document.querySelector('#exploreButton').classList.toggle('is-active', !dashboard);
  document.querySelector('#dashboardButton').classList.toggle('is-active', dashboard);
  renderAccount();
}

async function loadPublic() {
  setView('public');
  elements.postList.setAttribute('aria-busy', 'true');
  elements.postList.innerHTML = '<div class="loading-line"><span></span>Loading posts</div>';
  try {
    const { blogs } = await api('/api/blogs');
    state.posts = blogs;
    renderPosts();
  } catch (error) {
    elements.postList.innerHTML = `<div class="empty-state"><h2>We could not load the journal.</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function showDashboard() {
  if (!state.token) {
    openAuth();
    return;
  }
  setView('dashboard');
  elements.postList.setAttribute('aria-busy', 'true');
  elements.postList.innerHTML = '<div class="loading-line"><span></span>Loading your journal</div>';
  setNotice('');
  try {
    const dashboard = await api('/api/dashboard');
    state.user = dashboard.user;
    state.posts = dashboard.blogs;
    renderAccount();
    renderPosts();
  } catch (error) {
    if (error.status === 401) {
      clearSession();
      await loadPublic();
      setNotice('Your session ended. Sign in again to open your dashboard.');
      return;
    }
    elements.postList.innerHTML = `<div class="empty-state"><h2>Your journal is unavailable.</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function openAuth() {
  authMode = 'login';
  updateAuthMode();
  elements.authError.hidden = true;
  elements.authForm.reset();
  elements.authDialog.showModal();
}

function updateAuthMode() {
  const registering = authMode === 'register';
  elements.authTitle.textContent = registering ? 'Create your account' : 'Sign in';
  elements.authDescription.textContent = registering
    ? 'A name, an email, and a place to begin.'
    : 'Pick up where your last thought left off.';
  elements.authSubmit.textContent = registering ? 'Create account' : 'Sign in';
  elements.authSwitchPrompt.textContent = registering ? 'Already have an account?' : 'New here?';
  elements.authSwitchButton.textContent = registering ? 'Sign in' : 'Create an account';
  elements.nameField.hidden = !registering;
  elements.authForm.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  elements.authForm.elements.name.required = registering;
}

function clearSession() {
  sessionStorage.removeItem('blogToken');
  state.token = null;
  state.user = null;
  renderAccount();
}

function openEditor(post = null) {
  state.editingId = post?.id ?? null;
  elements.editorForm.reset();
  elements.editorError.hidden = true;
  elements.editorTitle.textContent = post ? 'Edit your post' : 'Write a post';
  elements.editorSubmit.textContent = post ? 'Save changes' : 'Publish post';
  elements.editorForm.elements.title.value = post?.title ?? '';
  elements.editorForm.elements.excerpt.value = post?.excerpt ?? '';
  elements.editorForm.elements.content.value = post?.content ?? '';
  elements.editorDialog.showModal();
}

async function openPost(id) {
  try {
    const { blog } = await api(`/api/blogs/${encodeURIComponent(id)}`);
    elements.detailMeta.textContent = `${formatDate(blog.created_at)}  /  ${blog.author_name}`;
    elements.detailTitle.textContent = blog.title;
    elements.detailExcerpt.textContent = blog.excerpt || '';
    elements.detailExcerpt.hidden = !blog.excerpt;
    elements.detailContent.textContent = blog.content;
    elements.postDialog.showModal();
  } catch (error) {
    setNotice(error.message);
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    setNotice('You are signed out.');
  } catch (error) {
    setNotice(`Your local session was cleared, but the server could not confirm sign out: ${error.message}`);
  }
  clearSession();
  await loadPublic();
}

document.querySelector('#exploreButton').addEventListener('click', loadPublic);
document.querySelector('#dashboardButton').addEventListener('click', showDashboard);
document.querySelector('#signInButton').addEventListener('click', openAuth);
document.querySelector('#sideSignInButton').addEventListener('click', openAuth);
document.querySelector('#logoutButton').addEventListener('click', logout);
document.querySelector('#newPostButton').addEventListener('click', () => openEditor());

elements.authSwitchButton.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  elements.authError.hidden = true;
  updateAuthMode();
});

elements.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.authError.hidden = true;
  const form = new FormData(elements.authForm);
  const body = {
    email: form.get('email'),
    password: form.get('password'),
  };
  if (authMode === 'register') body.name = form.get('name');

  try {
    const { user, token } = await api(`/api/auth/${authMode}`, { method: 'POST', body });
    state.user = user;
    state.token = token;
    sessionStorage.setItem('blogToken', token);
    elements.authDialog.close();
    await showDashboard();
  } catch (error) {
    elements.authError.textContent = error.message;
    elements.authError.hidden = false;
  }
});

elements.editorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.editorError.hidden = true;
  const form = new FormData(elements.editorForm);
  const body = {
    title: form.get('title'),
    excerpt: form.get('excerpt'),
    content: form.get('content'),
  };
  const editing = state.editingId !== null;
  const path = editing ? `/api/blogs/${encodeURIComponent(state.editingId)}` : '/api/blogs';

  try {
    await api(path, { method: editing ? 'PUT' : 'POST', body });
    elements.editorDialog.close();
    setNotice(editing ? 'Your changes are saved.' : 'Your post is published.');
    await showDashboard();
  } catch (error) {
    elements.editorError.textContent = error.message;
    elements.editorError.hidden = false;
  }
});

elements.postList.addEventListener('click', async (event) => {
  const openButton = event.target.closest('[data-open-post]');
  const editButton = event.target.closest('[data-edit-post]');
  const deleteButton = event.target.closest('[data-delete-post]');

  if (openButton) await openPost(openButton.dataset.openPost);
  if (editButton) {
    const post = state.posts.find((item) => String(item.id) === editButton.dataset.editPost);
    if (post) openEditor(post);
  }
  if (deleteButton && window.confirm('Delete this post? This cannot be undone.')) {
    try {
      await api(`/api/blogs/${encodeURIComponent(deleteButton.dataset.deletePost)}`, { method: 'DELETE' });
      setNotice('Your post was deleted.');
      await showDashboard();
    } catch (error) {
      setNotice(error.message);
    }
  }
});

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.close).close());
});

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

async function start() {
  try {
    await api('/api/health');
    elements.apiStatus.textContent = 'Journal is open';
    document.querySelector('.side-footer .status-dot').classList.add('is-online');
  } catch {
    elements.apiStatus.textContent = 'Connecting';
  }

  if (state.token) {
    try {
      const { user } = await api('/api/auth/me');
      state.user = user;
      renderAccount();
      await showDashboard();
      return;
    } catch {
      clearSession();
    }
  }
  await loadPublic();
}

start();