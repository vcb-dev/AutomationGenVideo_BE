import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ClassSerializerInterceptor,
  UseInterceptors,
  Request,
  Query,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { SkipThrottle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserResponseDto } from "./dto/user-response.dto";
import { GetEditorStatsQueryDto, MyEditorsResponseDto } from "./dto/editor-stats.dto";
import { UploadAvatarDto } from "./dto/upload-avatar.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@prisma/client";
import * as path from "path";
import * as fs from "fs";

@ApiTags("users")
@Controller("users")
@SkipThrottle({ long: true, short: true })
@UseInterceptors(ClassSerializerInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new user (Admin only)" })
  @ApiResponse({
    status: 201,
    description: "User created successfully",
    type: UserResponseDto,
  })
  @ApiResponse({ status: 409, description: "Email already exists" })
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.usersService.create(createUserDto);
    return new UserResponseDto(user);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all users (Admin and Manager only)" })
  @ApiResponse({
    status: 200,
    description: "List of users",
    type: [UserResponseDto],
  })
  async findAll() {
    const users = await this.usersService.findAll();
    return users.map((user) => new UserResponseDto(user));
  }

  @Get("my-editors")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all editors managed by current manager with their channel statistics" })
  @ApiResponse({
    status: 200,
    description: "List of editors with statistics",
    type: MyEditorsResponseDto,
  })
  async getMyEditors(@Request() req, @Query() query: GetEditorStatsQueryDto) {
    return this.usersService.getMyEditors(req.user.id, query.platform);
  }

  @Get("team-members")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.LEADER)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get team members based on caller role (HR management)" })
  @ApiResponse({ status: 200, description: "List of team members" })
  async getTeamMembers(@Request() req) {
    return this.usersService.getTeamMembers(req.user.id, req.user.roles);
  }

  @Get("unassigned")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.LEADER)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get members not yet assigned to a team (shared pool, claimable by any leader)" })
  @ApiResponse({ status: 200, description: "List of unassigned members" })
  async getUnassignedMembers() {
    return this.usersService.getUnassignedMembers();
  }

  @Post("hr")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.LEADER)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create user (HR management — scope by role)" })
  @ApiResponse({ status: 201, description: "User created", type: UserResponseDto })
  @ApiResponse({ status: 409, description: "Email already exists" })
  async createHR(@Request() req, @Body() createUserDto: CreateUserDto) {
    const user = await this.usersService.createHR(req.user.id, req.user.roles, createUserDto);
    return new UserResponseDto(user);
  }

  @Patch(":id/hr")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.LEADER)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update user (HR management — scope by role)" })
  @ApiResponse({ status: 200, description: "User updated", type: UserResponseDto })
  async updateHR(@Request() req, @Param("id") id: string, @Body() updateUserDto: UpdateUserDto) {
    const user = await this.usersService.updateHR(req.user.id, req.user.roles, id, updateUserDto);
    return new UserResponseDto(user);
  }

  @Patch(":id/deactivate")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.LEADER)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Deactivate user (soft delete — scope by role)" })
  @ApiResponse({ status: 200, description: "User deactivated" })
  async deactivate(@Request() req, @Param("id") id: string) {
    return this.usersService.deactivate(req.user.id, req.user.roles, id);
  }

  @Patch(":id/reactivate")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.LEADER)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Reactivate user (scope by role)" })
  @ApiResponse({ status: 200, description: "User reactivated" })
  async reactivate(@Request() req, @Param("id") id: string) {
    return this.usersService.reactivate(req.user.id, req.user.roles, id);
  }

  @Get("available-managers")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get list of available managers for selection" })
  @ApiResponse({
    status: 200,
    description: "List of managers",
  })
  async getAvailableManagers() {
    return this.usersService.getAvailableManagers();
  }

  @Get("available-leaders")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get list of available leaders for selection" })
  @ApiResponse({
    status: 200,
    description: "List of leaders",
  })
  async getAvailableLeaders() {
    return this.usersService.getAvailableLeaders();
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get user by ID" })
  @ApiResponse({
    status: 200,
    description: "User found",
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async findOne(@Param("id") id: string) {
    const user = await this.usersService.findOne(id);
    return new UserResponseDto(user);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update user (Admin only)" })
  @ApiResponse({
    status: 200,
    description: "User updated successfully",
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: "User not found" })
  async update(@Request() req, @Param("id") id: string, @Body() updateUserDto: UpdateUserDto) {
    // Đi qua updateHR (không gọi usersService.update() thẳng) để roles/team đổi ở đây cũng
    // được đồng bộ vào Team/TeamMember/leader_id — route này chỉ ADMIN gọi được nên luôn
    // đi nhánh isManagerOrAdmin của updateHR, hành vi với các field khác giữ nguyên như cũ.
    const user = await this.usersService.updateHR(req.user.id, req.user.roles, id, updateUserDto);
    return new UserResponseDto(user);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete user (Admin only)" })
  @ApiResponse({ status: 200, description: "User deleted successfully" })
  @ApiResponse({ status: 404, description: "User not found" })
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }

  @Patch("select-manager/:managerId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MEMBER)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Select a manager for current user (MEMBER only)" })
  @ApiResponse({
    status: 200,
    description: "Manager assigned successfully",
  })
  async selectManager(@Request() req, @Param("managerId") managerId: string) {
    return this.usersService.selectManager(req.user.id, managerId);
  }

  @Post("upload-avatar")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload avatar for current user" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({ type: UploadAvatarDto })
  @ApiResponse({
    status: 200,
    description: "Avatar uploaded successfully",
    schema: {
      properties: {
        success: { type: "boolean" },
        image_url: { type: "string" },
        message: { type: "string" },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid file type or size" })
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = path.join(process.cwd(), "uploads", "avatars");
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          const filename = `avatar_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
          cb(null, filename);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, cb) => {
        const allowedMimeTypes = /^image\/(jpeg|jpg|png|webp)$/;
        if (allowedMimeTypes.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`File type not supported: ${file.mimetype}. Only JPEG, PNG, WebP allowed.`), false);
        }
      },
    })
  )
  async uploadAvatar(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    return this.usersService.uploadAvatar(req.user.id, file);
  }
}
