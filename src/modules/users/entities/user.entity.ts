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

  @ApiProperty({ enum: UserRole, isArray: true })
  roles: UserRole[];

  @ApiProperty({ required: false, nullable: true })
  ma_pin: string | null;

  @ApiProperty({ required: false, nullable: true })
  team: string | null;

  @ApiProperty({ required: false, nullable: true })
  lark_permissions: any | null;

  manager_id: string | null;
  team_leader_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
