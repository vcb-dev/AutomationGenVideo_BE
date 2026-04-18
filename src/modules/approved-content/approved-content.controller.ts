import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    UseGuards,
    Request,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApprovedContentService } from './approved-content.service';
import { CreateApprovedContentDto } from './dto/approved-content.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '@prisma/client';

@ApiTags('approved-content')
@Controller('approved-content')
@SkipThrottle({ long: true, short: true })
@ApiBearerAuth()
export class ApprovedContentController {
    constructor(private readonly service: ApprovedContentService) {}

    @Post()
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Approve and save generated content' })
    async create(@Body() dto: CreateApprovedContentDto, @Request() req) {
        const user = req.user;
        const role: UserRole = user?.roles?.[0] ?? user?.role ?? UserRole.MEMBER;
        const userId: string = user?.id ?? user?.sub ?? '';
        const userName: string = user?.name ?? user?.email ?? 'Unknown';
        return this.service.create(dto, userId, userName, role);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get all approved content' })
    async findAll() {
        return this.service.findAll();
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Remove approved content' })
    async remove(@Param('id') id: string, @Request() req) {
        const user = req.user;
        const role: UserRole = user?.roles?.[0] ?? user?.role ?? UserRole.MEMBER;
        const userId: string = user?.id ?? user?.sub ?? '';
        return this.service.remove(id, userId, role);
    }
}
