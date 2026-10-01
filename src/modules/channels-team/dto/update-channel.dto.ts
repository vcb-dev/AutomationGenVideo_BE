import { OmitType, PartialType } from "@nestjs/swagger";
import { CreateChannelDto } from "./create-channel.dto";

// Tất cả field đều optional khi update; không cho đổi team (team_id) qua API
export class UpdateChannelDto extends PartialType(
  OmitType(CreateChannelDto, ["team_id"] as const),
) {}
