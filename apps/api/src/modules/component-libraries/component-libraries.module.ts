import { Module } from "@nestjs/common";
import { ComponentLibrariesController } from "./component-libraries.controller";

@Module({
  controllers: [ComponentLibrariesController],
})
export class ComponentLibrariesModule {}
