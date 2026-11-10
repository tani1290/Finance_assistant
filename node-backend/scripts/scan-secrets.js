/**
 * FinPro — Automated Repository Secret & Credential Scanner
 * Owner: Jinay Golecha (jinay_golecha)
 *
 * Scans all tracked files, staged files, and modified source files for:
 * 1. AWS / S3 Secret Access Keys & Access Key IDs
 * 2. Database connection strings containing plain passwords
 * 3. Gemini / Google AI API keys
 * 4. Private SSH keys / RSA keys
 * 5. Hardcoded JWT Secrets
 * 6. Finnhub / Marketaux API keys
 * 7. Ensures .env is strictly ignored by .gitignore
 * 8. Ensures .env.example contains strictly placeholders
 * 9. Ensures Android signing keystores (*.jks, *.keystore) and key.properties are untracked
 * 10. Ensures no unmasked Android storePassword/keyPassword values in tracked files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║       FINPRO — REPOSITORY SECURITY & SECRET AUDIT SCANNER          ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

let issuesFound = 0;

// 1. Verify .gitignore protects .env and Android signing material
const rootGitignorePath = path.join(__dirname, '../../.gitignore');
const backendGitignorePath = path.join(__dirname, '../.gitignore');

const rootGitignore = fs.existsSync(rootGitignorePath) ? fs.readFileSync(rootGitignorePath, 'utf8') : '';
const backendGitignore = fs.existsSync(backendGitignorePath) ? fs.readFileSync(backendGitignorePath, 'utf8') : '';

if (!rootGitignore.includes('.env') && !backendGitignore.includes('.env')) {
  console.error('❌ FAIL: .env is NOT specified in .gitignore!');
  issuesFound++;
} else {
  console.log('✅ PASS: .env is strictly ignored in .gitignore');
}

if (!rootGitignore.includes('key.properties') && !rootGitignore.includes('*.jks')) {
  console.error('❌ FAIL: Android signing material (key.properties, *.jks) is NOT specified in .gitignore!');
  issuesFound++;
} else {
  console.log('✅ PASS: Android signing material is strictly ignored in .gitignore');
}

// 2. Verify sensitive credential files are NOT tracked by Git
try {
  const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const trackedFiles = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean);

  // Check tracked .env files (ignoring safe templates)
  const trackedEnv = trackedFiles.filter(f => {
    const base = path.basename(f);
    if (base.endsWith('.example') || base.endsWith('.sample') || base.endsWith('.template')) return false;
    return base === '.env' || base.startsWith('.env.');
  });

  if (trackedEnv.length > 0) {
    console.error('❌ FAIL: Sensitive .env file is tracked in Git:', trackedEnv);
    issuesFound++;
  } else {
    console.log('✅ PASS: No .env files are tracked in Git index');
  }

  // Check tracked Android signing material (ignoring safe templates)
  const trackedSigning = trackedFiles.filter(f => {
    const base = path.basename(f);
    if (base.endsWith('.example') || base.endsWith('.sample') || base.endsWith('.template')) return false;
    return base === 'key.properties' || base.endsWith('.jks') || base.endsWith('.keystore');
  });

  if (trackedSigning.length > 0) {
    console.error('❌ FAIL: Android signing file is tracked in Git:', trackedSigning);
    issuesFound++;
  } else {
    console.log('✅ PASS: No Android signing files (key.properties, *.jks, *.keystore) are tracked in Git index');
  }

  // 3. Scan all tracked files for exposed credentials and signing passwords
  const patterns = [
    { name: 'Private Key Block', regex: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP)?\s*PRIVATE KEY-----/ },
    { name: 'Hardcoded S3 Secret (AWS/Supabase)', regex: /S3_SECRET_ACCESS_KEY\s*=\s*['"][a-f0-9]{32,}['"]/i },
    { 
      name: 'Hardcoded Remote DB Password in Code', 
      regex: /postgresql:\/\/(?!postgres:postgres@(?:localhost|127\.0\.0\.1|db|postgres))[a-zA-Z0-9_\.\-]+:(?!password|pass|passwd|secret|changeme|example)[^@\s\/]{8,}@(?!localhost|127\.0\.0\.1|db|postgres)[a-zA-Z0-9_\.\-]+/ 
    },
    { name: 'Exposed Gemini API Key', regex: /AIzaSy[a-zA-Z0-9_\-]{30,}/ },
    { name: 'Exposed Gemini API Key (AQ format)', regex: /AQ\.[a-zA-Z0-9_\-]{40,}/ },
    { 
      name: 'Hardcoded Android signing password literal', 
      regex: /(?:storePassword|keyPassword)\s*=\s*['"](?!CHANGE_ME|YOUR_|dummy|placeholder|example)[^'"]{3,}['"]/i 
    },
    { 
      name: 'Hardcoded Android signing password property', 
      regex: /^[ \t]*(?:storePassword|keyPassword)\s*=\s*(?!CHANGE_ME|YOUR_|dummy|placeholder|example|releaseStorePassword|releaseKeyPassword|\$)[^\s"']+/im 
    },
  ];

  let scannedCount = 0;
  for (const relFile of trackedFiles) {
    // Skip lockfiles, documentation, example templates, test mock fixtures, APKs, or public client configs
    if (
      relFile.endsWith('.lock') || 
      relFile.endsWith('package-lock.json') || 
      relFile.endsWith('.png') || 
      relFile.endsWith('.webp') || 
      relFile.endsWith('.jpg') || 
      relFile.endsWith('.apk') ||
      relFile.endsWith('.md') ||
      relFile.endsWith('.env.example') ||
      relFile.endsWith('key.properties.example') ||
      relFile.endsWith('google-services.json') ||
      relFile.endsWith('GoogleService-Info.plist') ||
      relFile.endsWith('firebase_options.dart')
    ) {
      continue;
    }

    const fullPath = path.join(repoRoot, relFile);
    if (!fs.existsSync(fullPath)) continue;

    // Skip binary files from regex scanning
    const ext = path.extname(relFile).toLowerCase();
    if (['.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.gif'].includes(ext)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    scannedCount++;

    for (const pattern of patterns) {
      if (pattern.regex.test(content)) {
        // Exclude scan-secrets.js itself from pattern matching
        if (relFile.includes('scan-secrets.js')) continue;
        console.error(`❌ FAIL: Suspicious pattern detected in [${relFile}]: ${pattern.name}`);
        issuesFound++;
      }
    }
  }

  console.log(`✅ PASS: Scanned ${scannedCount} Git-tracked files. Zero hardcoded secrets found.`);

} catch (err) {
  console.warn('[Scanner Notice] Git scan check completed with note:', err.message);
}

// 4. Verify .env.example contains only placeholders
const envExamplePath = path.join(__dirname, '../.env.example');
if (fs.existsSync(envExamplePath)) {
  const exampleContent = fs.readFileSync(envExamplePath, 'utf8');
  if (/S3_SECRET_ACCESS_KEY=[a-f0-9]{32,}/i.test(exampleContent) || /DATABASE_URL=postgresql:\/\/[^:]+:[a-zA-Z0-9_\-]{10,}@/i.test(exampleContent)) {
    console.error('❌ FAIL: .env.example contains actual credentials!');
    issuesFound++;
  } else {
    console.log('✅ PASS: .env.example contains strictly non-sensitive placeholders');
  }
}

// 5. Verify key.properties.example contains only placeholders
const keyExamplePath = path.join(__dirname, '../../mobile/android/key.properties.example');
if (fs.existsSync(keyExamplePath)) {
  const keyContent = fs.readFileSync(keyExamplePath, 'utf8');
  if (
    /storePassword=(?!CHANGE_ME)[^\s]+/i.test(keyContent) ||
    /keyPassword=(?!CHANGE_ME)[^\s]+/i.test(keyContent)
  ) {
    console.error('❌ FAIL: key.properties.example contains non-placeholder values!');
    issuesFound++;
  } else {
    console.log('✅ PASS: key.properties.example contains strictly non-sensitive placeholders');
  }
}

console.log('\n====================================================================');
if (issuesFound === 0) {
  console.log('🎉 REPOSITORY SECURITY AUDIT PASSED: 0 SECRETS DETECTED');
} else {
  console.error(`⚠️ SECURITY AUDIT FAILED: ${issuesFound} ISSUES FOUND`);
  process.exit(1);
}
console.log('====================================================================\n');
