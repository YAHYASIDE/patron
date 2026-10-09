// Must be first: instrumentation patches modules at require time.
import './tracing';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * Worker entrypoint.
 *
 * Runs the same module graph without an HTTP listener, so BullMQ processors and
 * the outbox relay execute in their own process. A provider call that blocks
 * for 20 seconds then cannot affect API latency, and workers scale and restart
 * independently of the API.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();
  Logger.log('Patron worker started', 'Worker');
}
void bootstrap();
