import {
  Controller, Get, Post, Delete, Patch,
  Param, Body, Req, HttpCode, HttpStatus, UseGuards, HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ChatHistoryService } from './chat-history.service';
import { AiIntegrationService } from '../ai-integration/ai-integration.service';

@ApiTags('Chat History')
@Controller('chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChatHistoryController {
  constructor(
    private readonly chatService: ChatHistoryService,
    private readonly aiService: AiIntegrationService,
  ) {}

  /** Lấy danh sách conversation của user hiện tại */
  @Get('conversations')
  getConversations(@Req() req: any) {
    return this.chatService.getConversations(req.user.id);
  }

  /** Tạo conversation mới */
  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  createConversation(@Req() req: any, @Body() body: { title: string }) {
    const title = body.title?.trim() || 'Cuộc trò chuyện mới';
    return this.chatService.createConversation(req.user.id, title);
  }

  /** Xoá conversation */
  @Delete('conversations/:id')
  async deleteConversation(@Param('id') id: string, @Req() req: any) {
    const result = await this.chatService.deleteConversation(id, req.user.id);
    if (!result) throw new HttpException('Không tìm thấy', HttpStatus.NOT_FOUND);
    return result;
  }

  /** Đổi tên conversation */
  @Patch('conversations/:id/title')
  updateTitle(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { title: string },
  ) {
    return this.chatService.updateTitle(id, req.user.id, body.title);
  }

  /** Lấy messages của 1 conversation */
  @Get('conversations/:id/messages')
  async getMessages(@Param('id') id: string, @Req() req: any) {
    const msgs = await this.chatService.getMessages(id, req.user.id);
    if (!msgs) throw new HttpException('Không tìm thấy', HttpStatus.NOT_FOUND);
    return msgs;
  }

  /** Gửi tin nhắn — tự lưu user msg + AI response vào DB */
  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Param('id') conversationId: string,
    @Req() req: any,
    @Body() body: { message: string },
  ) {
    const message = body.message?.trim();
    if (!message) throw new HttpException('message is required', HttpStatus.BAD_REQUEST);

    // Lấy lịch sử để gửi cho AI
    const history = await this.chatService.getMessages(conversationId, req.user.id);
    if (history === null) throw new HttpException('Không tìm thấy conversation', HttpStatus.NOT_FOUND);

    const historyForAI = history.map((m) => ({ role: m.role, content: m.content }));

    // Lưu tin user trước
    await this.chatService.saveMessage(conversationId, 'user', message);

    // Gọi AI
    const aiResponse = await this.aiService.chat(message, historyForAI);

    // Lưu response AI
    const aiMsg = await this.chatService.saveMessage(
      conversationId,
      'assistant',
      aiResponse.message ?? '',
      aiResponse.dashboard ?? null,
    );

    return {
      message: aiResponse.message,
      dashboard: aiResponse.dashboard ?? null,
      suggestions: aiResponse.suggestions ?? [],
      id: aiMsg.id,
    };
  }
}
