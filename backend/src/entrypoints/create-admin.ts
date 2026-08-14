/**
 * Bootstraps the first administrator.
 *
 * The API cannot create the first admin — that would leave a window where the system has
 * no privileged user and every route behind the admin role is unreachable. This entrypoint
 * runs with direct database access and creates (or repairs) exactly one account, then
 * exits. Credentials come from the environment, never from arguments, so they do not end
 * up in shell history.
 */

import { createDb } from '../db'
import { createPasswordService } from '../modules/auth'

async function main(): Promise<void> {
  const email = process.env.CREATE_ADMIN_EMAIL
  const password = process.env.CREATE_ADMIN_PASSWORD
  const databaseUrl = process.env.DATABASE_URL

  if (!email || !password) {
    console.error(
      'CREATE_ADMIN_EMAIL and CREATE_ADMIN_PASSWORD are required (see backend/.env.example)',
    )
    process.exit(1)
  }
  if (password.length < 12) {
    console.error('CREATE_ADMIN_PASSWORD must be at least 12 characters')
    process.exit(1)
  }
  if (!databaseUrl) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const db = createDb(databaseUrl)
  const passwords = createPasswordService()
  try {
    const passwordHash = await passwords.hash(password)
    const user = await db.user.upsert({
      where: { email: email.trim().toLowerCase() },
      update: { passwordHash, role: 'admin' },
      create: {
        email: email.trim().toLowerCase(),
        passwordHash,
        role: 'admin',
      },
    })
    console.log(`[create-admin] admin account ready: ${user.id} (${user.email})`)
  } finally {
    await db.$disconnect()
  }
  process.exit(0)
}

try {
  await main()
} catch (error) {
  console.error('[create-admin] failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
}
