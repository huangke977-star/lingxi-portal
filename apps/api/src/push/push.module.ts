import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { PushController } from "./push.controller";
import { PushService } from "./push.service";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [JwtModule.register({}), UsersModule, IntegrationsModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
