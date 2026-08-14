import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateAssetDto, CreateCategoryDto, CreateModelDto, InspectAssetDto } from './dto';
import { InspectionService } from './inspection.service';
import { MemsCatalogService } from './mems-catalog.service';

@ApiTags('MEMS — Kho thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsCatalogController {
  constructor(
    private readonly service: MemsCatalogService,
    private readonly inspection: InspectionService,
  ) {}

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

  @Roles(UserRole.LEADER, UserRole.MANAGER)
  @Get('pending-inspection')
  @ApiOperation({ summary: 'Máy đang chờ kết luận kiểm tra (NV-14)' })
  pendingInspection() {
    return this.inspection.listPending();
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER)
  @Post('assets/:assetCode/inspect')
  @ApiOperation({ summary: 'Kết luận kiểm tra, đưa máy ra khỏi bàn nhận (NV-14)' })
  inspect(
    @Request() req: any,
    @Param('assetCode') assetCode: string,
    @Body() dto: InspectAssetDto,
  ) {
    return this.inspection.inspect(assetCode, req.user.id, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER)
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

  @Roles(UserRole.LEADER, UserRole.MANAGER)
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

  @Roles(UserRole.LEADER, UserRole.MANAGER)
  @Post('categories')
  @ApiOperation({ summary: 'Tạo danh mục thiết bị (NV-02)' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.service.createCategory(dto);
  }
}
