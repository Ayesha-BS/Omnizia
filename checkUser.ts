import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const TARGET_UUID = 'DE444444';

async function checkUser() {
  const client = new Client({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: {
      rejectUnauthorized: false,
    },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Check if user exists in core.users
    console.log(`\n🔍 Searching for user with UUID: ${TARGET_UUID}`);
    
    // First, check the structure of the users table
    const tableInfo = await client.query(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'core' AND table_name = 'users'`
    );
    
    console.log('\n📋 Users table structure:');
    console.table(tableInfo.rows);
    
    // Try to find the user
    const userQuery = {
      text: 'SELECT * FROM core.users WHERE id = $1 OR email = $1',
      values: [TARGET_UUID]
    };
    
    const result = await client.query(userQuery.text, userQuery.values);
    
    if (result.rows.length > 0) {
      console.log('\n✅ Found user:');
      console.table(result.rows);
      
      // Check for related data
      console.log('\n🔍 Checking for related data...');
      
      // Check for user roles if there's a roles table
      try {
        const roles = await client.query(
          'SELECT * FROM core.user_roles WHERE user_id = $1',
          [result.rows[0].id]
        );
        if (roles.rows.length > 0) {
          console.log('\n🔑 User roles:');
          console.table(roles.rows);
        }
      } catch (error) {
        console.log('ℹ️ No roles found or error checking roles:', error instanceof Error ? error.message : error);
      }
      
    } else {
      console.log('\n❌ User not found in core.users');
    }
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

checkUser().catch(console.error);
