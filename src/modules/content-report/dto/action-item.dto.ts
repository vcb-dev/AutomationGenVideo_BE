import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateActionItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  team_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  period_id: string;

  @ApiPropertyOptional({ description: 'Assignee user ID' })
  @IsString()
  @IsOptional()
  assignee_id?: string;

  @ApiPropertyOptional({ example: 'Đỗ Thị Nga', description: 'Assignee full name' })
  @IsString()
  @IsOptional()
  assignee?: string;

  @ApiProperty({ example: 'Cải thiện hook 3 giây đầu' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({ default: 'PENDING' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: 'MEDIUM' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leader_comment?: string;
}

export class UpdateActionItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignee_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignee?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leader_comment?: string;
}
