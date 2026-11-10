import { z } from "zod";

const schema = z.object({
  CONTENTFUL_ORG_ID: z.string().min(1),
  SOURCE_SPACE_ID: z.string().min(1),
  SOURCE_ENVIRONMENT_ID: z.string().min(1).default("master"),
  TEMPLATE_IDS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1)),
  CONTENTFUL_CMA_TOKEN: z.string().min(1),
  // Optional for the PoC: when set, webhook signatures are verified; when blank, they are not.
  CONTENTFUL_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  AUTO_INSTALL_MODE: z.enum(["additive-only", "all", "manual"]).default("additive-only"),
  DASHBOARD_PASSWORD: z.string().min(1),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/**
 * Validates and returns the environment config. Throws a readable error that
 * names the offending variables but never echoes their values.
 */
export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env && cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${problems}`);
  }
  if (env === process.env) cached = parsed.data;
  return parsed.data;
}
