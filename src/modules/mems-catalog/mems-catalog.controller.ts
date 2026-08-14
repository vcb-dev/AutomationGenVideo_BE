import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateAssetDto, CreateCategoryDto, CreateModelDto } from './dto';
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

  @Get('assets/:assetCode')
  @ApiOperation({ summary: 'Chi tiết thiết bị kèm nhật ký vòng đời (MH-03)' })
  assetDetail(@Param('assetCode') assetCode: string) {
    return this.service.assetDetail(assetCode);
  }

  @Post('assets')
  @ApiOperation({ summary: 'Nhập kho thiết bị mới (NV-01)' })
  createAsset(@Body() dto: CreateAssetDto) {
    return this.service.createAsset(dto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Danh mục thiết bị, cho dropdown form nhập kho' })
  listCategories() {
    return this.service.listCategories();
  }

  @Get('models')
  @ApiOperation({ summary: 'Danh sách model, kèm phụ kiện và số máy đang có' })
  listModels(@Query('categoryId') categoryId?: string) {
    return this.service.listModels({ categoryId });
  }

  @Post('models')
  @ApiOperation({ summary: 'Khai model mới kèm phụ kiện (NV-03)' })
  createModel(@Body() dto: CreateModelDto) {
    return this.service.createModel(dto);
  }

  @Get('locations')
  @ApiOperation({ summary: 'Vị trí lưu trữ trong kho' })
  listLocations() {
    return this.service.listLocations();
  }

  @Post('categories')
  @ApiOperation({ summary: 'Tạo danh mục thiết bị (NV-02)' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.service.createCategory(dto);
  }
}
