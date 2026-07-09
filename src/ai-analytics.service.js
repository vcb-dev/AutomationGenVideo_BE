const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

/**
 * Cung cấp schema của 3 bảng chính cho AI hiểu
 */
const DB_SCHEMA_CONTEXT = `
Bảng 1: social_video_report (Dữ liệu organic)
- platform: 'youtube', 'facebook', 'instagram'
- channel_name, views, likes, comments, shares, followers, team, owner, published_at

Bảng 2: ads_campaign_stats (Dữ liệu quảng cáo)
- platform: 'meta', 'tiktok'
- campaign_name, spend, impressions, clicks, mess_count, team, owner, date_start

Bảng 3: huyk_channels (Metadata kênh)
- platform, name, team_traffic, owner, follower_count
`;

async function askAI(question) {
    try {
        console.log(`[AI] Đang xử lý câu hỏi: ${question}`);

        // 1. Gửi yêu cầu tới DeepSeek để chuyển câu hỏi thành SQL
        const prompt = `
        Bạn là một chuyên gia phân tích dữ liệu. Dưới đây là cấu trúc Database:
        ${DB_SCHEMA_CONTEXT}
        
        Nhiệm vụ: Chuyển câu hỏi tiếng Việt của người dùng thành một câu lệnh SQL SELECT (PostgreSQL).
        Chỉ trả về DUY NHẤT câu lệnh SQL, không giải thích thêm.
        Câu hỏi: "${question}"
        `;

        const response = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
            temperature: 0
        }, {
            headers: { 'Authorization': `Bearer ${DEEPSEEK_KEY}` }
        });

        let sql = response.data.choices[0].message.content.replace(/```sql|```/g, "").strip();
        console.log(`[AI] SQL tạo ra: ${sql}`);

        // 2. Thực thi SQL trên Database
        const results = await prisma.$queryRawUnsafe(sql);

        // 3. Gửi kết quả lại cho AI để nó giải thích bằng tiếng Việt
        const summaryPrompt = `
        Dựa trên kết quả dữ liệu này từ Database:
        ${JSON.stringify(results, (key, value) => typeof value === 'bigint' ? value.toString() : value)}
        
        Hãy trả lời câu hỏi "${question}" của người dùng một cách chuyên nghiệp, ngắn gọn bằng tiếng Việt.
        `;

        const summaryRes = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-chat",
            messages: [{ role: "user", content: summaryPrompt }]
        }, {
            headers: { 'Authorization': `Bearer ${DEEPSEEK_KEY}` }
        });

        return {
            answer: summaryRes.data.choices[0].message.content,
            data: results,
            sql: sql
        };

    } catch (error) {
        console.error(`[AI] Lỗi: ${error.message}`);
        throw error;
    }
}

module.exports = { askAI };
