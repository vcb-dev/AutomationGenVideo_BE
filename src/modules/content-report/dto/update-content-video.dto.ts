import { PartialType } from '@nestjs/swagger';
import { CreateContentVideoDto } from './create-content-video.dto';

export class UpdateContentVideoDto extends PartialType(CreateContentVideoDto) {}
