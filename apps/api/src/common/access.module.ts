import { Global, Module } from "@nestjs/common";
import { AccessService } from "./access.service";

// Global so any project-scoped controller can inject AccessService.
@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
