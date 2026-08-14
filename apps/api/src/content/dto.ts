import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class GenerateBatchDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(32) brandName!: string;
  @IsString() theme!: string;
  @IsIn(["cercano", "energico", "reflexivo"]) tone!: string;
  @Type(() => Number) @IsInt() @Min(2) @Max(3) count!: 2 | 3;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsDateString({}, { each: true })
  targetDates?: string[];
}

export class ScheduleDto {
  @IsDateString() scheduledFor!: string;
  @IsUUID() musicTrackId!: string;
}

export class ScheduleBatchDto {
  @IsDateString() startAt!: string;
  @Type(() => Number) @IsInt() @Min(30) @Max(10080) intervalMinutes!: number;
  @IsUUID() musicTrackId!: string;
}

export class ListQueryDto {
  @IsOptional()
  @IsIn([
    "generating",
    "pending_review",
    "approved",
    "scheduled",
    "publishing",
    "published",
    "rejected",
    "obsolete",
    "failed",
  ])
  status?: string;
}
