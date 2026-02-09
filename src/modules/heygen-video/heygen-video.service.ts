import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { GenerateVideoDto } from './dto/generate-video.dto';

@Injectable()
export class HeygenVideoService {
  private readonly aiServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL') || 'http://localhost:8000';
  }

  async generateVideo(generateVideoDto: GenerateVideoDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/heygen/generate-video`,
          generateVideoDto,
        ),
      );

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      throw new HttpException(
        error.response?.data?.error || 'Failed to generate video',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getVideoStatus(videoId: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.aiServiceUrl}/api/heygen/status/${videoId}`,
        ),
      );

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      throw new HttpException(
        error.response?.data?.error || 'Failed to get video status',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getVoices() {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.aiServiceUrl}/api/heygen/voices`),
      );

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      throw new HttpException(
        error.response?.data?.error || 'Failed to get voices',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async generateAndWait(generateVideoDto: GenerateVideoDto) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/heygen/generate-and-wait`,
          generateVideoDto,
          {
            timeout: 600000, // 10 minutes timeout
          },
        ),
      );

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      throw new HttpException(
        error.response?.data?.error || 'Failed to generate video',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  async generateScript(topic: string, tone: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/heygen/generate-script`,
          { topic, tone },
        ),
      );

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      throw new HttpException(
        error.response?.data?.error || 'Failed to generate script',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async cloneVoice(videoUrl: string, voiceName: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.aiServiceUrl}/api/heygen/clone-voice`,
          { video_url: videoUrl, voice_name: voiceName },
        ),
      );
      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      throw new HttpException(
        error.response?.data?.error || 'Failed to clone voice',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
