import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DbModule } from "./db/db.module";
import { AccessModule } from "./common/access.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { PagesModule } from "./modules/pages/pages.module";
import { SharesModule } from "./modules/shares/shares.module";
import { CommentsModule } from "./modules/comments/comments.module";
import { DesignSystemsModule } from "./modules/design-systems/design-systems.module";
import { ComponentLibrariesModule } from "./modules/component-libraries/component-libraries.module";
import { VersionsModule } from "./modules/versions/versions.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AiModule } from "./modules/ai/ai.module";
import { HealthModule } from "./modules/health/health.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { MembersModule } from "./modules/members/members.module";
import { RequestMetricsMiddleware } from "./common/request-metrics.middleware";
import { SecurityHeadersMiddleware } from "./common/security-headers.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AccessModule,
    MetricsModule,
    ProjectsModule,
    DocumentsModule,
    PagesModule,
    SharesModule,
    CommentsModule,
    DesignSystemsModule,
    ComponentLibrariesModule,
    VersionsModule,
    AssetsModule,
    AiModule,
    HealthModule,
    MembersModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 requires a named wildcard; `*` triggers a deprecation warning.
    consumer.apply(SecurityHeadersMiddleware, RequestMetricsMiddleware).forRoutes("{*path}");
  }
}
