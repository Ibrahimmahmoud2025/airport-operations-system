/**
 * Vercel Serverless — admin updates another user's profile + optional Auth password/metadata.
 * Same auth model as create-user.js (Bearer access token → active admin in profiles).
 */
const { createClient } = require('@supabase/supabase-js');

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object') return {};
  return body;
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

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }

  const body = parseBody(req);
  if (body === null) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

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
    console.error('[update-user] caller profile', profErr);
    return res.status(500).json({ error: 'Could not verify admin role' });
  }
  if (!callerProfile || callerProfile.active === false || callerProfile.role !== 'admin') {
    return res.status(403).json({ error: 'Only active admin users can update accounts' });
  }

  const targetSupabaseUserId = String(body.targetSupabaseUserId || '').trim();
  if (!targetSupabaseUserId) {
    return res.status(400).json({ error: 'targetSupabaseUserId is required' });
  }

  const { data: targetProfile, error: tErr } = await adminClient
    .from('profiles')
    .select('user_id, username, role, active')
    .eq('user_id', targetSupabaseUserId)
    .maybeSingle();

  if (tErr || !targetProfile) {
    return res.status(404).json({ error: 'Target profile not found' });
  }

  const displayName = String(body.displayName || '').trim().slice(0, 120);
  const role = String(body.role || '');
  const active = body.active !== false;
  const password = body.password != null && String(body.password).length > 0 ? String(body.password) : null;
  const leaderLegacyId =
    body.leaderLegacyId != null && body.leaderLegacyId !== ''
      ? parseInt(body.leaderLegacyId, 10)
      : null;

  if (!displayName) {
    return res.status(400).json({ error: 'Display name is required' });
  }
  if (!['admin', 'supervisor', 'leader'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (password && password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (role === 'leader') {
    if (!Number.isFinite(leaderLegacyId) || leaderLegacyId < 1) {
      return res.status(400).json({ error: 'Tour leader role requires a valid linked roster id' });
    }
  }

  if (targetProfile.role === 'admin' && (role !== 'admin' || !active)) {
    const { data: admins, error: aErr } = await adminClient
      .from('profiles')
      .select('user_id')
      .eq('role', 'admin')
      .eq('active', true);
    if (aErr) {
      console.error('[update-user] admin count', aErr);
      return res.status(500).json({ error: 'Could not verify admin roster' });
    }
    const others = (admins || []).filter((a) => a.user_id !== targetSupabaseUserId);
    if (!others.length) {
      return res.status(400).json({ error: 'Cannot remove or deactivate the last admin' });
    }
  }

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

  const profilePatch = {
    display_name: displayName,
    role,
    active,
    leader_id: role === 'leader' && leaderUuid ? leaderUuid : null,
  };

  const { error: upErr } = await adminClient
    .from('profiles')
    .update(profilePatch)
    .eq('user_id', targetSupabaseUserId);

  if (upErr) {
    console.error('[update-user] profile update', upErr);
    return res.status(500).json({ error: upErr.message || 'Profile update failed' });
  }

  const authUpdate = {
    user_metadata: {
      username: String(targetProfile.username || ''),
      display_name: displayName,
      role,
    },
  };
  if (password) {
    authUpdate.password = password;
  }

  const { error: auErr } = await adminClient.auth.admin.updateUserById(targetSupabaseUserId, authUpdate);
  if (auErr) {
    console.error('[update-user] auth update', auErr);
    return res.status(500).json({ error: auErr.message || 'Auth user update failed' });
  }

  return res.status(200).json({
    ok: true,
    leaderRemoteLinked: !!(role === 'leader' && leaderUuid),
  });
};
