import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { UpdateApiKeyDto } from "./dto/update-api-key.dto";

/**
 * Quản trị API key cho hệ thống ngoài gọi vào BE. Chỉ ADMIN.
 * Key thô chỉ xuất hiện đúng 1 lần trong response của `POST /api-keys`.
 */
@ApiTags("api-keys")
@ApiBearerAuth()
@SkipThrottle({ long: true, short: true })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: "Cấp API key mới (trả về key thô 1 lần duy nhất)" })
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: { id: string }) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: "Danh sách API key (không kèm key thô/hash)" })
  list() {
    return this.service.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Chi tiết một API key" })
  getOne(@Param("id") id: string) {
    return this.service.getOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Đổi nhãn / bật-tắt / hạn dùng của API key" })
  update(@Param("id") id: string, @Body() dto: UpdateApiKeyDto) {
    return this.service.update(id, dto);
  }

  @Post(":id/revoke")
  @ApiOperation({ summary: "Thu hồi vĩnh viễn API key" })
  revoke(@Param("id") id: string) {
    return this.service.revoke(id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Xoá hẳn API key + tài khoản dịch vụ đi kèm" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
