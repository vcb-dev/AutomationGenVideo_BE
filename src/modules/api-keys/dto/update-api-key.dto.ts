import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateApiKeyDto {
  @ApiPropertyOptional({ description: "Đổi nhãn nhận diện" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: "Bật / tắt nhanh key mà không thu hồi vĩnh viễn",
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Đổi thời điểm hết hạn (ISO-8601). Gửi null để bỏ hết hạn.",
    nullable: true,
    example: "2026-12-31T23:59:59.000Z",
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}
