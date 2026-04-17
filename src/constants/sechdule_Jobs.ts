// create schedule job
import account_authService from '../services/account_auth.service';
import schedule from 'node-schedule';

export function schedule_jobs() {
    // schedule job for every day at 03:00 AM
    schedule.scheduleJob('00 03 * * *', async function () {
        clear_auth_accounts_web();
    });
}

async function clear_auth_accounts_web(): Promise<void> {
    await account_authService.clearBy({
        filter: {
            type: { $in: ['admin', 'manager'] },
        },
    });
}
