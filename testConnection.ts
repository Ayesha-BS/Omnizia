// testConnection.ts
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: 'recordati_discovery_dev',
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Successfully connected to the database');
    
    // List all schemas
    const schemas = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      ORDER BY schema_name;
    `);
    console.log('\nAvailable schemas:');
    console.table(schemas.rows);
    
    // List all tables in all schemas
    console.log('\nSearching for hcp_profiles table...');
    const tables = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_name = 'hcp_profiles'
      ORDER BY table_schema;
    `);
    
    if (tables.rows.length > 0) {
      console.log('\nFound hcp_profiles table in:');
      console.table(tables.rows);
      
      // For each found table, show its structure
      for (const table of tables.rows) {
        console.log(`\nStructure of ${table.table_schema}.${table.table_name}:`);
        const columns = await client.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position;
        `, [table.table_schema, table.table_name]);
        
        console.table(columns.rows);
      }
    } else {
      console.log('\n❌ hcp_profiles table not found in any schema');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

testConnection().catch(console.error);