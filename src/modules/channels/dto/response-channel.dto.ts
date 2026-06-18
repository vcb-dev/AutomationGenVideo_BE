import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Channel } from "@prisma/client";

export class ChannelResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() platform?: string | null;
  @ApiPropertyOptional() link_channel?: string | null;
  @ApiPropertyOptional() status?: string | null;
  @ApiPropertyOptional() team_traffic?: string | null;
  @ApiPropertyOptional() owner?: string | null;

  constructor(channel: Channel) {
    this.id = channel.id;
    this.name = channel.name;
    this.platform = channel.platform;
    this.link_channel = channel.link_channel;
    this.status = channel.status;
    this.team_traffic = channel.team_traffic;
    this.owner = channel.owner;
  }
}