// The rules for which model each bot gets in the match setup (app/match-setup.tsx), given the API keys that work.
import { PROVIDERS, type Agent, type ModelOption, type Provider } from "./config.ts";

/** The models of each provider whose key works, in the order the keys were added. */
export type Catalog = Map<Provider, ModelOption[]>;

/** A bot as chosen. `nameEdited`: the user typed its name, so the name no longer follows the model. */
export type BotChoice = Agent & { nameEdited: boolean };

/** A provider's default model for a bot: the first of our usual picks the key offers, else the newest it lists. */
export function defaultModel(provider: Provider, models: ModelOption[]): string {
  const usual = PROVIDERS[provider].models.find((id) => models.some((model) => model.id === id));
  return usual ?? models[0]?.id ?? "";
}

/**
 * A seat name for a model: its display name without the maker ("Google: Gemini 3.8 Flash" -> "Gemini 3.8 Flash",
 * "Claude Opus 5.5" -> "Opus 5.5"), or for a typed OpenRouter id, the part after the slash.
 */
export function seatNameFor(modelId: string, option: ModelOption | undefined): string {
  if (!option) {
    return (modelId.split("/").at(-1) ?? modelId).slice(0, 18);
  }
  return option.name
    .replace(/^[^:]+:\s*/, "")
    .replace(/^Claude\s+/, "")
    .slice(0, 18);
}

/** Several bots with the same name would be hard to tell apart at the table: number the repeats. */
export function numberRepeats(names: string[]): string[] {
  const timesSeen = new Map<string, number>();
  return names.map((name) => {
    const count = (timesSeen.get(name) ?? 0) + 1;
    timesSeen.set(name, count);
    return count === 1 ? name : `${name.slice(0, 20)} ${count}`;
  });
}

/**
 * The bot as it stands with the keys that work: on a provider whose key works, and (except on OpenRouter, where
 * any model id can be typed) on a model that key lists. Before any key works, the bot is left as it is.
 */
export function fitToKeys<Bot extends BotChoice>(bot: Bot, catalog: Catalog): Bot {
  const providers = [...catalog.keys()];
  if (providers.length === 0) {
    return bot;
  }
  const provider = catalog.has(bot.provider) ? bot.provider : providers[0];
  const models = catalog.get(provider) ?? [];
  // an OpenRouter model is typed text, kept as typed (even while it's being cleared to type another)
  const freeText = provider === "openrouter";
  const listedModel = models.some((model) => model.id === bot.model);
  const keepModel = provider === bot.provider && (freeText || listedModel);
  const model = keepModel ? bot.model : defaultModel(provider, models);
  const option = models.find((candidate) => candidate.id === model);
  return {
    ...bot,
    provider,
    model,
    name: bot.nameEdited ? bot.name : seatNameFor(model, option),
    effort: option?.effort === false ? "default" : bot.effort,
  };
}
