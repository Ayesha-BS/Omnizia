import { cleanupUserData } from './dbCleanup';

async function main() {
    try {
        console.log('🚀 Starting user data cleanup...');
        await cleanupUserData('DE444444');
        console.log('✅ Cleanup completed successfully');
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

main();
