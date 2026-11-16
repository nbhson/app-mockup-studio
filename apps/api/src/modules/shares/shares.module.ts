import { Module } from "@nestjs/common";
import { PublicShareController } from "./public-share.controller";
import { SharesController } from "./shares.controller";

@Module({ controllers: [SharesController, PublicShareController] })
export class SharesModule {}
