import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException("Email already exists");
    }

    // Validate manager_id for editors
    if (createUserDto.role === UserRole.EDITOR) {
      if (!createUserDto.manager_id) {
        throw new BadRequestException("manager_id is required for editors");
      }

      const manager = await this.prisma.user.findUnique({
        where: { id: createUserDto.manager_id },
      });

      if (!manager || manager.role !== UserRole.MANAGER) {
        throw new BadRequestException(
          "Invalid manager_id: must reference a user with MANAGER role",
        );
      }
    }

    // Hash password
    const password_hash = await bcrypt.hash(createUserDto.password, 10);

    // Create user - ensure manager_id is null for non-EDITOR roles
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...userData } = createUserDto;
    const user = await this.prisma.user.create({
      data: {
        ...userData,
        password_hash,
        manager_id:
          createUserDto.role === UserRole.EDITOR
            ? createUserDto.manager_id
            : null,
      },
    });

    return user;
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        manager_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        manager_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // If updating email, check for conflicts
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: updateUserDto.email },
      });

      if (existingUser) {
        throw new ConflictException("Email already exists");
      }
    }

    // Validate manager_id for editors
    if (
      updateUserDto.role === UserRole.EDITOR ||
      user.role === UserRole.EDITOR
    ) {
      const newManagerId = updateUserDto.manager_id ?? user.manager_id;
      if (!newManagerId) {
        throw new BadRequestException("manager_id is required for editors");
      }
    }

    // Hash password if provided
    const updateData: any = { ...updateUserDto };
    if (updateUserDto.password) {
      updateData.password_hash = await bcrypt.hash(updateUserDto.password, 10);
      delete updateData.password;
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        manager_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.prisma.user.delete({ where: { id } });

    return { message: "User deleted successfully" };
  }
}
