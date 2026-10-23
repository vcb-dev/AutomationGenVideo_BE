import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';

export class AssignLineDto {
  @ApiProperty()
  @IsUUID()
  lineId: string;

  @ApiProperty({ type: [String], description: 'Đúng bằng quantity của dòng' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  assetIds: string[];
}

export class AssignSerialsDto {
  @ApiProperty({ type: [AssignLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssignLineDto)
  lines: AssignLineDto[];
}
