import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

type ChannelWithRelations = {
  id: string;
  name: string;
  platform?: string | null;
  channel_id?: string | null;
  link_channel?: string | null;
  status?: string | null;
  team_id?: string | null;
  owner_id?: string | null;
  created_at: Date;
  updated_at: Date;
  team?: { id: string; name: string } | null;
  owner?: { id: string; full_name: string; email: string } | null;
};

export class ChannelResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() platform?: string | null;
  @ApiPropertyOptional() channel_id?: string | null;
  @ApiPropertyOptional() link_channel?: string | null;
  @ApiPropertyOptional() status?: string | null;
  @ApiPropertyOptional() team_id?: string | null;
  @ApiPropertyOptional() owner_id?: string | null;
  @ApiPropertyOptional() team?: { id: string; name: string } | null;
  @ApiPropertyOptional() owner?: { id: string; full_name: string; email: string } | null;
  @ApiProperty() created_at: Date;
  @ApiProperty() updated_at: Date;

  constructor(channel: ChannelWithRelations) {
    this.id = channel.id;
    this.name = channel.name;
    this.platform = channel.platform;
    this.channel_id = channel.channel_id;
    this.link_channel = channel.link_channel;
    this.status = channel.status;
    this.team_id = channel.team_id;
    this.owner_id = channel.owner_id;
    this.team = channel.team ?? null;
    this.owner = channel.owner ?? null;
    this.created_at = channel.created_at;
    this.updated_at = channel.updated_at;
  }
}
