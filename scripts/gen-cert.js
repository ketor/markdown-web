const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, '..', 'cert');

if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('Certificate already exists.');
  process.exit(0);
}

console.log('Generating self-signed certificate...');

try {
  const cmd = `openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log('Certificate generated successfully!');
} catch (error) {
  console.error('Failed to generate certificate:', error.message);
  process.exit(1);
}
