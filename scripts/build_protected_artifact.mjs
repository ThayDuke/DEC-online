import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const output = resolve(process.argv[3] || 'dist');
const keyText = process.env.DEC_CONTENT_KEY_B64;

if (!keyText) throw new Error('DEC_CONTENT_KEY_B64 is required');
const key = Buffer.from(keyText, 'base64');
if (key.length !== 32) throw new Error('DEC_CONTENT_KEY_B64 must decode to exactly 32 bytes');

async function filesUnder(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({
    v: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: ciphertext.toString('base64url'),
  }) + '\n';
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// The protected shell is public; lesson HTML is encrypted below and must only
// be returned through the Pages Function route. Keep index.html as a fallback
// source until the protected deployment is promoted.
const shell = join(root, 'protected-shell.html');
await writeFile(join(output, 'index.html'), await readFile(shell));
try {
  const manifest = await readFile(join(root, 'manifest', 'lesson-manifest.json'));
  await mkdir(join(output, 'manifest'), { recursive: true });
  await writeFile(join(output, 'manifest', 'lesson-manifest.json'), manifest);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.warn('manifest/lesson-manifest.json is absent; protected routes remain fail-closed.');
}

const contentRoot = join(root, 'CONTENT');
const contentFiles = await filesUnder(contentRoot);
for (const source of contentFiles) {
  const relativeSource = relative(root, source);
  const target = join(output, `${relativeSource}.enc`);
  await mkdir(resolve(target, '..'), { recursive: true });
  const plaintext = await readFile(source);
  await writeFile(target, encrypt(plaintext), 'utf8');
}

const digest = createHash('sha256');
for (const source of contentFiles.sort()) digest.update(await readFile(source));
await writeFile(join(output, 'BUILD_CONTENT_SHA256'), `${digest.digest('hex')}\n`);
console.log(JSON.stringify({ content_files: contentFiles.length, output }, null, 2));
