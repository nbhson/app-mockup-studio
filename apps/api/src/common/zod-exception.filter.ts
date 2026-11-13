import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import { ZodError } from "zod";

/**
 * Maps Zod validation failures to HTTP 400 responses.
 *
 * Controllers validate request bodies with the shared `validators` package
 * instead of Nest's class-validator pipe. Without this filter a ZodError would
 * surface as an opaque 500 "Internal server error"; here we return the concrete
 * issues so the web client (and API consumers) can show an actionable message.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    const message = issues
      .slice(0, 5)
      .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
      .join("; ");

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: "Bad Request",
      message: message || "Dữ liệu không hợp lệ",
      issues,
    });
  }
}
