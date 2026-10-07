import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

export type GenOptions = {
  model: string;
  aspectRatio: string;
  imageSize: string;
};

export type Generator = (prompt: string, opts: GenOptions) => Promise<Buffer>;

export const MODELS = {
  lite: "gemini-3.1-flash-lite-image", // fastest and cheapest, 1K only
  flash: "gemini-3.1-flash-image", // default, general use
  pro: "gemini-3-pro-image", // highest quality
} as const;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const msg = e?.message ?? "";
  // Quota blocks never clear on a retry, so fail fast.
  if (/limit: 0|upgrade your tier|per day/i.test(msg)) return false;
  const status = e?.status ?? e?.statusCode;
  if (status && RETRYABLE.has(status)) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|overloaded/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let client: GoogleGenAI | undefined;

export const geminiGenerator: Generator = async (prompt, opts) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
  }
  client ??= new GoogleGenAI({});

  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      const interaction = await client.interactions.create({
        model: opts.model,
        input: prompt,
        response_format: {
          type: "image",
          aspect_ratio: opts.aspectRatio,
          image_size: opts.imageSize,
        },
      });
      const img = interaction.output_image;
      if (!img?.data) {
        const text = interaction.output_text ?? "no text returned";
        throw new NoImageError(`No image in response. Model said: ${text}`);
      }
      return Buffer.from(img.data, "base64");
    } catch (err) {
      if (err instanceof NoImageError || attempt >= maxAttempts || !isRetryable(err)) throw err;
      const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      console.warn(`  retry ${attempt}/${maxAttempts - 1} in ${Math.round(wait)}ms`);
      await sleep(wait);
    }
  }
};

export class NoImageError extends Error {}
