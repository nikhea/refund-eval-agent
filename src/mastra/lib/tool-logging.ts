import type { ToolExecutionContext } from "@mastra/core/tools";

type ToolLogContext = Pick<ToolExecutionContext, "mastra" | "observe">;
type LogData = Record<string, unknown>;
type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Stage-aware logger for tool `execute` functions.
 *
 * Every line is emitted through `mastra.getLogger()`, so it lands in the
 * console transport and in observability storage at the same time. When a
 * trace is active, Mastra adds `trace_id` / `span_id`, which lets you jump
 * from a log line to the matching tool span in Studio. If no Mastra logger is
 * available (for example a tool invoked directly in a unit test) the logger
 * falls back to `context.observe.log`.
 *
 * Wrap each unit of work in `stage()` instead of calling `span()` yourself:
 * it emits a "stage started", "stage completed" (with `durationMs`) and
 * "stage failed" line, and runs the work inside a named child span so the
 * trace shows a timeline of what happened inside the tool.
 */
export function createToolLogger(toolId: string, context?: ToolLogContext) {
  const logger = context?.mastra?.getLogger();
  const observe = context?.observe;
  const startedAt = Date.now();
  let stageIndex = 0;

  const emit = (
    level: LogLevel,
    stage: string,
    message: string,
    data: LogData = {},
  ) => {
    const record = { tool: toolId, stage, ...data };

    if (logger) {
      logger[level](`[${toolId}] ${message}`, record);
      return;
    }

    observe?.log(level, `[${toolId}] ${message}`, record);
  };

  /**
   * Runs one named stage of the tool:
   * - logs `stage started` (debug)
   * - records a child span with the stage attributes
   * - logs `stage completed` with `durationMs` (debug) or `stage failed`
   *   with the error (error)
   *
   * Failures are re-thrown so the tool's own `catch` can decide what to do.
   */
  const stage = async <T>(
    name: string,
    fn: () => Promise<T> | T,
    attributes: LogData = {},
  ): Promise<T> => {
    const index = ++stageIndex;
    const stageStartedAt = Date.now();
    const meta = { stageIndex: index, ...attributes };

    emit("debug", name, "stage started", meta);

    try {
      const result = observe
        ? await observe.span(name, fn, { tool: toolId, stage: name, ...meta })
        : await fn();

      emit("debug", name, "stage completed", {
        ...meta,
        durationMs: Date.now() - stageStartedAt,
      });
      return result;
    } catch (error) {
      emit("error", name, "stage failed", {
        ...meta,
        durationMs: Date.now() - stageStartedAt,
        error,
      });
      throw error;
    }
  };

  return {
    /** Tool entry point. */
    start(data: LogData = {}) {
      emit("info", "start", "invoked", data);
    },
    /** Intermediate detail (lookups, evaluations, calculations). */
    debug(stage: string, message: string, data?: LogData) {
      emit("debug", stage, message, data);
    },
    /** A meaningful milestone with input/output detail. */
    info(stage: string, message: string, data?: LogData) {
      emit("info", stage, message, data);
    },
    /** An expected refusal: not found, ineligible, unconfirmed, etc. */
    warn(stage: string, message: string, data?: LogData) {
      emit("warn", stage, message, {
        durationMs: Date.now() - startedAt,
        ...data,
      });
    },
    /** Successful completion, with total duration and stage count. */
    done(stage: string, message: string, data: LogData = {}) {
      emit("info", stage, message, {
        durationMs: Date.now() - startedAt,
        stages: stageIndex,
        ...data,
      });
    },
    /** Unexpected failure. Logs the error and how far the tool got. */
    error(stage: string, error: unknown, data: LogData = {}) {
      const err = error instanceof Error ? error : new Error(String(error));
      emit("error", stage, `failed: ${err.message}`, {
        durationMs: Date.now() - startedAt,
        stages: stageIndex,
        error: err,
        ...data,
      });
    },
    /** Runs a named stage with automatic start/completed/failed logging. */
    stage,
    /**
     * Backwards-compatible alias for `stage()`. Prefer `stage()` in new code;
     * it adds the same child span plus the start/completed/failed log lines.
     */
    span: stage,
  };
}

export type ToolLogger = ReturnType<typeof createToolLogger>;
