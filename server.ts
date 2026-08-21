const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, 'dist', 'server', 'server.mjs');

const child = spawn('node', [serverPath], { stdio: 'inherit', env: process.env });

child.on('exit', (code) => {
  process.exit(code || 0);
});

// Propagate signals to the child process
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
  process.on(signal, () => {
    child.kill(signal);
  });
});
