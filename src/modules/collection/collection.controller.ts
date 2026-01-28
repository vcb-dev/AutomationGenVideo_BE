import { Controller, Get, Post, Body, Param, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CollectionService } from './collection.service';
import { CreateCollectionDto, AddVideosToCollectionDto } from './dto/collection.dto';

@ApiTags('Collections')
@Controller('collections')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get()
  @ApiOperation({ summary: 'List all collections' })
  findAll() {
    return this.collectionService.getCollections();
  }

  @Post()
  @ApiOperation({ summary: 'Create a new collection' })
  create(@Body() createDto: CreateCollectionDto) {
    return this.collectionService.createCollection(createDto);
  }

  @Post(':id/videos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add videos to collection' })
  addVideos(@Param('id') id: string, @Body() addDto: AddVideosToCollectionDto) {
    return this.collectionService.addVideos(id, addDto);
  }
}
