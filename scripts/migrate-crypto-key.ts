/**
 * One-time migration: re-encrypt all social_account tokens from OLD key → NEW key.
 * Run: npx ts-node -e "require('./scripts/migrate-crypto-key.ts')"
 * Or:  npx ts-node scripts/migrate-crypto-key.ts
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const OLD_SECRET = 'your-32-char-secret-key';
const NEW_SECRET = '957f83745d41248a08ff085fff2d292488f8a19b38aaa9d403aeda59826b2fde';
const SALT = 'vcb-salt';
const ALGORITHM = 'aes-256-gcm';

function makeKey(secret: string): Buffer {
  return crypto.scryptSync(secret, SALT, 32);
}

function decrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error(`Invalid ciphertext format: ${ciphertext.substring(0, 20)}...`);
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encryptedBuf = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encryptedBuf.toString('hex')}`;
}

async function main() {
  const prisma = new PrismaClient();
  const oldKey = makeKey(OLD_SECRET);
  const newKey = makeKey(NEW_SECRET);

  const accounts = await prisma.socialAccount.findMany();
  console.log(`\n🔑 Migrating crypto key for ${accounts.length} social accounts...\n`);

  let migrated = 0;
  let alreadyNew = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      // Thử decrypt bằng old key
      const accessToken = decrypt(account.access_token_enc, oldKey);
      const refreshToken = account.refresh_token_enc
        ? decrypt(account.refresh_token_enc, oldKey)
        : null;

      // Re-encrypt bằng new key
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          access_token_enc: encrypt(accessToken, newKey),
          refresh_token_enc: refreshToken ? encrypt(refreshToken, newKey) : null,
          updated_at: new Date(),
        },
      });

      migrated++;
      console.log(`  ✅ ${account.name} (${account.platform}) — migrated`);
    } catch (oldKeyErr: any) {
      // Thử decrypt bằng new key — có thể account đã được migrate rồi
      try {
        decrypt(account.access_token_enc, newKey);
        alreadyNew++;
        console.log(`  ⏭️  ${account.name} (${account.platform}) — already on new key`);
      } catch {
        failed++;
        console.error(`  ❌ ${account.name} (${account.platform}) — FAILED: ${oldKeyErr.message}`);
      }
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`  Migrated   : ${migrated}`);
  console.log(`  Already new: ${alreadyNew}`);
  console.log(`  Failed     : ${failed}`);
  console.log(`─────────────────────────────────────`);

  if (failed > 0) {
    console.log(`\n⚠️  ${failed} account(s) failed. Those accounts need to reconnect manually.`);
  } else {
    console.log(`\n✅ Migration complete! Restart backend to use the new key.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration script crashed:', err);
  process.exit(1);
});
