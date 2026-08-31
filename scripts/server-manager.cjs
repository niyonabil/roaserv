// server-manager.cjs : maintient backend + frontend en vie, relance si crash
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const env = {
  DATABASE_URL: 'postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  JWT_SECRET: 'roa_services_super_secret_change_me_8f3a2c91',
  JWT_REFRESH_SECRET: 'roa_services_refresh_secret_b7e1d4a6',
  PORT: '4100',
  NODE_OPTIONS: '--max_old_space_size=4096',
};

function spawnAndMonitor(name, cmd, args, opts) {
  console.log(`[manager] demarrage ${name}...`);
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    console.log(`[manager] ${name} exited (${code}), relance dans 2s...`);
    setTimeout(() => spawnAndMonitor(name, cmd, args, opts), 2000);
  });
  return child;
}

// Backend
spawnAndMonitor('backend', 'node', ['dist/api-test.cjs']);
// Frontend
spawnAndMonitor('frontend', 'node', ['node_modules/@angular/cli/bin/ng.js', 'serve', '--port=5173', '--host=0.0.0.0', '--allowed-hosts=true']);

console.log('[manager] serveur manager lance. Backend: :4100 | Frontend: :5173');
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
