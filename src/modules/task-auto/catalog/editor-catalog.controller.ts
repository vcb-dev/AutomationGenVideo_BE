import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../../common/guards/roles.guard";
import { Roles } from "../../../common/decorators/roles.decorator";
import { TaskAutoCatalogService } from "./catalog.service";
import {
  CreateEditorProductDto,
  UpdateEditorProductDto,
  QueryEditorProductDto,
  CreateEditorContentDto,
  UpdateEditorContentDto,
  QueryEditorContentDto,
  CreateEditorSourceDto,
  UpdateEditorSourceDto,
  QueryEditorSourceDto,
} from "../dto/catalog.dto";

@ApiTags("task-auto")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-auto")
export class TaskAutoEditorCatalogController {
  constructor(private catalog: TaskAutoCatalogService) {}

  // ── Editor Products ───────────────────────────────────────────────────────

  @Get("editors/:userId/products")
  @ApiOperation({ summary: "List editor personal products" })
  listEditorProducts(
    @Param("userId") userId: string,
    @Query() q: QueryEditorProductDto,
  ) {
    return this.catalog.findAllEditorProducts(userId, q);
  }

  @Post("editors/:userId/products")
  @ApiOperation({ summary: "Add product to editor personal catalog (copy from global or create new)" })
  addEditorProduct(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorProductDto,
    @Request() req: any,
  ) {
    return this.catalog.createEditorProduct(userId, dto);
  }

  @Get("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Get editor product detail" })
  getEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
  ) {
    return this.catalog.findOneEditorProduct(epId);
  }

  @Patch("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Update editor product" })
  updateEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Body() dto: UpdateEditorProductDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorProduct(epId, dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("editors/:userId/products/:epId")
  @ApiOperation({ summary: "Delete editor product" })
  removeEditorProduct(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorProduct(epId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/products/:epId/push-to-team")
  @ApiOperation({ summary: "Push editor product to team catalog" })
  pushEditorProductToTeam(
    @Param("userId") userId: string,
    @Param("epId") epId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorProductToTeam(epId, teamId, req.user.id);
  }

  // ── Editor Contents ───────────────────────────────────────────────────────

  @Get("editors/:userId/contents")
  @ApiOperation({ summary: "List editor personal contents" })
  listEditorContents(
    @Param("userId") userId: string,
    @Query() q: QueryEditorContentDto,
  ) {
    return this.catalog.findAllEditorContents(userId, q);
  }

  @Post("editors/:userId/contents")
  @ApiOperation({ summary: "Add content to editor personal catalog (copy from global or create new)" })
  addEditorContent(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorContentDto,
    @Request() req: any,
  ) {
    return this.catalog.createEditorContent(userId, dto);
  }

  @Get("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Get editor content detail" })
  getEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
  ) {
    return this.catalog.findOneEditorContent(ecId);
  }

  @Patch("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Update editor content" })
  updateEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Body() dto: UpdateEditorContentDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorContent(ecId, dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("editors/:userId/contents/:ecId")
  @ApiOperation({ summary: "Delete editor content" })
  removeEditorContent(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorContent(ecId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/contents/:ecId/push-to-team")
  @ApiOperation({ summary: "Push editor content to team catalog" })
  pushEditorContentToTeam(
    @Param("userId") userId: string,
    @Param("ecId") ecId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorContentToTeam(ecId, teamId, req.user.id);
  }

  // ── Editor Sources ────────────────────────────────────────────────────────

  @Get("editors/:userId/sources")
  @ApiOperation({ summary: "List editor personal sources" })
  listEditorSources(
    @Param("userId") userId: string,
    @Query() q: QueryEditorSourceDto,
  ) {
    return this.catalog.findAllEditorSources(userId, q);
  }

  @Post("editors/:userId/sources")
  @ApiOperation({ summary: "Add source to editor personal catalog (copy from global or create new)" })
  addEditorSource(
    @Param("userId") userId: string,
    @Body() dto: CreateEditorSourceDto,
    @Request() req: any,
  ) {
    return this.catalog.createEditorSource(userId, dto);
  }

  @Get("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Get editor source detail" })
  getEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
  ) {
    return this.catalog.findOneEditorSource(esId);
  }

  @Patch("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Update editor source" })
  updateEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Body() dto: UpdateEditorSourceDto,
    @Request() req: any,
  ) {
    return this.catalog.updateEditorSource(esId, dto, req.user.id, req.user.roles ?? []);
  }

  @Delete("editors/:userId/sources/:esId")
  @ApiOperation({ summary: "Delete editor source" })
  removeEditorSource(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Request() req: any,
  ) {
    return this.catalog.removeEditorSource(esId, req.user.id, req.user.roles ?? []);
  }

  @Patch("editors/:userId/sources/:esId/push-to-team")
  @ApiOperation({ summary: "Push editor source to team catalog" })
  pushEditorSourceToTeam(
    @Param("userId") userId: string,
    @Param("esId") esId: string,
    @Body("team_id") teamId: string,
    @Request() req: any,
  ) {
    return this.catalog.pushEditorSourceToTeam(esId, teamId, req.user.id);
  }
}
