import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CreateCollectionDto, AddVideosToCollectionDto } from './dto/collection.dto';
import { resolveAiServiceUrl } from '../../common/config/ai-service-url';

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.aiServiceUrl = resolveAiServiceUrl(this.configService);
  }

  async getCollections() {
    const url = `${this.aiServiceUrl}/api/collections/`;
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`Error getting collections: ${error.message}`);
            throw new HttpException(
              error.response?.data || 'Failed to fetch collections',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      return data;
    } catch (error) {
      throw error;
    }
  }

  async createCollection(createDto: CreateCollectionDto) {
    const url = `${this.aiServiceUrl}/api/collections/`;
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, createDto).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`Error creating collection: ${error.message}`);
            throw new HttpException(
              error.response?.data || 'Failed to create collection',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      return data;
    } catch (error) {
      throw error;
    }
  }

  async addVideos(id: string, addDto: AddVideosToCollectionDto) {
    // Python endpoint will be created: /api/collections/{id}/add_videos/
    // Python expects: { video_ids: [...] }
    const url = `${this.aiServiceUrl}/api/collections/${id}/add_videos/`;
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(url, addDto).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`Error adding videos: ${error.message}`);
            throw new HttpException(
              error.response?.data || 'Failed to add videos',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );
      return data;
    } catch (error) {
      throw error;
    }
  }
  
  async deleteCollection(id: string) {
    const url = `${this.aiServiceUrl}/api/collections/${id}/`;
    try {
        const { data } = await firstValueFrom(
            this.httpService.delete(url).pipe(
                catchError((error: AxiosError) => {
                     throw new HttpException(error.response?.data || 'Failed', error.response?.status || 500);
                })
            )
        );
        return data;
    } catch (error) { throw error; }
  }
}
