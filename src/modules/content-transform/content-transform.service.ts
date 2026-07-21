import { Injectable, NotFoundException, ForbiddenException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateTransformDto, HistoryQueryDto } from './dto';
import { UserRole, TransformStatus } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ContentTransformService {
  private readonly logger = new Logger(ContentTransformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get active characters list (excluding system prompt)
   */
  async getCharacters() {
    return this.prisma.character.findMany({
      where: { is_active: true },
      orderBy: { order_index: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        avatar_url: true,
        is_active: true,
        order_index: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  /**
   * Run content transform with AI or mock logic and save to history
   */
  async transformContent(userId: string, dto: CreateTransformDto) {
    const character = await this.prisma.character.findFirst({
      where: {
        OR: [
          { id: dto.character_id },
          { slug: dto.character_id },
        ],
      },
    });

    if (!character) {
      throw new NotFoundException('Không tìm thấy nhân vật phù hợp');
    }

    // Create pending history record
    const history = await this.prisma.contentTransformHistory.create({
      data: {
        user_id: userId,
        character_id: character.id,
        input_text: dto.input_text,
        input_type: dto.input_type || 'TEXT',
        status: TransformStatus.PENDING,
      },
    });

    const startTime = Date.now();
    try {
      const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
      const url = `${aiServiceUrl}/api/ai/transform-content/`;
      
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {
            system_prompt: character.system_prompt,
            input_text: dto.input_text,
          },
          {
            timeout: 30000, // 30s timeout
          },
        ),
      );

      const outputText = response.data.output_text;
      const durationMs = Date.now() - startTime;

      const updatedHistory = await this.prisma.contentTransformHistory.update({
        where: { id: history.id },
        data: {
          output_text: outputText,
          status: TransformStatus.SUCCESS,
          model_used: 'deepseek-chat',
          duration_ms: durationMs,
        },
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      });

      return updatedHistory;
    } catch (error: any) {
      this.logger.error(`Failed to transform content: ${error.message}`);
      let errMsg = error.message || 'Lỗi không xác định trong quá trình xử lý';
      if (error.response?.data?.error) {
        errMsg = error.response.data.error;
      }
      
      const failedHistory = await this.prisma.contentTransformHistory.update({
        where: { id: history.id },
        data: {
          status: TransformStatus.FAILED,
          error_message: errMsg,
          duration_ms: Date.now() - startTime,
        },
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      });

      return failedHistory;
    }
  }

  /**
   * Get transformation history of currently logged-in user
   */
  async getUserHistory(userId: string, query: HistoryQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { user_id: userId };

    if (query.character_id) {
      where.character = {
        OR: [
          { id: query.character_id },
          { slug: query.character_id },
        ],
      };
    }

    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.prisma.contentTransformHistory.count({ where }),
      this.prisma.contentTransformHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  /**
   * Get transformation history of a specific member (Admin or Leader only)
   */
  async getMemberHistory(
    leaderId: string,
    memberId: string,
    query: HistoryQueryDto,
    roles: UserRole[],
  ) {
    const isAdmin = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.MANAGER);

    if (!isAdmin) {
      const isLeader = roles.includes(UserRole.LEADER);
      if (!isLeader) {
        throw new ForbiddenException('Chỉ có Leader, Manager hoặc Admin mới có quyền xem lịch sử thành viên');
      }

      // Check if target user is in at least one team led by this leader
      const ledTeams = await this.prisma.team.findMany({
        where: { leader_id: leaderId },
        select: { name: true },
      });

      const ledTeamNames = ledTeams.map((t) => t.name.trim().toLowerCase());
      if (ledTeamNames.length === 0) {
        throw new ForbiddenException('Bạn hiện không làm leader của team nào');
      }

      const member = await this.prisma.user.findUnique({
        where: { id: memberId },
        select: { team: true },
      });

      if (!member) {
        throw new NotFoundException('Không tìm thấy thành viên này');
      }

      const memberTeams = member.team
        ? member.team.split(',').map((t) => t.trim().toLowerCase())
        : [];

      const isMemberInTeam = memberTeams.some((tName) => ledTeamNames.includes(tName));

      if (!isMemberInTeam) {
        throw new ForbiddenException('Thành viên này không thuộc bất kỳ team nào do bạn quản lý');
      }
    }

    // Reuse query building logic
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { user_id: memberId };

    if (query.character_id) {
      where.character = {
        OR: [
          { id: query.character_id },
          { slug: query.character_id },
        ],
      };
    }

    if (query.status) {
      where.status = query.status as any;
    }

    const [total, items] = await Promise.all([
      this.prisma.contentTransformHistory.count({ where }),
      this.prisma.contentTransformHistory.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          character: {
            select: {
              id: true,
              name: true,
              slug: true,
              avatar_url: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  /**
   * Get full details of a single transformation history entry
   */
  async getHistoryDetail(id: string, userId: string, roles: UserRole[]) {
    const history = await this.prisma.contentTransformHistory.findUnique({
      where: { id },
      include: {
        character: {
          select: {
            id: true,
            name: true,
            slug: true,
            avatar_url: true,
          },
        },
      },
    });

    if (!history) {
      throw new NotFoundException('Không tìm thấy bản ghi lịch sử');
    }

    const isAdmin = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.MANAGER);
    if (!isAdmin && history.user_id !== userId) {
      const isLeader = roles.includes(UserRole.LEADER);
      if (!isLeader) {
        throw new ForbiddenException('Bạn không có quyền xem chi tiết bản ghi này');
      }

      // Check if target user belongs to leader's team
      const ledTeams = await this.prisma.team.findMany({
        where: { leader_id: userId },
        select: { name: true },
      });

      const ledTeamNames = ledTeams.map((t) => t.name.trim().toLowerCase());
      if (ledTeamNames.length === 0) {
        throw new ForbiddenException('Bạn hiện không làm leader của team nào');
      }

      const targetUser = await this.prisma.user.findUnique({
        where: { id: history.user_id },
        select: { team: true },
      });

      if (!targetUser) {
        throw new NotFoundException('Không tìm thấy người sở hữu bản ghi');
      }

      const targetTeams = targetUser.team
        ? targetUser.team.split(',').map((t) => t.trim().toLowerCase())
        : [];

      const isMemberInTeam = targetTeams.some((tName) => ledTeamNames.includes(tName));

      if (!isMemberInTeam) {
        throw new ForbiddenException('Bạn không có quyền xem chi tiết bản ghi này (thành viên không thuộc team của bạn)');
      }
    }

    return history;
  }

  async transcribeUpload(file: Express.Multer.File, authorization?: string): Promise<any> {
    const FormData = require('form-data');
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    const url = `${aiServiceUrl}/api/content/transcribe-upload/`;

    const formData = new FormData();
    formData.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, formData, {
          // AI endpoint yêu cầu IsAuthenticated — forward nguyên Bearer JWT của FE,
          // AI validate bằng chung JWT_SECRET (core.authentication.NestJWTAuthentication).
          headers: { ...formData.getHeaders(), ...(authorization ? { Authorization: authorization } : {}) },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 60000, // 60s timeout
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to transcribe file: ${error.message}`);
      const errMsg = error.response?.data?.error_message || error.response?.data?.error || error.message || 'Lỗi kết nối tới AI Service';
      throw new HttpException(errMsg, error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
