import { PartialType } from "@nestjs/swagger";
import { CreateChannelDto } from "./create-channel.dto";

// Tất cả field đều optional khi update, không cho sửa team_traffic
export class UpdateChannelDto extends PartialType(CreateChannelDto) {}