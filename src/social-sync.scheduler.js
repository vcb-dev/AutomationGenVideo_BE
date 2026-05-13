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
    
    const command = `${pythonPath} ${scriptPath}`;
    
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Scheduler] Lỗi khi chạy script: ${error.message}`);
            return;
        }
        if (stderr) {
            console.warn(`[Scheduler] Cảnh báo: ${stderr}`);
        }
        console.log(`[Scheduler] Đồng bộ hoàn tất thành công!\nKết quả:\n${stdout}`);
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
