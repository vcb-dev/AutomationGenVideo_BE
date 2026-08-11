import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CharactersService } from './characters.service';
import { AdminOrInternalGuard } from './guards/admin-or-internal.guard';
import { CreateCharacterDto, UpdateCharacterDto, CharacterQueryDto } from './dto';

/**
 * Quản lý CRUD nhân vật AI (system_prompt) — chỉ ADMIN/MANAGER với người dùng thật.
 * Riêng lệnh gọi server-to-server trong nội bộ BE được phép qua header x-internal-token
 * (xem AdminOrInternalGuard) — dùng cho luồng /ai/content-transform/transform lấy system_prompt.
 */
@ApiTags('Characters (Admin)')
@ApiBearerAuth()
@UseGuards(AdminOrInternalGuard)
@Controller('characters')
export class CharactersController {
  constructor(private readonly service: CharactersService) {}

  @Get('admin')
  @ApiOperation({ summary: 'Danh sách đầy đủ nhân vật (phân trang), kể cả is_active = false' })
  async findAllAdmin(@Query() query: CharacterQueryDto) {
    return this.service.findAllAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết 1 nhân vật (kèm system_prompt đầy đủ)' })
  async findOne(@Param('id') id: string) {
    return this.service.findOneAdmin(id);
  }

  @Post()
  @ApiOperation({ summary: 'Tạo nhân vật mới' })
  async create(@Request() req: any, @Body() dto: CreateCharacterDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa từng phần — bắt buộc gửi updated_at đã tải để chống ghi đè' })
  async update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateCharacterDto) {
    return this.service.update(req.user.id, id, dto);
  }

  @Get(':id/system-prompt-history')
  @ApiOperation({ summary: 'Lịch sử các bản cũ của system_prompt (mới nhất trước)' })
  async getSystemPromptHistory(@Param('id') id: string) {
    return this.service.getSystemPromptHistory(id);
  }
}
