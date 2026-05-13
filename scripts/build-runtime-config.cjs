const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'public-config.js');
const cfg = {
  DATA_SOURCE: (process.env.DATA_SOURCE || 'local').toLowerCase() === 'remote' ? 'remote' : 'local',
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  AUTH_EMAIL_SUFFIX: process.env.NEXT_PUBLIC_LOGISTICS_AUTH_EMAIL_SUFFIX || '@users.logistics.local',
};

fs.writeFileSync(out, `window.LOGISTICS_RUNTIME=${JSON.stringify(cfg)};\n`, 'utf8');
console.log('[build-runtime-config] wrote public-config.js', {
  DATA_SOURCE: cfg.DATA_SOURCE,
  hasSupabaseUrl: Boolean(cfg.SUPABASE_URL),
  hasAnonKey: Boolean(cfg.SUPABASE_ANON_KEY),
});
