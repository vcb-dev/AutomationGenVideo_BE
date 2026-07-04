import { UserRole } from "@prisma/client";
import { ApiProperty } from "@nestjs/swagger";
import { Exclude } from "class-transformer";

/** Dữ liệu user trả API (khớp bảng users / Prisma, không kèm quan hệ) */
export class UserEntity {
  id: string;

  @ApiProperty()
  email: string;

  @Exclude()
  password_hash: string | null;

  @ApiProperty()
  full_name: string;

  @ApiProperty({ required: false, nullable: true })
  image_url: string | null;

  @Exclude()
  google_id: string | null;

  @ApiProperty({ enum: UserRole, isArray: true })
  roles: UserRole[];

  @ApiProperty({ required: false, nullable: true })
  team: string | null;

  manager_id: string | null;
  team_leader_id: string | null;
  is_active: boolean;

  @ApiProperty({ required: false, nullable: true })
  lark_employee_record_id: string | null;

  @ApiProperty({ required: false, nullable: true })
  employee_id: string | null;

  @ApiProperty({ required: false, nullable: true })
  employee_data: any | null;

  @ApiProperty({ required: false, nullable: true })
  employee_position: string | null;

  @ApiProperty({ required: false, nullable: true })
  employee_status: string | null;

  @ApiProperty({ required: false, nullable: true })
  employee_date: Date | null;

  created_at: Date;
  updated_at: Date;
}
