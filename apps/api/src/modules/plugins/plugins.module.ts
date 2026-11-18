import { Module } from "@nestjs/common";
import { PluginsController } from "./plugins.controller";
import { DocumentsModule } from "../documents/documents.module";

@Module({
  imports: [DocumentsModule],
  controllers: [PluginsController],
})
export class PluginsModule {}
