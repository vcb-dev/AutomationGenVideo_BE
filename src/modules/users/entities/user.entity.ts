import { User } from "@prisma/client";
import { ApiProperty } from "@nestjs/swagger";
import { Exclude } from "class-transformer";
import { UserRole } from "@prisma/client";

export class UserEntity implements User {
  id: string;

  @ApiProperty()
  email: string;

  @Exclude()
  password_hash: string | null;

  @ApiProperty()
  full_name: string;

  @ApiProperty({ required: false, nullable: true })
  avatar: string | null;

  @Exclude()
  google_id: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  manager_id: string | null;
  is_active: boolean;
  last_login_at: Date | null;
  last_activity_at: Date | null;
  total_login_count: number;
  total_action_count: number;
  created_at: Date;
  updated_at: Date;
}
