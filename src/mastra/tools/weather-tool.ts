import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createToolLogger, type ToolLogger } from "../lib/tool-logging";

interface GeocodingResponse {
  results: {
    latitude: number;
    longitude: number;
    name: string;
  }[];
}
interface WeatherResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    weather_code: number;
  };
}

export const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name"),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
    location: z.string(),
  }),
  // requireApproval: true,
  execute: async (inputData, context) => {
    const log = createToolLogger("get-weather", context);
    log.start({ location: inputData.location });

    try {
      const weather = await getWeather(inputData.location, log);
      log.done("result", "weather returned", {
        location: weather.location,
        conditions: weather.conditions,
        temperature: weather.temperature,
      });
      return weather;
    } catch (error) {
      log.error("execute", error, { location: inputData.location });
      throw error;
    }
  },
});

const getWeather = async (location: string, log: ToolLogger) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;

  const geocodingData = await log.stage(
    "geocode location",
    async () => {
      const geocodingResponse = await fetch(geocodingUrl);
      if (!geocodingResponse.ok) {
        throw new Error(
          `Geocoding request failed with HTTP ${geocodingResponse.status}`,
        );
      }
      return (await geocodingResponse.json()) as GeocodingResponse;
    },
    { location },
  );

  if (!geocodingData.results?.[0]) {
    log.warn("geocode", "location not found", { location });
    throw new Error(`Location '${location}' not found`);
  }

  const { latitude, longitude, name } = geocodingData.results[0];
  log.info("geocode", "location resolved", {
    location,
    resolvedName: name,
    latitude,
    longitude,
  });

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;

  const data = await log.stage(
    "fetch forecast",
    async () => {
      const response = await fetch(weatherUrl);
      if (!response.ok) {
        throw new Error(`Forecast request failed with HTTP ${response.status}`);
      }
      return (await response.json()) as WeatherResponse;
    },
    { resolvedName: name },
  );

  log.info("forecast", "forecast received", {
    resolvedName: name,
    weatherCode: data.current.weather_code,
    observedAt: data.current.time,
  });

  return log.stage("build result", () => ({
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windGust: data.current.wind_gusts_10m,
    conditions: getWeatherCondition(data.current.weather_code),
    location: name,
  }));
};

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return conditions[code] || "Unknown";
}
