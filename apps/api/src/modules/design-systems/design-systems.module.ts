import { Module } from "@nestjs/common";
import { DesignSystemsController } from "./design-systems.controller";
import { ProjectDesignSystemController } from "./project-design-system.controller";

@Module({
  controllers: [DesignSystemsController, ProjectDesignSystemController],
})
export class DesignSystemsModule {}
