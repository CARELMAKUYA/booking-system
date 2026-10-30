/**
 * Runs on every Vercel build of the API (see vercel.json):
 *  1. applies pending database migrations;
 *  2. on a brand-new database, creates the BnB settings and one owner account.
 *
 * The owner's email/password come from SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD if set,
 * otherwise a random password is generated and printed once in the build log.
 * No demo data is created here; use `npm run db:seed` for that on a local database.
 */
import { databaseUrlSource } from '../src/env';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('No database configured. Set DATABASE_URL (or connect a Vercel Postgres database) on the API project.');
  }
  console.log(`Using database URL from ${databaseUrlSource}`);
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });

  const prisma = new PrismaClient();
  try {
    if ((await prisma.user.count()) > 0) {
      console.log('Staff accounts already exist; skipping first-run setup.');
      return;
    }
    const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@bnb.local').trim().toLowerCase();
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(9).toString('base64url');
    await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    await prisma.user.create({
      data: { name: 'Owner', email, role: Role.OWNER, passwordHash: await bcrypt.hash(password, 12) },
    });
    console.log('\n================ FIRST-RUN SETUP ================');
    console.log(`Owner account created: ${email}`);
    if (!process.env.SEED_OWNER_PASSWORD) console.log(`Temporary password:    ${password}`);
    console.log('Sign in, change this password, then add rooms and staff.');
    console.log('=================================================\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
