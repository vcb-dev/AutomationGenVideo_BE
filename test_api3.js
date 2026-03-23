const { Test, TestingModule } = require('@nestjs/testing');
const { PrismaClient } = require('@prisma/client');
const { LarkService } = require('./dist/modules/lark-sync/lark.service');
const { PrismaService } = require('./dist/prisma/prisma.service');
const { HttpModule } = require('@nestjs/axios');

async function runTest() {
  const moduleRef = await Test.createTestingModule({
    imports: [HttpModule],
    providers: [
      LarkService,
      PrismaService
    ],
  }).compile();

  const larkService = moduleRef.get(LarkService);
  const result = await larkService.getUserActivityReports();
  const report = result.reports.find(r => r.name === 'BẢO VIỆT' || r.email === 'haducbaoviet0911@gmail.com' || (r.name && r.name.toLowerCase().includes('việt')));
  console.log('Total reports array length:', result.reports.length);
  if (report) {
     console.log('Yes! Found in reports array!');
     console.log(JSON.stringify(report, null, 2));
  } else {
     console.log('No, entirely missing from reports array!');
  }
}
runTest().catch(console.error);
