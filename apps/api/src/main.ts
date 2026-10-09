// Must be first: instrumentation patches modules at require time.
import './tracing';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
    // rawBody is required to verify webhook signatures against the exact bytes
  // the gateway signed — re-serialising a parsed body invalidates them.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);
  app.useLogger(app.get(Logger));

  app.use(helmet());
  app.enableCors({ origin: config.get<string>('app.corsOrigins')?.split(',') ?? true, credentials: true });
  app.setGlobalPrefix(config.get<string>('app.apiPrefix') ?? 'api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // strip unknown properties
      forbidNonWhitelisted: true, // and reject requests that send them
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      // Reject payloads outright rather than silently dropping fields: a
      // client sending `roleIds` to /users/me should learn it did not work.
      forbidUnknownValues: true,
    }),
  );
  // Registration order is significant: Nest applies the *last* matching
  // filter, so the catch-all goes first and the specific one wins.
  app.useGlobalFilters(new AllExceptionsFilter());

  if (config.get('app.env') !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('Patron API')
      .setDescription('Digital products marketplace')
      .setVersion('1.0')
      .addBearerAuth()
      .addGlobalParameters({
        name: 'X-Correlation-Id',
        in: 'header',
        required: false,
        description: 'Propagated through logs and traces; echoed in the response.',
      })
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }

  /**
   * Graceful shutdown. Without this, a rolling deploy severs in-flight
   * checkouts: the process exits while a payment is mid-capture, and the
   * customer is charged with no order to show for it.
   */
  app.enableShutdownHooks();

  await app.listen(config.get<number>('app.port') ?? 3000);
}
void bootstrap();
