require('dotenv').config();
const { askAI } = require('./ai-analytics.service');

async function test() {
    const questions = [
        "Tháng này Team K1 tiêu hết bao nhiêu tiền quảng cáo?",
        "Kênh YouTube nào có lượt xem cao nhất?",
        "Nền tảng nào (Meta hay TikTok) đang có chi phí quảng cáo hiệu quả hơn?"
    ];

    for (const q of questions) {
        console.log(`\n--- Câu hỏi: ${q} ---`);
        try {
            const response = await askAI(q);
            console.log(`🤖 AI trả lời: ${response.answer}`);
        } catch (err) {
            console.error("Lỗi:", err.message);
        }
    }
}

test();
