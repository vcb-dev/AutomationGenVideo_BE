import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { InputType } from '@prisma/client';

export class CreateTransformDto {
  @ApiProperty({ example: 'huyk', description: 'Character ID or slug' })
  @IsString()
  @IsNotEmpty()
  character_id: string;

  @ApiProperty({ example: 'Ý tưởng review nhẫn vàng 18k mới về...', description: 'Raw script input' })
  @IsString()
  @IsNotEmpty()
  input_text: string;

  @ApiProperty({ example: 'TEXT', enum: ['TEXT', 'VIDEO', 'AUDIO'], required: false })
  @IsEnum(['TEXT', 'VIDEO', 'AUDIO'])
  @IsOptional()
  input_type?: InputType;
}
