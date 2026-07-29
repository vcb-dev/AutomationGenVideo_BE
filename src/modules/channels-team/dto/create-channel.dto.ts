import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsOptional, IsNotEmpty, IsUUID } from "class-validator";

export class CreateChannelDto {
  @ApiProperty({ example: "Kênh TikTok chính" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: "tiktok" })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({ example: "UCxxxxxxxxxxxxxxxx", description: "ID kênh trên platform (channel_id)" })
  @IsString()
  @IsOptional()
  channel_id?: string;

  @ApiPropertyOptional({ example: "https://tiktok.com/@myChannel" })
  @IsString()
  @IsOptional()
  link_channel?: string;

  @ApiPropertyOptional({ example: "active" })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: "ID của User sở hữu kênh (FK → users.id)" })
  @IsUUID()
  @IsOptional()
  owner_id?: string;

  // team_id KHÔNG nhận từ client — tự động gán từ req.user.team
}
