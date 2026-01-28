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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TrackedChannelsService } from './tracked-channels.service';
import { CreateTrackedChannelDto, UpdateTrackedChannelDto } from './dto/tracked-channel.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Tracked Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tracked-channels')
export class TrackedChannelsController {
  constructor(private readonly trackedChannelsService: TrackedChannelsService) {}

  @Post()
  @ApiOperation({ summary: 'Add a new tracked channel' })
  create(@Request() req, @Body() createDto: CreateTrackedChannelDto) {
    return this.trackedChannelsService.create(req.user.id, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tracked channels for current user' })
  findAll(@Request() req) {
    return this.trackedChannelsService.findAllByUser(req.user.id);
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

  @Get(':id')
  @ApiOperation({ summary: 'Get a tracked channel by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.trackedChannelsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a tracked channel' })
  update(
    @Param('id') id: string,
    @Request() req,
    @Body() updateDto: UpdateTrackedChannelDto,
  ) {
    return this.trackedChannelsService.update(id, req.user.id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a tracked channel' })
  remove(@Param('id') id: string, @Request() req) {
    return this.trackedChannelsService.remove(id, req.user.id);
  }
}
