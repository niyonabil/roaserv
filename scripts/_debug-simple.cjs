const express = require('express');
const http = require('http');

const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  JWT_SECRET: 'roa_services_super_secret_change_me_8f3a2c91',
  JWT_REFRESH_SECRET: 'roa_services_refresh_secret_b7e1d4a6',
  PORT: '4100',
};

// Test 1: route directe sur l'app (pas de sous-router)
const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/v1/test', (_req, res) => res.json({ test: true }));

// Test 2: monter un sous-router basique
const { Router } = express;
const r = Router();
r.get('/clients', (_req, res) => res.json({ clients: [] }));
app.use('/api/v1', r);

const server = app.listen(4100, async () => {
  console.log('listening on 4100');
  
  function req(path) {
    return new Promise((resolve) => {
      const r = http.request({ host: 'localhost', port: 4100, path, method: 'GET' }, (res) => {
        let body = ''; res.on('data', (c) => body += c); res.on('end', () => resolve({ code: res.statusCode, body: body.slice(0, 200) }));
      });
      r.on('error', (e) => resolve({ err: e.message }));
      r.end();
    });
  }
  
  console.log('GET /health ->', (await req('/health')).code);
  console.log('GET /api/v1/test ->', (await req('/api/v1/test')).code);
  console.log('GET /api/v1/clients ->', (await req('/api/v1/clients')).code, (await req('/api/v1/clients')).body);
  
  server.close(() => process.exit(0));
});
