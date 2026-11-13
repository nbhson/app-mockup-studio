import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";
import { DemoUserService } from "./demo-user.service";

@Global()
@Module({
  providers: [DbService, DemoUserService],
  exports: [DbService, DemoUserService],
})
export class DbModule {}
