import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, catchError } from 'rxjs';
import { AxiosError } from 'axios';
import { XhsSearchDto, XhsSearchResponse } from './dto/search-xhs.dto';

@Injectable()
export class XiaohongshuService {
  private readonly logger = new Logger(XiaohongshuService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL') || 'http://localhost:8001';
  }

  async searchNotes(searchDto: XhsSearchDto): Promise<XhsSearchResponse> {
    const url = `${this.aiServiceUrl}/api/xiaohongshu/search/`;
    
    this.logger.log(`Searching Xiaohongshu: ${searchDto.searchTerm}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<XhsSearchResponse>(url, searchDto, {
          timeout: 300000, // 5 minutes timeout for scraping
        }).pipe(
          catchError((error: AxiosError) => {
            this.logger.error(`AI Service Error: ${error.message}`, error.response?.data);
            throw new HttpException(
              error.response?.data || 'Failed to connect to AI Service',
              error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
          }),
        ),
      );

      return data;
    } catch (error) {
      this.logger.error('Search failed', error);
      throw error;
    }
  }
}
