import { Controller, Post, Get, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { HeygenVideoService } from './heygen-video.service';
import { GenerateVideoDto } from './dto/generate-video.dto';

@Controller('heygen-video')
export class HeygenVideoController {
  constructor(private readonly heygenVideoService: HeygenVideoService) { }

  @Post('generate')
  async generateVideo(@Body() generateVideoDto: GenerateVideoDto) {
    try {
      return await this.heygenVideoService.generateVideo(generateVideoDto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to generate video',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('status/:videoId')
  async getVideoStatus(@Param('videoId') videoId: string) {
    try {
      return await this.heygenVideoService.getVideoStatus(videoId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get video status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('voices')
  async getVoices() {
    try {
      return await this.heygenVideoService.getVoices();
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get voices',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('generate-and-wait')
  async generateAndWait(@Body() generateVideoDto: GenerateVideoDto) {
    try {
      return await this.heygenVideoService.generateAndWait(generateVideoDto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to generate video',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  @Post('generate-script')
  async generateScript(@Body() body: { topic: string; tone: string }) {
    try {
      return await this.heygenVideoService.generateScript(body.topic, body.tone);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to generate script',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('clone-voice')
  async cloneVoice(@Body() body: { video_url: string; voice_name: string }) {
    try {
      return await this.heygenVideoService.cloneVoice(body.video_url, body.voice_name);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to clone voice',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
