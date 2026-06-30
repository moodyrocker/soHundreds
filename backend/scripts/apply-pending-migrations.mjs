import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../dist/database/connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = fs.existsSync('/tmp/migrations')
  ? '/tmp/migrations'
  : path.join(__dirname, '../../supabase/migrations');

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '20250602000000_mcp_config.sql',
      '20250603000000_strategy_data_source_multi.sql',
      '20250604000000_strategy_data_source_meta.sql',
      '20250605000000_strategy_data_source_shopify.sql',
      '20250606000000_organization_business_profile.sql',
      '20250607000000_strategy_generating_status.sql',
    ];

for (const file of files) {
  const full = path.join(migrationsDir, file);
  if (!fs.existsSync(full)) {
    console.log('SKIP missing', file);
    continue;
  }
  const sql = fs.readFileSync(full, 'utf8');
  try {
    await query(sql);
    console.log('OK', file);
  } catch (err) {
    console.log('FAIL', file, err instanceof Error ? err.message : err);
  }
}

const cols = await query(
  "SELECT 1 FROM information_schema.columns WHERE table_name='mcp_connections' AND column_name='config'"
);
console.log('config column present:', cols.rowCount > 0);

const ds = await query(
  "SELECT pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'strategies'::regclass AND conname LIKE '%data_source%'"
);
console.log('data_source constraint:', ds.rows[0]?.def ?? 'none');
