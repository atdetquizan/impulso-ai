import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

@Injectable()
export class MediaComposerService {
  private readonly ffmpeg: string;
  private readonly fontPath?: string;

  constructor(config: ConfigService) {
    this.ffmpeg = config.get<string>("FFMPEG_PATH") ?? "ffmpeg";
    this.fontPath = config.get<string>("FFMPEG_FONT_PATH") || undefined;
  }

  async composeImage(background: Buffer, quote: string, brandName = "IMPULSO IA") {
    const dir = await mkdtemp(join(tmpdir(), "impulso-"));
    try {
      const backgroundPath = join(dir, "background.png");
      const quotePath = join(dir, "quote.txt");
      const brandPath = join(dir, "brand.txt");
      const outputPath = join(dir, "composed.png");
      await Promise.all([
        writeFile(backgroundPath, background),
        writeFile(quotePath, this.wrapQuote(quote), "utf8"),
        writeFile(brandPath, this.normalizeBrandName(brandName), "utf8"),
      ]);
      const filter = [
        "scale=1080:1920:force_original_aspect_ratio=increase",
        "crop=1080:1920",
        "eq=brightness=-0.04:saturation=1.12:contrast=1.04",
        "vignette=PI/5",
        ...this.editorialOverlay(quotePath, brandPath, quote),
      ].join(",");
      await execFileAsync(
        this.ffmpeg,
        [
          "-y",
          "-i",
          backgroundPath,
          "-vf",
          filter,
          "-frames:v",
          "1",
          outputPath,
        ],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      return await readFile(outputPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async compose(image: Buffer, audio: Buffer, quote?: string, brandName = "IMPULSO IA") {
    const dir = await mkdtemp(join(tmpdir(), "impulso-"));
    try {
      const imagePath = join(dir, "image.png");
      const audioPath = join(dir, "audio.mp3");
      const outputPath = join(dir, "output.mp4");
      await Promise.all([
        writeFile(imagePath, image),
        writeFile(audioPath, audio),
      ]);
      let filter =
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0005,1.08)':d=300:s=1080x1920";
      if (quote) {
        const quotePath = join(dir, "quote.txt");
        const brandPath = join(dir, "brand.txt");
        await Promise.all([
          writeFile(quotePath, this.wrapQuote(quote), "utf8"),
          writeFile(brandPath, this.normalizeBrandName(brandName), "utf8"),
        ]);
        filter += `,${this.editorialOverlay(quotePath, brandPath, quote).join(",")}`;
      }
      await execFileAsync(
        this.ffmpeg,
        [
          "-y",
          "-loop",
          "1",
          "-i",
          imagePath,
          "-i",
          audioPath,
          "-vf",
          filter,
          "-t",
          "10",
          "-r",
          "30",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-movflags",
          "+faststart",
          outputPath,
        ],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      return await readFile(outputPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private editorialOverlay(textPath: string, brandPath: string, quote: string) {
    const font = this.fontPath ? `:fontfile='${this.escapeFilterPath(this.fontPath)}'` : "";
    return [
      "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.10:t=fill",
      "drawbox=x=78:y=535:w=924:h=760:color=black@0.34:t=fill",
      "drawbox=x=78:y=535:w=924:h=760:color=0xE7B85C@0.72:t=3",
      "drawbox=x=128:y=620:w=74:h=7:color=0xF2C66D@0.95:t=fill",
      `drawtext=textfile='${this.escapeFilterPath(brandPath)}'${font}:reload=0:fontcolor=0xF6D58B:fontsize=30:x=128:y=565:shadowcolor=black@0.5:shadowx=2:shadowy=2`,
      this.drawTextFilter(textPath, quote),
      `drawtext=text='TU  MOMENTO  ES  AHORA'${font}:fontcolor=white@0.78:fontsize=24:x=(w-text_w)/2:y=1240`,
    ];
  }

  private drawTextFilter(textPath: string, quote: string) {
    const font = this.fontPath
      ? `:fontfile='${this.escapeFilterPath(this.fontPath)}'`
      : "";
    const size = quote.length > 150 ? 52 : quote.length > 100 ? 58 : 66;
    return `drawtext=textfile='${this.escapeFilterPath(textPath)}'${font}:reload=0:fontcolor=white:fontsize=${size}:line_spacing=25:x=128:y=(h-text_h)/2:shadowcolor=black@0.75:shadowx=3:shadowy=3`;
  }

  private escapeFilterPath(path: string) {
    return path
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
  }

  private wrapQuote(quote: string) {
    const words = quote.trim().split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > 25 && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 8).join("\n");
  }

  private normalizeBrandName(brandName: string) {
    return brandName.trim().replace(/[\r\n\t]+/g, " ").slice(0, 32).toUpperCase();
  }
}
