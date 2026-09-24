import { Module } from '@nestjs/common';

import { InfobipWhatsAppClient } from './infobip-whatsapp.client';
import { WhatsAppService } from './whatsapp.service';

/**
 * Outbound messaging to patients. Today: WhatsApp through Infobip (`INFOBIP_*`). Without
 * credentials the service reports `isConfigured = false` and the channel stays simulated, as it
 * was before 21/09/2026.
 */
@Module({
  providers: [InfobipWhatsAppClient, WhatsAppService],
  exports: [WhatsAppService],
})
export class MessagingModule {}
