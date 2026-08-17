import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaClient();

  console.log('=== Records with status = FAILED (transform itself failed) ===');
  const failedTransforms = await prisma.contentTransformHistory.findMany({
    where: { status: 'FAILED' },
    orderBy: { created_at: 'desc' },
    take: 30,
    select: { id: true, created_at: true, input_text: true, error_message: true, duration_ms: true, model_used: true },
  });
  console.log(`Found ${failedTransforms.length} FAILED transform records`);
  failedTransforms.forEach((r) => {
    console.log(`- ${r.created_at.toISOString()} | input_len=${r.input_text.length} | duration_ms=${r.duration_ms} | error="${r.error_message}"`);
  });

  console.log('\n=== Records with output_text present but score_result NULL (scoreStatus=failed) ===');
  const failedScores = await prisma.contentTransformHistory.findMany({
    where: { status: 'SUCCESS', output_text: { not: null }, score_result: { equals: undefined } },
    orderBy: { created_at: 'desc' },
    take: 50,
    select: { id: true, created_at: true, input_text: true, output_text: true, duration_ms: true, score_result: true },
  });
  // Prisma JSON null filtering is tricky; filter in JS too
  const trueNulls = failedScores.filter((r) => r.score_result === null);
  console.log(`Found ${trueNulls.length} records with score_result === null (out of ${failedScores.length} candidates checked)`);
  trueNulls.forEach((r) => {
    console.log(`- ${r.created_at.toISOString()} | input_len=${r.input_text.length} | output_len=${r.output_text?.length} | duration_ms(transform only)=${r.duration_ms}`);
  });

  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
