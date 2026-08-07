import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { SearchController } from "./search.controller";
import { SearchIndexService } from "./search-index.service";
import { SearchService } from "./search.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [SearchController],
  providers: [SearchService, SearchIndexService],
})
export class SearchModule {}
