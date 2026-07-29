import { IsString, IsNotEmpty, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PeriodType } from '@prisma/client';

export class CreatePeriodDto {
  @ApiProperty({ enum: PeriodType, example: 'WEEK' })
  @IsEnum(PeriodType)
  type: PeriodType;

  @ApiProperty({ example: 'Tuần 1 - T6/2026' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ example: '2026-06-02T00:00:00.000Z' })
  @IsDateString()
  start_date: string;

  @ApiProperty({ example: '2026-06-08T23:59:59.999Z' })
  @IsDateString()
  end_date: string;
}
