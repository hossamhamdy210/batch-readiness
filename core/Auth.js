/**
 * Auth.gs - own user management (registration, approval, roles, sessions).
 * Passwords are never stored: only a random salt and a memory-hard hash (scrypt, see server/runtime.js).
 * Sessions live in the cache port for 6 hours. Every API call re-checks the user row,
 * so disabling a user takes effect immediately.
 */
var ROLE_RANK = { viewer: 1, planner: 2, editor: 3, admin: 4 };
var ROLES = ['viewer', 'planner', 'editor', 'admin'];
var SESSION_SECONDS = 6 * 60 * 60;
var MAX_FAILS = 5, LOCK_SECONDS = 15 * 60;

function auth_hash(pw, salt) { return port.hash(String(pw), String(salt)); }
function auth_salt() { return port.uuid().replace(/-/g, ''); }
function auth_token() { return port.uuid().replace(/-/g, '') + port.uuid().replace(/-/g, ''); }

function auth_validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120; }
function auth_checkPw(pw) {
  if (!pw || String(pw).length < 10) throw new Error('Password must have at least 10 characters.');
  if (String(pw).length > 100) throw new Error('Password is too long.');
}

function auth_userRows() { return store_read('Users'); }

function auth_publicUser(u) {
  return { email: u.email, name: u.name, role: u.role, status: u.status, created: u.created, lastLogin: u.lastLogin };
}

/** Returns {needsSetup, registrationOpen, maxUsers} for the login screen. */
function auth_state() {
  var users = auth_userRows(), S = store_kv('Settings');
  return {
    needsSetup: users.length === 0,
    registrationOpen: users.length === 0 || String(S.allowRegistration || 'yes').toLowerCase() === 'yes',
    needsInvite: users.length > 0 && !!String(S.inviteCode || '').trim(),
    appName: S.appName || 'Batch Readiness'
  };
}

function auth_register(p) {
  var email = String(p.email || '').trim().toLowerCase(), name = String(p.name || '').trim();
  if (!auth_validEmail(email)) throw new Error('Please enter a valid e-mail address.');
  if (!name) throw new Error('Please enter your name.');
  auth_checkPw(p.password);
  var users = auth_userRows(), S = store_kv('Settings');
  var props = port.props;
  var first = users.length === 0;
  if (first) {
    var code = props.getProperty('SETUP_CODE');
    if (!code || String(p.code || '').trim() !== code) throw new Error('Setup code is wrong. It is printed in the server log at the first start (or run: npm run setup-code).');
  } else {
    if (String(S.allowRegistration || 'yes').toLowerCase() !== 'yes') throw new Error('Registration is closed. Ask an administrator.');
    var inv = String(S.inviteCode || '').trim();
    if (inv && String(p.code || '').trim() !== inv) throw new Error('Invite code is wrong.');
  }
  users.forEach(function (u) { if (u.email === email) throw new Error('This e-mail address is already registered.'); });
  var maxUsers = parseInt(S.maxUsers, 10) || 12;
  var counted = users.filter(function (u) { return u.status !== 'disabled'; }).length;
  if (counted >= maxUsers) throw new Error('The user limit (' + maxUsers + ') is reached. Ask an administrator.');
  var salt = auth_salt();
  var row = { email: email, name: name, role: first ? 'admin' : 'viewer', status: first ? 'active' : 'pending',
              salt: salt, hash: auth_hash(p.password, salt), created: new Date().toISOString(), lastLogin: '' };
  store_append('Users', [row]);
  store_log(row, 'register', first ? 'first administrator' : 'pending approval');
  if (first) props.deleteProperty('SETUP_CODE');
  return { pending: !first };
}

function auth_login(p) {
  var email = String(p.email || '').trim().toLowerCase(), cache = port.cache;
  var failKey = 'fail:' + email, fails = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= MAX_FAILS) throw new Error('Too many failed attempts. Try again in 15 minutes.');
  var users = auth_userRows(), user = null;
  users.forEach(function (u) { if (u.email === email) user = u; });
  var ok = user && auth_hash(String(p.password || ''), user.salt) === user.hash;
  if (!ok) {
    cache.put(failKey, String(fails + 1), LOCK_SECONDS);
    throw new Error('E-mail or password is wrong.');
  }
  if (user.status === 'pending') throw new Error('Your account waits for approval by an administrator.');
  if (user.status !== 'active') throw new Error('This account is disabled.');
  cache.remove(failKey);
  var token = auth_token();
  cache.put('sess:' + token, email, SESSION_SECONDS);
  user.lastLogin = new Date().toISOString();
  var all = users.map(function (u) { return u.email === email ? user : u; });
  store_write('Users', all);
  store_log(user, 'login', '');
  return { token: token, user: auth_publicUser(user) };
}

/** Throws unless the token belongs to an active user. */
function auth_user(token) {
  if (!token) throw new Error('Session expired. Please sign in again.');
  var email = port.cache.get('sess:' + String(token));
  if (!email) throw new Error('Session expired. Please sign in again.');
  var user = null;
  auth_userRows().forEach(function (u) { if (u.email === email) user = u; });
  if (!user || user.status !== 'active') throw new Error('Session expired. Please sign in again.');
  return user;
}

function auth_logout(token) { port.cache.remove('sess:' + String(token)); }

/* ---- administration ---- */
function auth_adminCount(users) { return users.filter(function (u) { return u.role === 'admin' && u.status === 'active'; }).length; }

function auth_adminUpdate(admin, p) {
  var users = auth_userRows(), t = null;
  users.forEach(function (u) { if (u.email === String(p.email).toLowerCase()) t = u; });
  if (!t) throw new Error('User not found.');
  var action = p.action;
  if (action === 'approve') { t.status = 'active'; if (p.role && ROLES.indexOf(p.role) >= 0) t.role = p.role; }
  else if (action === 'role') {
    if (ROLES.indexOf(p.role) < 0) throw new Error('Unknown role.');
    if (t.role === 'admin' && p.role !== 'admin' && auth_adminCount(users) <= 1) throw new Error('At least one administrator is needed.');
    t.role = p.role;
  } else if (action === 'disable') {
    if (t.role === 'admin' && t.status === 'active' && auth_adminCount(users) <= 1) throw new Error('The last administrator cannot be disabled.');
    t.status = 'disabled';
  } else if (action === 'enable') { t.status = 'active'; }
  else if (action === 'resetPassword') {
    auth_checkPw(p.password);
    t.salt = auth_salt(); t.hash = auth_hash(p.password, t.salt);
  } else if (action === 'delete') {
    if (t.role === 'admin' && t.status === 'active' && auth_adminCount(users) <= 1) throw new Error('The last administrator cannot be deleted.');
    users = users.filter(function (u) { return u !== t; });
  } else throw new Error('Unknown action.');
  store_write('Users', users);
  store_log(admin, 'user:' + action, t.email + (p.role ? ' -> ' + p.role : ''));
  return users.map(auth_publicUser);
}

function auth_changeOwnPassword(user, p) {
  var users = auth_userRows(), t = null;
  users.forEach(function (u) { if (u.email === user.email) t = u; });
  if (!t || auth_hash(String(p.oldPassword || ''), t.salt) !== t.hash) throw new Error('Current password is wrong.');
  auth_checkPw(p.newPassword);
  t.salt = auth_salt(); t.hash = auth_hash(p.newPassword, t.salt);
  store_write('Users', users);
  store_log(user, 'password', 'changed');
  return true;
}
