import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OmsIntegrationService } from './oms-integration.service';
import { QueryOmsProductDto } from './dto/oms-integration.dto';

@ApiTags('task-auto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('task-auto/oms')
export class OmsIntegrationController {
  constructor(private readonly oms: OmsIntegrationService) {}

  @Get('products')
  @ApiOperation({ summary: 'Tìm/duyệt sản phẩm từ OMS (kho tổng, proxy trực tiếp)' })
  listProducts(@Query() query: QueryOmsProductDto) {
    return this.oms.listProducts(query);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Chi tiết 1 sản phẩm OMS kèm danh sách biến thể (SKU)' })
  getProductDetail(@Param('id') id: string) {
    return this.oms.getProductDetail(id);
  }
}
