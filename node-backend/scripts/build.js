/**
 * FinPro Production Build Verification Script
 * Validates Prisma schema, generates Prisma Client, and verifies server entrypoints.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');

// Ensure valid DATABASE_URL format is available for Prisma schema validation during build
if (!process.env.DATABASE_URL || (!process.env.DATABASE_URL.startsWith('postgresql://') && !process.env.DATABASE_URL.startsWith('postgres://'))) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/finance_jinay?schema=public';
}

const prismaBin = path.join(rootDir, 'node_modules', 'prisma', 'build', 'index.js');
const prismaCmd = fs.existsSync(prismaBin) ? `node "${prismaBin}"` : (process.platform === 'win32' ? 'npx.cmd prisma' : 'npx prisma');

console.log('[Build] Step 1/3: Validating Prisma Schema...');
try {
  execSync(`${prismaCmd} validate`, { cwd: rootDir, stdio: 'inherit', env: process.env });
  console.log('  -> Prisma Schema is valid ✓');
} catch (err) {
  console.error('❌ Prisma Schema validation failed:', err.message);
  process.exit(1);
}

console.log('[Build] Step 2/3: Generating Prisma Client...');
// The client MUST be regenerated on every build. A cached node_modules can
// carry a client generated from an older schema, and a stale client rejects
// unknown model fields at runtime (e.g. the Phase 4 AiActionProposal
// execution-state columns) with a 500 only when that code path is first hit.
try {
  execSync(`${prismaCmd} generate`, { cwd: rootDir, stdio: 'inherit' });
  console.log('  -> Prisma Client generated successfully ✓');
} catch (genErr) {
  console.error('❌ Prisma Client generation failed:', genErr.message);
  process.exit(1);
}

try {
  const { PrismaClient, Prisma } = require('@prisma/client');
  new PrismaClient();
  console.log('  -> Prisma Client is compiled and verified active ✓');

  // Guard against a silently stale client: every model field the application
  // writes must exist in the generated client.
  const required = {
    AiActionProposal: ['status', 'attempts', 'executionStartedAt', 'lastError', 'retryable'],
  };
  for (const [model, fields] of Object.entries(required)) {
    const def = (Prisma.dmmf?.datamodel?.models || []).find((m) => m.name === model);
    if (!def) {
      console.error(`❌ Generated Prisma Client is missing model "${model}" — regenerate the client.`);
      process.exit(1);
    }
    const present = new Set(def.fields.map((f) => f.name));
    const missing = fields.filter((f) => !present.has(f));
    if (missing.length) {
      console.error(
        `❌ Generated Prisma Client is stale: model "${model}" is missing ${missing.join(', ')}. ` +
          'The deployed client would reject these writes at runtime.'
      );
      process.exit(1);
    }
  }
  console.log('  -> Generated client exposes every required model field ✓');
} catch (err) {
  console.error('❌ Prisma Client verification failed:', err.message);
  process.exit(1);
}

console.log('[Build] Step 3/3: Verifying Server Entrypoint and Public Frontend Assets...');
const serverFile = path.join(rootDir, 'src', 'server.js');
const appFile = path.join(rootDir, 'src', 'app.js');
const frontendIndex = path.resolve(rootDir, '../frontend/public/index.html');

if (!fs.existsSync(serverFile) || !fs.existsSync(appFile) || !fs.existsSync(frontendIndex)) {
  console.error('❌ Missing essential project entrypoints!');
  process.exit(1);
}

console.log('  -> Entrypoints and frontend assets present ✓');
console.log('\n[Build] ✅ Production build verification PASSED completely.\n');
process.exit(0);
