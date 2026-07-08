import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/common/prisma/prisma.service';
import axios from 'axios';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const jwtService = app.get(JwtService);
  const prisma = app.get(PrismaService);

  // Get admin user
  const admin = await prisma.user.findFirst({
    where: { roles: { has: 'ADMIN' } }
  });

  if (!admin) {
    console.error('No admin user found!');
    await app.close();
    return;
  }

  // Sign token
  const token = jwtService.sign({
    sub: admin.id,
    email: admin.email,
    roles: admin.roles
  });

  console.log('✅ Generated JWT token for admin:', admin.email);

  // Get a team and period
  const team = await prisma.team.findFirst();
  const period = await prisma.reportPeriod.findFirst();

  if (!team || !period) {
    console.error('No team or period found!');
    await app.close();
    return;
  }

  console.log('Using Team:', team.name, 'Period:', period.label);

  try {
    const res = await axios.post('http://localhost:3000/api/content-report/content-videos', {
      team_id: team.id,
      period_id: period.id,
      status: 'WIN',
      content: 'Nhấp đúp để nhập nội dung...',
      analysis: 'Nhấp đúp để nhập phân tích...',
      editor: 'Tên Editor',
      post_date: '2026-06-03',
      platform: 'Instagram Reels'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ POST response:', res.data);
  } catch (err: any) {
    if (err.response) {
      console.error('❌ Status:', err.response.status);
      console.error('❌ Data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('❌ Error:', err.message);
    }
  }

  await app.close();
}

main().catch(console.error);
