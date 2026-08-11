import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateAssetDto, CreateCategoryDto } from './dto';
import { MemsCatalogService } from './mems-catalog.service';

@ApiTags('MEMS — Kho thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('mems')
export class MemsCatalogController {
  constructor(private readonly service: MemsCatalogService) {}

  @Get('assets')
  @ApiOperation({ summary: 'Danh sách thiết bị trong kho (MH-02)' })
  listAssets(@Query('categoryId') categoryId?: string, @Query('status') status?: string) {
    return this.service.listAssets({ categoryId, status });
  }

  @Post('assets')
  @ApiOperation({ summary: 'Nhập kho thiết bị mới (NV-01)' })
  createAsset(@Body() dto: CreateAssetDto) {
    return this.service.createAsset(dto);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Tạo danh mục thiết bị (NV-02)' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.service.createCategory(dto);
  }
}
