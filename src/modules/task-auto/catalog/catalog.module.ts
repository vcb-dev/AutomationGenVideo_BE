import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { TeamsModule } from "../teams/teams.module";
import { TaskAutoCatalogService } from "./catalog.service";
import { TaskAutoCatalogController } from "./catalog.controller";
import { TaskAutoEditorCatalogController } from "./editor-catalog.controller";
import { ScaleDataSourceGuard } from "../../../common/guards/scale-data-source.guard";

@Module({
  imports: [PrismaModule, TeamsModule],
  controllers: [TaskAutoCatalogController, TaskAutoEditorCatalogController],
  providers: [TaskAutoCatalogService, ScaleDataSourceGuard],
})
export class CatalogModule {}
