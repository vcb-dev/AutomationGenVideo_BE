import * as cron from 'node-cron';
import { exec } from 'child_process';
import * as path from 'path';

const AI_DIR = path.join(__dirname, '..', '..', 'AutomationGenVideo_AI');
const PYTHON  = path.join(AI_DIR, 'venv', 'bin', 'python3');

function runSocialSync(): void {
  console.log('[Scheduler] Bắt đầu đồng bộ dữ liệu...');

  exec(`${PYTHON} ${path.join(AI_DIR, 'cron_meta_insights.py')}`, (err, stdout) => {
    if (err) console.error('[Scheduler] Lỗi Social Sync:', err.message);
    else console.log('[Scheduler] Social Sync hoàn tất.', stdout.slice(0, 200));
  });

  exec(`${PYTHON} ${path.join(AI_DIR, ' c')}`, (err, stdout) => {
    if (err) console.error('[Scheduler] Lỗi Ads Sync:', err.message);
    else console.log('[Scheduler] Ads Sync hoàn tất.', stdout.slice(0, 200));
  });
}

export function initSocialSyncCron(): void {
  cron.schedule('0 1 * * *', runSocialSync, { timezone: 'Asia/Ho_Chi_Minh' });
  console.log('[Scheduler] Đã kích hoạt lịch đồng bộ: 01:00 AM hàng ngày (ICT).');
}

export { runSocialSync };
