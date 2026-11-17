import { Global, Module } from "@nestjs/common";
import { PresenceGateway } from "./presence.gateway";
import { PresenceService } from "./presence.service";

// Global so document/page controllers can broadcast document changes without
// importing a collaboration feature module.
@Global()
@Module({
  providers: [PresenceService, PresenceGateway],
  exports: [PresenceService],
})
export class CollabModule {}
