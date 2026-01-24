import { Exclude } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @Exclude()
  password_hash: string;

  @ApiProperty()
  full_name: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ required: false })
  manager_id?: string;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty({ required: false })
  last_login_at?: Date;

  @ApiProperty({ required: false })
  last_activity_at?: Date;

  @ApiProperty()
  total_login_count: number;

  @ApiProperty()
  total_action_count: number;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
