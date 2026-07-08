import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTeamDto {
  @ApiProperty({ example: 'K1', description: 'Tên team (unique)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;
}
