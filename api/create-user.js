/**
 * Vercel Serverless — creates Supabase Auth user + profile (trigger) + optional leader_id.
 * Requires Authorization: Bearer <access_token> of an active admin.
 * Env: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), LOGISTICS_AUTH_EMAIL_SUFFIX (optional).
 */
const { createClient } = require('@supabase/supabase-js');

function normalizeUsername(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 64);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) {
    return res.status(503).json({ error: 'Server is not configured for user provisioning' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  if (!body || typeof body !== 'object') body = {};

  const adminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const callerId = userData.user.id;
  const { data: callerProfile, error: profErr } = await adminClient
    .from('profiles')
    .select('role, active')
    .eq('user_id', callerId)
    .maybeSingle();

  if (profErr) {
    console.error('[create-user] profile read', profErr);
    return res.status(500).json({ error: 'Could not verify admin role' });
  }
  if (!callerProfile || callerProfile.active === false || callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Only active admin users can create accounts' });
  }

  const username = normalizeUsername(body.username);
  const displayName = String(body.displayName || '').trim().slice(0, 120);
  const role = String(body.role || '');
  const password = String(body.password || '');
  const leaderLegacyId =
    body.leaderLegacyId != null && body.leaderLegacyId !== ''
      ? parseInt(body.leaderLegacyId, 10)
      : null;

  if (!username) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  if (!displayName) {
    return res.status(400).json({ error: 'Display name is required' });
  }
  if (!['admin', 'supervisor', 'leader'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (role === 'leader') {
    if (!Number.isFinite(leaderLegacyId) || leaderLegacyId < 1) {
      return res.status(400).json({ error: 'Tour leader role requires a valid linked roster id' });
    }
  }

  const suffix =
    process.env.LOGISTICS_AUTH_EMAIL_SUFFIX ||
    process.env.NEXT_PUBLIC_LOGISTICS_AUTH_EMAIL_SUFFIX ||
    '@users.logistics.local';
  const email = username + String(suffix);

  let leaderUuid = null;
  if (role === 'leader' && Number.isFinite(leaderLegacyId)) {
    const { data: leaderRow, error: leErr } = await adminClient
      .from('leaders')
      .select('id')
      .eq('legacy_id', leaderLegacyId)
      .maybeSingle();
    if (!leErr && leaderRow && leaderRow.id) {
      leaderUuid = leaderRow.id;
    }
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      display_name: displayName,
      role,
    },
  });

  if (createErr || !created || !created.user) {
    const msg = createErr && createErr.message ? createErr.message : 'Failed to create user';
    const status =
      /already|registered|exists|duplicate/i.test(msg) ? 409 : 400;
    return res.status(status).json({ error: msg });
  }

  const newId = created.user.id;

  if (role === 'leader' && leaderUuid) {
    const { error: upErr } = await adminClient
      .from('profiles')
      .update({ leader_id: leaderUuid })
      .eq('user_id', newId);
    if (upErr) {
      console.error('[create-user] profile leader update', upErr);
      await adminClient.auth.admin.deleteUser(newId);
      return res.status(500).json({ error: 'Could not link tour leader on server roster' });
    }
  }

  return res.status(200).json({
    userId: newId,
    email: created.user.email || email,
    leaderRemoteLinked: !!(role === 'leader' && leaderUuid),
  });
};
