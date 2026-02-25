const fs = require('fs');
const path = require('path');

const schemaPath = path.join(process.cwd(), 'prisma/schema.prisma');
let content = fs.readFileSync(schemaPath, 'utf-8');

// Remove relations in User model
content = content.replace(/.*duplicate_reviews.*DuplicateReview\[\].*[\r\n]+/g, '');
content = content.replace(/.*activity_logs.*UserActivityLog\[\].*[\r\n]+/g, '');
content = content.replace(/.*rate_limits.*UserRateLimit\[\].*[\r\n]+/g, '');
content = content.replace(/.*usage_stats.*UserUsageStat\[\].*[\r\n]+/g, '');
content = content.replace(/.*search_histories.*SearchHistory\[\].*[\r\n]+/g, '');

// Remove relations in Video model
content = content.replace(/.*new_video_reviews.*DuplicateReview\[\].*[\r\n]+/g, '');
content = content.replace(/.*suspected_reviews.*DuplicateReview\[\].*[\r\n]+/g, '');

// Function to meticulously remove a block starting with 'model Name' until '}'
function removeModel(modelName) {
    const regex = new RegExp(`model\\s+${modelName}\\s+\\{[\\s\\S]*?\\}\\r?\\n`, 'g');
    content = content.replace(regex, '');
}

['UserActivityLog', 'UserUsageStat', 'UserRateLimit', 'DuplicateReview', 'SearchHistory'].forEach(removeModel);

fs.writeFileSync(schemaPath, content, 'utf-8');
console.log('Cleaned schema.prisma');
