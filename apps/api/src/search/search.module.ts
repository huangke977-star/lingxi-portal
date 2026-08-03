import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { UsersModule } from "../users/users.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [SearchController],
  providers: [PrismaService, SearchService],
})
export class SearchModule {}
