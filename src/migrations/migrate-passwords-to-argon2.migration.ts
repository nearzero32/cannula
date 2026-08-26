import User from '../models/users.model';
import { hashPassword, isArgon2Hash } from '../constants/hashing';

/**
 * Re-hashes legacy user passwords from the existing password_show value.
 * password_show is intentionally preserved so account password values do not change.
 */
export async function migratePasswordsToArgon2(): Promise<void> {
    const users = User.find({
        password_hash: { $not: /^\$argon2/ },
        password_show: { $type: 'string', $ne: '' },
    }).select('+password_hash').cursor();

    let migrated = 0;

    for await (const user of users) {
        if (isArgon2Hash(user.password_hash)) {
            continue;
        }

        user.password_hash = await hashPassword(user.password_show);
        await user.save();
        migrated++;
    }

    console.log(`[Migration] Password hash migration complete: ${migrated} migrated`);
}
