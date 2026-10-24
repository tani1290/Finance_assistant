#!/usr/bin/env node
/**
 * FinPro — publish a verified, encrypted backup to S3-compatible storage.
 *
 *   node scripts/publish-backup.js --file ./backups/finpro-db-....dump.enc
 *   node scripts/publish-backup.js --file ... --execute
 *
 * Safety:
 *  - Only encrypted `finpro-*.dump.enc` archives with a valid manifest are
 *    accepted. There is no "upload plaintext" switch.
 *  - The local encrypted checksum is verified before any network call.
 *  - An existing remote key is never overwritten.
 *  - The uploaded object is downloaded again and its SHA-256 is compared with
 *    the manifest before success is reported.
 *  - The manifest is uploaded and verified the same way.
 *  - No bucket/prefix is guessed from user input without validation.
 *
 * Credentials are read from the standard AWS environment/profile chain and are
 * never passed in argv or printed. Required IAM actions: s3:PutObject,
 * s3:GetObject and s3:DeleteObject on the backup prefix (HeadObject is implied
 * by GetObject), plus s3:ListBucket if the endpoint requires it for 404s.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const { parseArgs, sha256File } = require('./lib/dbSafety');
const {
  validateBucket,
  validatePrefix,
  validateArchiveName,
  validateEncryptedManifest,
  buildRemoteKey,
  maskSecretLikeValues,
} = require('./lib/backupRemote');
const { run } = require('./lib/dbSafety');

const fail = (message, exitCode = 1) => {
  const err = new Error(message);
  err.exitCode = exitCode;
  throw err;
};

const safe = (value) => maskSecretLikeValues(value);

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const archiveArg = args.file || args._[0];
  if (!archiveArg) {
    fail(
      'Usage: node scripts/publish-backup.js --file <backup.dump.enc> [--execute]\n' +
        'Bucket/prefix come from BACKUP_S3_BUCKET / BACKUP_S3_PREFIX or --bucket / --prefix.',
      2
    );
  }

  const archivePath = path.resolve(process.cwd(), archiveArg);
  const archiveName = path.basename(archivePath);
  validateArchiveName(archiveName);
  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
    fail(`Archive not found: ${archivePath}`, 2);
  }

  const manifestPath = `${archivePath}.json`;
  if (!fs.existsSync(manifestPath)) {
    fail('Encrypted backups require their .json manifest next to the archive.', 2);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    fail('Backup manifest is not valid JSON.', 2);
  }
  validateEncryptedManifest(manifest, archiveName);

  const actualBytes = fs.statSync(archivePath).size;
  if (actualBytes !== manifest.bytes) {
    fail(`Archive size mismatch (manifest ${manifest.bytes}, actual ${actualBytes}).`, 3);
  }
  const actualChecksum = await sha256File(archivePath);
  if (actualChecksum !== manifest.checksumSha256) {
    fail('Archive SHA-256 does not match its manifest; refusing to publish.', 3);
  }

  const bucket = validateBucket(args.bucket || process.env.BACKUP_S3_BUCKET);
  const prefix = validatePrefix(args.prefix ?? process.env.BACKUP_S3_PREFIX);
  const key = buildRemoteKey({ prefix, fileName: archiveName });
  const manifestKey = `${key}.json`;
  const endpoint = args.endpoint || process.env.BACKUP_S3_ENDPOINT || process.env.AWS_ENDPOINT_URL || '';
  const region = args.region || process.env.BACKUP_AWS_REGION || process.env.AWS_REGION || '';
  const sse = String(process.env.BACKUP_S3_SSE ?? 'AES256').trim();
  const storageClass = String(process.env.BACKUP_S3_STORAGE_CLASS || '').trim();
  const execute = args.execute === true && args['dry-run'] !== true;

  console.log('[Publish] ============================================================');
  console.log(`[Publish] Archive: ${archivePath}`);
  console.log(`[Publish] Bytes:   ${actualBytes}`);
  console.log(`[Publish] SHA-256: ${actualChecksum}`);
  console.log(`[Publish] Bucket:  ${bucket}`);
  console.log(`[Publish] Key:     ${key}`);
  console.log(`[Publish] Mode:    ${execute ? 'upload + download verification' : 'DRY RUN'}`);
  if (!sse) {
    console.warn(
      '[Publish] ⚠️  BACKUP_S3_SSE is empty: server-side encryption is disabled. ' +
        'The archive is still client-side AES-256-GCM encrypted.'
    );
  }

  if (!execute) {
    console.log('[Publish] DRY RUN — no network calls made. Pass --execute to publish.');
    return;
  }

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE && !process.env.AWS_ROLE_ARN) {
    fail(
      'No AWS credentials found in the environment. Configure the standard AWS credential ' +
        'chain or use GitHub OIDC/configure-aws-credentials.',
      4
    );
  }

  const aws = process.env.AWS_CLI_BIN || 'aws';
  const childEnv = { ...process.env, AWS_PAGER: '' };
  const awsArgs = (argv) => {
    const out = [...argv];
    if (region) out.push('--region', region);
    if (endpoint) out.push('--endpoint-url', endpoint);
    return out;
  };
  const remoteUri = `s3://${bucket}/${key}`;
  const manifestUri = `s3://${bucket}/${manifestKey}`;
  const timeoutMs = Number.parseInt(process.env.BACKUP_UPLOAD_TIMEOUT_MS || '900000', 10);
  const uploaded = [];

  const removeUploaded = () => {
    for (const remote of uploaded.reverse()) {
      const result = run(aws, awsArgs(['s3', 'rm', remote, '--only-show-errors']), {
        env: childEnv,
        timeoutMs: 120000,
      });
      if (!result.ok) {
        console.warn(`[Publish] ⚠️  Could not remove ${remote}: ${safe(result.stderr)}`);
      }
    }
  };

  try {
    const version = run(aws, ['--version'], { env: childEnv, timeoutMs: 15000 });
    if (!version.ok) {
      fail(`AWS CLI is not available (${aws}). Install it on the backup host.`, 4);
    }

    const head = run(
      aws,
      awsArgs(['s3api', 'head-object', '--bucket', bucket, '--key', key]),
      { env: childEnv, timeoutMs: 30000 }
    );
    if (head.ok) {
      fail(`Refusing to overwrite an existing object: ${remoteUri}`, 4);
    }
    const headOutput = `${head.stderr}\n${head.stdout}`;
    if (!/404|not found|nosuchkey/i.test(headOutput)) {
      fail(
        'Could not confirm the remote key is unused. Refusing to upload.\n' +
          safe(headOutput),
        4
      );
    }

    const sseArgs = sse ? ['--sse', sse] : [];
    const classArgs = storageClass ? ['--storage-class', storageClass] : [];
    const upload = run(
      aws,
      awsArgs([
        's3',
        'cp',
        archivePath,
        remoteUri,
        '--only-show-errors',
        ...sseArgs,
        ...classArgs,
      ]),
      { env: childEnv, timeoutMs }
    );
    if (!upload.ok) fail(`Archive upload failed.\n${safe(upload.stderr)}`, 4);
    uploaded.push(remoteUri);
    console.log('[Publish] ✅ Archive uploaded.');

    const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'finpro-publish-'));
    fs.chmodSync(tempDir, 0o700);
    try {
      const downloaded = path.join(tempDir, archiveName);
      const download = run(aws, awsArgs(['s3', 'cp', remoteUri, downloaded, '--only-show-errors']), {
        env: childEnv,
        timeoutMs,
      });
      if (!download.ok) fail(`Download-back verification failed.\n${safe(download.stderr)}`, 4);
      const downloadedBytes = fs.statSync(downloaded).size;
      if (downloadedBytes !== actualBytes) {
        fail(`Downloaded object size mismatch (${downloadedBytes} vs ${actualBytes}).`, 4);
      }
      const downloadedChecksum = await sha256File(downloaded);
      if (downloadedChecksum !== actualChecksum) {
        fail('Downloaded object SHA-256 does not match the local archive.', 4);
      }
      console.log('[Publish] ✅ Download-back SHA-256 verified.');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const manifestUpload = run(
      aws,
      awsArgs([
        's3',
        'cp',
        manifestPath,
        manifestUri,
        '--only-show-errors',
        '--content-type',
        'application/json',
        ...sseArgs,
        ...classArgs,
      ]),
      { env: childEnv, timeoutMs: 120000 }
    );
    if (!manifestUpload.ok) fail(`Manifest upload failed.\n${safe(manifestUpload.stderr)}`, 4);
    uploaded.push(manifestUri);

    const manifestTemp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'finpro-manifest-'));
    fs.chmodSync(manifestTemp, 0o700);
    try {
      const downloadedManifest = path.join(manifestTemp, `${archiveName}.json`);
      const download = run(
        aws,
        awsArgs(['s3', 'cp', manifestUri, downloadedManifest, '--only-show-errors']),
        { env: childEnv, timeoutMs: 120000 }
      );
      if (!download.ok) fail(`Manifest download-back failed.\n${safe(download.stderr)}`, 4);
      const remoteManifest = JSON.parse(fs.readFileSync(downloadedManifest, 'utf8'));
      if (
        remoteManifest.file !== archiveName ||
        remoteManifest.checksumSha256 !== actualChecksum ||
        remoteManifest.bytes !== actualBytes
      ) {
        fail('Downloaded manifest does not match the local manifest.', 4);
      }
      console.log('[Publish] ✅ Manifest download-back verified.');
    } finally {
      fs.rmSync(manifestTemp, { recursive: true, force: true });
    }

    console.log(`[Publish] ✅ Published ${remoteUri}`);
    console.log('[Publish] Done.');
  } catch (err) {
    removeUploaded();
    throw err;
  }
};

main().catch((err) => {
  console.error(`[Publish] ❌ ${safe(err.message)}`);
  process.exit(Number.isInteger(err.exitCode) ? err.exitCode : 1);
});
