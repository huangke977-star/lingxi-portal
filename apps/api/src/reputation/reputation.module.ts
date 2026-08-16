import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { ReputationController } from "./reputation.controller";
import { ReputationService } from "./reputation.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [ReputationController],
  providers: [ReputationService],
  exports: [ReputationService],
})
export class ReputationModule {}
