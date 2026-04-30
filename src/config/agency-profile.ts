import fs from "fs";
import path from "path";

export interface AgencyProfile {
  name: string;
  positioning: string;
  voice: {
    summary: string;
    tone: string;
    forbiddenPhrases: string[];
  };
  brand: {
    primaryColor: string;
    accentColor: string;
    textColor: string;
    borderColor: string;
    headerTextColor: string;
  };
  proof: {
    credentials: string[];
    partners: string[];
    clients: string[];
    openSource: string[];
  };
  services: string[];
  links: {
    website: string;
    clutch: string;
    github: string;
  };
  commercials: {
    currency: string;
    aiProductivityAdjustment: string;
    pageBudget: string;
    thirdPartyCostPolicy: string;
  };
  research: {
    allowedDomains: string[];
  };
}

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? PartialDeep<T[K]>
      : T[K];
};

export const defaultAgencyProfile: AgencyProfile = {
  name: "Example Digital Studio",
  positioning: "A senior product engineering team for complex web platforms.",
  voice: {
    summary: "Write as a senior product engineer explaining a practical delivery plan to an executive buyer.",
    tone: "direct, practical, senior, business-aware",
    forbiddenPhrases: ["cutting-edge", "best-in-class", "synergy", "leverage"],
  },
  brand: {
    primaryColor: "#2563EB",
    accentColor: "#F97316",
    textColor: "#111827",
    borderColor: "#E5E7EB",
    headerTextColor: "#FFFFFF",
  },
  proof: {
    credentials: [
      "Senior product engineering team",
      "Experience with SaaS, e-commerce, and content platforms",
    ],
    partners: ["Vercel", "Contentful"],
    clients: ["Acme Learning", "Northwind Commerce", "Atlas Media"],
    openSource: ["pre-sales-agent starter"],
  },
  services: [
    "product discovery",
    "web platform development",
    "performance engineering",
    "CMS and commerce integrations",
    "AI workflow automation",
  ],
  links: {
    website: "https://example.com",
    clutch: "https://example.com/reviews",
    github: "https://github.com/example",
  },
  commercials: {
    currency: "EUR",
    aiProductivityAdjustment: "Apply a conservative productivity adjustment to development tasks only.",
    pageBudget: "5-12 pages",
    thirdPartyCostPolicy: "Exclude external tooling, hosting, and third-party service costs unless the client explicitly confirms those costs are included in the project price.",
  },
  research: {
    allowedDomains: ["example.com"],
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeDeep<T>(base: T, override: PartialDeep<T>): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(value)
      ? mergeDeep(baseValue, value)
      : value;
  }
  return result as T;
}

function bulletList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- Not configured";
}

export function loadAgencyProfile(env: NodeJS.ProcessEnv = process.env): AgencyProfile {
  const profilePath = env.AGENCY_PROFILE_PATH;
  if (!profilePath) return defaultAgencyProfile;

  const resolved = path.resolve(profilePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as PartialDeep<AgencyProfile>;
  return mergeDeep(defaultAgencyProfile, parsed);
}

export function buildAgencyIdentityPrompt(profile: AgencyProfile): string {
  const forbidden = profile.voice.forbiddenPhrases.map((phrase) => `"${phrase}"`).join(", ");
  return `VOICE & TONE (based on the configured agency profile):
${profile.voice.summary}

Tone: ${profile.voice.tone}.

Forbidden phrases: ${forbidden}.

COMPANY IDENTITY - You are writing offers on behalf of ${profile.name}.

${profile.positioning}

Key credentials:
${bulletList(profile.proof.credentials)}

Partners:
${bulletList(profile.proof.partners)}

Client references:
${bulletList(profile.proof.clients)}

Open source:
${bulletList(profile.proof.openSource)}

Core services:
${bulletList(profile.services)}

Relevant links:
- Website - ${profile.links.website}
- Reviews - ${profile.links.clutch}
- GitHub - ${profile.links.github}

When writing offers, speak as ${profile.name}: "we", "our team", "our experience." Never say "the agency" or "the company." Position ${profile.name} as the expert partner, not a generic vendor.

Challenger-style approach:
- Teach the client something useful about the problem, market, delivery risk, or hidden operational cost.
- Tailor every recommendation to the client's business model, team maturity, and constraints.
- Take control of the conversation by naming trade-offs directly instead of listing generic options.
- Connect technical choices to measurable business outcomes, not implementation novelty.

Writing rules:
- Sound like a senior practitioner who has solved similar problems before.
- Prefer concrete diagnoses, assumptions, constraints, and next actions over broad claims.
- Use proof only when it is configured in the agency profile or found in the knowledge base.
- Keep persuasive language specific: cite relevant services, clients, metrics, partner credentials, or open-source work when available.
- Avoid hype, vague excellence claims, and unsupported certainty.`;
}
