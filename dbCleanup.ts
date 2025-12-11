import { Client } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database configuration interface
interface DBConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: { rejectUnauthorized: boolean };
}

// Get database configuration from environment variables
const getDbConfig = (): DBConfig => {
  const requiredVars = ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
  }

  return {
    host: process.env.PG_HOST!,
    port: parseInt(process.env.PG_PORT!),
    user: process.env.PG_USER!,
    password: process.env.PG_PASSWORD!,
    database: process.env.PG_DATABASE!,
    ssl: process.env.PG_SSL === 'true' ? { 
      rejectUnauthorized: false // Only for testing/development
    } : undefined
  };
};

/**
 * Deletes a user from the database
 * @param uuid User UUID to delete (default: 'DE222222')
 */
export const deleteUserByUuid = async (uuid = 'DE222222'): Promise<void> => {
  const config = getDbConfig();
  const client = new Client(config);

  try {
    console.log(`🔍 Attempting to delete user with UUID: ${uuid}`);
    await client.connect();
    
    const query = 'DELETE FROM cdp.hcp_profiles WHERE uuid = $1 RETURNING *';
    const result = await client.query(query, [uuid]);

    if (result.rowCount && result.rowCount > 0) {
      console.log(`✅ Successfully deleted user with UUID: ${uuid}`);
      console.log('Deleted user details:', result.rows[0]);
    } else {
      console.log(`ℹ️ No user found with UUID: ${uuid}`);
    }
  } catch (error) {
    console.error('❌ Error deleting user:');
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      if ('code' in error) {
        console.error('Error code:', (error as any).code);
      }
    }
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed');
  }
};

// For direct script execution
if (require.main === module) {
  const uuidToDelete = process.argv[2] || 'DE222222';
  
  deleteUserByUuid(uuidToDelete)
    .catch(error => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}