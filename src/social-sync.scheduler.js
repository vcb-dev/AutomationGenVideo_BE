const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');

/**
 * Hàm thực hiện gọi script Python để crawl dữ liệu
 */
function runSocialSync() {
    console.log('[Scheduler] Bắt đầu quá trình đồng bộ dữ liệu mạng xã hội...');
    
    // Đường dẫn tới venv và script python
    const pythonPath = path.join(__dirname, '../../AutomationGenVideo_AI/venv/bin/python3');
    const scriptPath = path.join(__dirname, '../../AutomationGenVideo_AI/cron_meta_insights.py');
    
    const commandSocial = `${pythonPath} ${scriptPath}`;
    const commandAds = `${pythonPath} ${path.join(__dirname, '../../AutomationGenVideo_AI/cron_ads_sync.py')}`;
    
    // Chạy Social Sync
    exec(commandSocial, (error, stdout, stderr) => {
        if (error) console.error(`[Scheduler] Lỗi Social Sync: ${error.message}`);
        else console.log('[Scheduler] Social Sync hoàn tất.');
    });

    // Chạy Ads Sync
    exec(commandAds, (error, stdout, stderr) => {
        if (error) console.error(`[Scheduler] Lỗi Ads Sync: ${error.message}`);
        else console.log('[Scheduler] Ads Sync hoàn tất.');
    });
}

/**
 * Khởi tạo lịch trình chạy tự động
 */
function initSocialSyncCron() {
    // Chạy vào 01:00 sáng mỗi ngày
    cron.schedule('0 1 * * *', () => {
        runSocialSync();
    });
    
    console.log('[Scheduler] Đã kích hoạt lịch đồng bộ dữ liệu: 01:00 AM hàng ngày.');
    
    // Nếu bạn muốn chạy thử ngay lần đầu khi khởi động server, hãy bỏ comment dòng dưới:
    // runSocialSync();
}

module.exports = { initSocialSyncCron, runSocialSync };
