import { hashPassword } from '../src/services/auth-service.ts';
import { Pool } from 'pg';

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: DATABASE_URL not configured');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const email = 'demo@tradescheduler.com'.toLowerCase();
  const password = 'password123';
  const displayName = 'Demo Admin';

  try {
    const passwordHash = await hashPassword(password);
    const tableName = process.env.TRADESPEOPLE_TABLE ?? 'ts_tradespeople';
    
    const result = await pool.query(
      `insert into ${tableName} (email, password_hash, display_name)
       values ($1, $2, $3)
       on conflict (email) do update 
       set password_hash = excluded.password_hash, display_name = excluded.display_name
       returning id, email`,
      [email, passwordHash, displayName]
    );

    console.log(`✅ Demo user seeded successfully: ${result.rows[0].email} (ID: ${result.rows[0].id})`);
  } catch (err) {
    console.error('❌ Error seeding demo user:', err);
  } finally {
    await pool.end();
  }
}

seed();
