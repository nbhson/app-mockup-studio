import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DbModule } from "./db/db.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { PagesModule } from "./modules/pages/pages.module";
import { SharesModule } from "./modules/shares/shares.module";
import { CommentsModule } from "./modules/comments/comments.module";
import { VersionsModule } from "./modules/versions/versions.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AiModule } from "./modules/ai/ai.module";
import { HealthModule } from "./modules/health/health.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { RequestMetricsMiddleware } from "./common/request-metrics.middleware";
import { SecurityHeadersMiddleware } from "./common/security-headers.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    MetricsModule,
    ProjectsModule,
    DocumentsModule,
    PagesModule,
    SharesModule,
    CommentsModule,
    VersionsModule,
    AssetsModule,
    AiModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 requires a named wildcard; `*` triggers a deprecation warning.
    consumer.apply(SecurityHeadersMiddleware, RequestMetricsMiddleware).forRoutes("{*path}");
  }
}
