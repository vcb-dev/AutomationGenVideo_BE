import { Module } from '@nestjs/common';
import { MemsIncidentsController } from './incidents.controller';
import { MemsIncidentsService } from './incidents.service';

@Module({
  controllers: [MemsIncidentsController],
  providers: [MemsIncidentsService],
})
export class MemsIncidentsModule {}
