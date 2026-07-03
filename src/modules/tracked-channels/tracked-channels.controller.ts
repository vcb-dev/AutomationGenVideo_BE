import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TrackedChannelsService } from './tracked-channels.service';
import { CreateTrackedChannelDto, UpdateTrackedChannelDto } from './dto/tracked-channel.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Tracked Channels')
@ApiBearerAuth()
@SkipThrottle({ long: true, short: true })
@UseGuards(JwtAuthGuard)
@Controller('tracked-channels')
export class TrackedChannelsController {
  constructor(
    private readonly trackedChannelsService: TrackedChannelsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Add a new tracked channel' })
  create(@Request() req, @Body() createDto: CreateTrackedChannelDto) {
    return this.trackedChannelsService.create(req.user.id, createDto);
  }


  @Get()
  @ApiOperation({ summary: 'Get all tracked channels for current user' })
  findAll(@Request() req, @Query('platform') platform?: string, @Query('team') team?: string) {
    return this.trackedChannelsService.findAllByUser(req.user.id, platform, team);
  }

  @Get('my-channels')
  @ApiOperation({ summary: 'Get my tracked channels, optionally filtered by platform and/or team' })
  getMyChannels(@Request() req, @Query('platform') platform?: string, @Query('team') team?: string) {
    return this.trackedChannelsService.getMyChannels(req.user.id, platform, team);
  }

  @Get('by-username/:platform/:username')
  @ApiOperation({ summary: 'Get a tracked channel by platform and username' })
  findByUsername(
    @Param('platform') platform: string,
    @Param('username') username: string,
    @Request() req
  ) {
    return this.trackedChannelsService.findByUsername(platform, username, req.user.id);
  }

  @Get('manager/dashboard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get manager dashboard with all platform statistics' })
  getManagerDashboard(@Request() req) {
    return this.trackedChannelsService.getManagerDashboard(req.user.id);
  }

  @Get('manager/channels/:platform')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all channels for a specific platform (manager only)' })
  getChannelsByPlatform(@Param('platform') platform: string) {
    return this.trackedChannelsService.getChannelsByPlatform(platform);
  }

  @Get('manager/all-channels')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all channels across all platforms (manager only)' })
  getAllChannels() {
    return this.trackedChannelsService.getAllChannels();
  }

  @Get('manager/channel-hashtag-stats/:channelId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get hashtag statistics for a specific channel (manager only)' })
  getChannelHashtagStatsGet(@Param('channelId') channelId: string) {
    return this.trackedChannelsService.getChannelHashtagStats(channelId, false);
  }

  @Post('manager/channel-hashtag-stats/:channelId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Force refresh hashtag statistics for a specific channel (manager only)' })
  getChannelHashtagStatsPost(@Param('channelId') channelId: string) {
    return this.trackedChannelsService.getChannelHashtagStats(channelId, true);
  }

  @Post('enrich-stale')
  @ApiOperation({
    summary: 'Tự động làm mới các kênh chưa có data (last_synced_at = null), tối đa 3 kênh/lần',
  })
  enrichStale(@Request() req: { user: { id: string } }) {
    return this.trackedChannelsService.enrichStaleChannels(req.user.id);
  }

  @Post(':id/enrich-apify')
  @ApiOperation({
    summary: 'Làm mới số liệu kênh (followers, likes…) qua Apify — Facebook, Instagram, TikTok, Douyin, Xiaohongshu',
  })
  enrichApify(@Param('id') id: string, @Request() req: { user: { id: string } }) {
    return this.trackedChannelsService.enrichChannelById(id, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a tracked channel by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.trackedChannelsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.LEADER)
  @ApiOperation({ summary: 'Update a tracked channel (ADMIN/MANAGER/LEADER only)' })
  update(
    @Param('id') id: string,
    @Request() req,
    @Body() updateDto: UpdateTrackedChannelDto,
  ) {
    return this.trackedChannelsService.update(id, req.user.id, updateDto);
  }

  @Post(':id/check')
  @ApiOperation({ summary: 'Trigger a manual check/sync for a tracked channel' })
  checkChannel(@Param('id') id: string, @Request() req) {
    return this.trackedChannelsService.checkChannel(id, req.user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.LEADER)
  @ApiOperation({ summary: 'Remove a tracked channel (ADMIN/MANAGER/LEADER only)' })
  remove(@Param('id') id: string, @Request() req) {
    return this.trackedChannelsService.remove(id, req.user.id);
  }
}
