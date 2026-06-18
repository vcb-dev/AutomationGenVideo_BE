import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsOptional, IsNotEmpty } from "class-validator";

export class CreateChannelDto {
  @ApiProperty({ example: "Kênh TikTok chính" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: "tiktok" })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({ example: "https://tiktok.com/@myChannel" })
  @IsString()
  @IsOptional()
  link_channel?: string;

  @ApiPropertyOptional({ example: "active" })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: "nguyen.van.a@company.com" })
  @IsString()
  @IsOptional()
  owner?: string;

  @ApiPropertyOptional({ example: "user@company.com" })
  @IsString()
  @IsOptional()
  email?: string;

  // team_traffic KHÔNG nhận từ client — tự động gán từ req.user.team
}