import type { Processor, ProcessInputStepArgs } from "@mastra/core/processors";

export class DateInjectorProcessor implements Processor {
  readonly id = "date-injector";

  async processInputStep({ sendSignal }: ProcessInputStepArgs) {
    const today = new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    await sendSignal?.({
      type: "reactive",
      contents: `Today is ${today}.`,
      transient: true,
    });
  }
}
