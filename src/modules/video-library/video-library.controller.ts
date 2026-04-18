import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    Request,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { VideoLibraryService } from './video-library.service';
import { SaveToLibraryDto } from './dto/video-library.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CollectionType, UserRole } from '@prisma/client';

@ApiTags('video-library')
@Controller('video-library')
@SkipThrottle({ long: true, short: true })
@ApiBearerAuth()
export class VideoLibraryController {
    constructor(private readonly service: VideoLibraryService) {}

    @Post('save')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Save a video to collection (TEAM for Leader, SHARED for Admin/Manager)' })
    async save(@Body() dto: SaveToLibraryDto, @Request() req) {
        const user = req.user;
        const role: UserRole = user?.roles?.[0] ?? user?.role ?? UserRole.MEMBER;
        const userId: string = user?.id ?? user?.sub ?? '';
        const userName: string = user?.name ?? user?.email ?? 'Unknown';
        return this.service.save(dto, userId, userName, role);
    }

    @Get('saved-ids')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get all video_ids already saved (for filtering search results)' })
    async getSavedIds() {
        const ids = await this.service.getAllSavedVideoIds();
        return { ids };
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get curated videos by collection type' })
    @ApiQuery({ name: 'type', enum: CollectionType, required: true })
    async findAll(@Query('type') type: CollectionType) {
        const collectionType = type === CollectionType.TEAM ? CollectionType.TEAM : CollectionType.SHARED;
        return this.service.getByType(collectionType);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Remove a video from the library' })
    async remove(@Param('id') id: string, @Request() req) {
        const user = req.user;
        const role: UserRole = user?.roles?.[0] ?? user?.role ?? UserRole.MEMBER;
        const userId: string = user?.id ?? user?.sub ?? '';
        return this.service.remove(id, userId, role);
    }
}
