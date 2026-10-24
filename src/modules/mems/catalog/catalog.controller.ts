import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { MemsMediaLeaderGuard } from '../../../common/guards/mems-media-leader.guard';
import {
  CreateAssetDto,
  CreateCategoryDto,
  CreateLocationDto,
  CreateModelDto,
  ListAssetsQueryDto,
  ListModelsQueryDto,
  UpdateAssetDto,
  UpdateLocationDto,
} from './dto/catalog.dto';
import { MemsCatalogService } from './catalog.service';

@ApiTags('MEMS — Kho thiết bị')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mems')
export class MemsCatalogController {
  constructor(private readonly service: MemsCatalogService) {}

  @Get('assets')
  @ApiOperation({ summary: 'Danh sách thiết bị trong kho (MH-02)' })
  listAssets(@Query() query: ListAssetsQueryDto) {
    return this.service.listAssets({ categoryId: query.categoryId, status: query.status });
  }

  @Get('assets/:assetCode')
  @ApiOperation({ summary: 'Chi tiết thiết bị kèm nhật ký vòng đời (MH-03)' })
  assetDetail(@Param('assetCode') assetCode: string) {
    return this.service.assetDetail(assetCode);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Patch('assets/:assetCode')
  @ApiOperation({ summary: 'Chỉnh sửa thông tin thiết bị' })
  updateAsset(@Param('assetCode') assetCode: string, @Body() dto: UpdateAssetDto) {
    return this.service.updateAsset(assetCode, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Delete('assets/:assetCode')
  @ApiOperation({ summary: 'Xóa thiết bị khỏi kho' })
  deleteAsset(@Param('assetCode') assetCode: string) {
    return this.service.deleteAsset(assetCode);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
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
  listModels(@Query() query: ListModelsQueryDto) {
    return this.service.listModels({ categoryId: query.categoryId });
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
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

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('locations')
  @ApiOperation({ summary: 'Tạo vị trí lưu kho mới (Tủ/Kệ/Ngăn)' })
  createLocation(@Body() dto: CreateLocationDto) {
    return this.service.createLocation(dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Patch('locations/:id')
  @ApiOperation({ summary: 'Sửa tên vị trí lưu kho' })
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.service.updateLocation(id, dto);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Delete('locations/:id')
  @ApiOperation({ summary: 'Xóa/ngừng dùng vị trí lưu kho' })
  deleteLocation(@Param('id') id: string) {
    return this.service.deleteLocation(id);
  }

  @Roles(UserRole.LEADER, UserRole.MANAGER, UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Post('categories')
  @ApiOperation({ summary: 'Tạo danh mục thiết bị (NV-02)' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.service.createCategory(dto);
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Delete('models/:id')
  @ApiOperation({ summary: 'Xóa model thiết bị (Chỉ Admin)' })
  deleteModel(@Param('id') id: string) {
    return this.service.deleteModel(id);
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(MemsMediaLeaderGuard)
  @Delete('categories/:id')
  @ApiOperation({ summary: 'Xóa danh mục thiết bị (Chỉ Admin)' })
  deleteCategory(@Param('id') id: string) {
    return this.service.deleteCategory(id);
  }
}
