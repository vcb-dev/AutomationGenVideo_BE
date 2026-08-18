import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  Request,
  HttpCode,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { CreateChannelDto } from "./dto/create-channel.dto";
import { UpdateChannelDto } from "./dto/update-channel.dto";
import { ChannelsService } from "./channels.service";
import { ChannelResponseDto } from "./dto/response-channel.dto";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";

@ApiTags("channels")
@Controller("channels")
@SkipThrottle({ long: true, short: true })
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
@ApiBearerAuth()
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  @ApiOperation({ summary: "Create a new channel (all roles, auto-assigns owner & team)" })
  @ApiResponse({ status: 201, type: ChannelResponseDto })
  async create(@Body() dto: CreateChannelDto, @Request() req) {
    const channel = await this.channelsService.create(dto, req.user);
    return new ChannelResponseDto(channel);
  }

  @Post("scraper-lookup")
  @HttpCode(200)
  @ApiOperation({ summary: "Bulk lookup team/owner by channel URLs or platform IDs (no team filter)" })
  async scraperLookup(@Body() body: { identifiers?: string[] }) {
    return this.channelsService.lookupByIdentifiers(body.identifiers ?? []);
  }

  @Get("meta-connected")
  @ApiOperation({ summary: "Get all Meta/Social accounts connected via OAuth" })
  async getConnectedMeta(@Request() req) {
    return this.channelsService.getConnectedMetaChannels(req.user);
  }

  @Post("import-from-meta")
  @HttpCode(200)
  @ApiOperation({ summary: "Bulk import selected Meta channels into team channels" })
  async importFromMeta(
    @Body() body: { channels: Array<{ platform: string; name: string; channel_id: string; link_channel?: string }> },
    @Request() req,
  ) {
    return this.channelsService.importFromMeta(body.channels || [], req.user);
  }

  @Get("my")
  @ApiOperation({ summary: "Get channels owned by the current user" })
  @ApiResponse({ status: 200, type: [ChannelResponseDto] })
  async findMine(@Request() req) {
    const channels = await this.channelsService.findMine(req.user);
    return channels.map((c) => new ChannelResponseDto(c));
  }


  @Get()
  @ApiOperation({ summary: "Get all channels belonging to current user's team" })
  @ApiResponse({ status: 200, type: [ChannelResponseDto] })
  async findAll(@Request() req) {
    const channels = await this.channelsService.findAll(req.user);
    return channels.map((c) => new ChannelResponseDto(c));
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a channel by ID (must belong to same team)" })
  @ApiResponse({ status: 200, type: ChannelResponseDto })
  @ApiResponse({ status: 403, description: "Access denied" })
  @ApiResponse({ status: 404, description: "Channel not found" })
  async findOne(@Param("id") id: string, @Request() req) {
    const channel = await this.channelsService.findOne(id, req.user);
    return new ChannelResponseDto(channel);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a channel (channel owner, LEADER of same team, or ADMIN/MANAGER for any team)" })
  @ApiResponse({ status: 200, type: ChannelResponseDto })
  @ApiResponse({ status: 403, description: "Only the channel owner, LEADER of this team, MANAGER or ADMIN can update" })
  @ApiResponse({ status: 404, description: "Channel not found" })
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateChannelDto,
    @Request() req,
  ) {
    const channel = await this.channelsService.update(id, dto, req.user);
    return new ChannelResponseDto(channel);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a channel (channel owner, LEADER of same team, or ADMIN/MANAGER for any team; not tracked)" })
  @ApiResponse({ status: 200, description: "Channel deleted successfully" })
  @ApiResponse({ status: 403, description: "Only the channel owner, LEADER of this team, MANAGER or ADMIN can delete" })
  @ApiResponse({ status: 404, description: "Channel not found" })
  @ApiResponse({ status: 409, description: "Channel is currently being tracked" })
  async remove(@Param("id") id: string, @Request() req) {
    return this.channelsService.remove(id, req.user);
  }
}