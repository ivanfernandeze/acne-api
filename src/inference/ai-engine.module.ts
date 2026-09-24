import { Module } from '@nestjs/common';

import { AiEngineClient } from './ai-engine.client';

/**
 * The engine client on its own, so modules can talk to `acne-ai-engine` without pulling in the
 * inference queue.
 *
 * `ImagesModule` needs it for admission screening, and `InferenceModule` already imports
 * `ImagesModule` — importing `InferenceModule` back would be a cycle. The client depends on nothing
 * but the global `APP_CONFIG`, so it costs nothing to isolate.
 */
@Module({
  providers: [AiEngineClient],
  exports: [AiEngineClient],
})
export class AiEngineModule {}
