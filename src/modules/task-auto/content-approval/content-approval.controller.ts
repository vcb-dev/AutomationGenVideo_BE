import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtOrApiKeyGuard } from '../../api-keys/guards/jwt-or-api-key.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import {
  QueryContentApprovalDto,
  ReviewContentApprovalDto,
} from './dto/content-approval.dto'
import { ContentApprovalService } from './content-approval.service'

@ApiTags('task-auto')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
@Controller('task-auto')
export class ContentApprovalController {
  constructor(private readonly contentApproval: ContentApprovalService) {}

  @Get('content-approvals')
  @ApiOperation({ summary: "List content-approval requests — tab 'Content chờ duyệt'" })
  listContentApprovals(@Query() query: QueryContentApprovalDto) {
    return this.contentApproval.list(query)
  }

  @Get('tasks/:id/content-approval')
  @ApiOperation({ summary: 'Lấy yêu cầu duyệt content gần nhất của task' })
  getContentApproval(@Param('id') id: string) {
    return this.contentApproval.getCurrent(id)
  }

  @Post('tasks/:id/content-approval')
  @ApiOperation({ summary: 'Editor gửi yêu cầu duyệt content mới' })
  requestContentApproval(@Param('id') id: string, @Request() request: any) {
    return this.contentApproval.request(id, request.user.id)
  }

  @Post('content-approvals/:id/review')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'LEADER')
  @ApiOperation({ summary: 'Duyệt hoặc từ chối yêu cầu duyệt content' })
  reviewContentApproval(
    @Param('id') id: string,
    @Body() dto: ReviewContentApprovalDto,
    @Request() request: any,
  ) {
    return this.contentApproval.review(id, dto, request.user.id)
  }
}
