import { Controller, Get, Post } from '@nestjs/common';
import { BusinessConnectionsService } from './business-connections.service';

@Controller('business-connections')
export class BusinessConnectionsController {
  constructor(private readonly businessConnectionsService: BusinessConnectionsService) {}

  @Get()
  async findAll() {
    return this.businessConnectionsService.findAll();
  }

  @Post('seed')
  async seed() {
    return this.businessConnectionsService.seedData();
  }
}
