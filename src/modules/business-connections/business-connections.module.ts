import { Module } from '@nestjs/common';
import { BusinessConnectionsService } from './business-connections.service';
import { BusinessConnectionsController } from './business-connections.controller';

@Module({
  controllers: [BusinessConnectionsController],
  providers: [BusinessConnectionsService],
})
export class BusinessConnectionsModule {}
