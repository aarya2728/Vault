import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type LogLevel = "info" | "warn" | "error";

export class Logger {
  private ready = false;

  constructor(private readonly file: string) {}

  private async ensureDir(): Promise<void> {
    if (this.ready) return;
    await mkdir(dirname(this.file), { recursive: true });
    this.ready = true;
  }

  async log(level: LogLevel, event: string, data: Record<string, unknown> = {}): Promise<void> {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data,
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else console.log(line);

    try {
      await this.ensureDir();
      await appendFile(this.file, `${line}\n`, "utf8");
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          event: "log_write_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  info(event: string, data?: Record<string, unknown>): Promise<void> {
    return this.log("info", event, data);
  }

  warn(event: string, data?: Record<string, unknown>): Promise<void> {
    return this.log("warn", event, data);
  }

  error(event: string, data?: Record<string, unknown>): Promise<void> {
    return this.log("error", event, data);
  }
}
