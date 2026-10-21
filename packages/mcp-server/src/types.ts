import { z } from "zod";

export const CONDITIONS = ["asthma", "pollen_allergy", "none"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const POLLEN_TYPES = ["alder", "birch", "grass", "mugwort", "olive", "ragweed"] as const;
export type PollenType = (typeof POLLEN_TYPES)[number];

export const AIR_METRICS = ["european_aqi", "pm2_5", "pm10", "ozone", "nitrogen_dioxide"] as const;
export type AirMetric = (typeof AIR_METRICS)[number];

export const ALERT_METRICS = [
  ...AIR_METRICS,
  "alder_pollen",
  "birch_pollen",
  "grass_pollen",
  "mugwort_pollen",
  "olive_pollen",
  "ragweed_pollen"
] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export const SYMPTOMS = [
  "cough",
  "wheeze",
  "shortness_of_breath",
  "sneezing",
  "runny_nose",
  "itchy_eyes",
  "headache",
  "other"
] as const;
export type Symptom = (typeof SYMPTOMS)[number];

export const VERDICTS = ["good", "caution", "stay_in"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const MemberSchema = z.object({
  name: z.string().min(1).max(40).describe("First name used when speaking about this person"),
  conditions: z
    .array(z.enum(CONDITIONS))
    .min(1)
    .describe("asthma, pollen_allergy or none; a member may have several"),
  pollen: z
    .array(z.enum(POLLEN_TYPES))
    .optional()
    .describe("Pollen types that affect this member; omit to count every pollen type")
});
export type Member = z.infer<typeof MemberSchema>;

export const HomeSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  label: z.string().max(80).optional().describe("Spoken name for the place, e.g. 'home in the city centre'")
});
export type Home = z.infer<typeof HomeSchema>;

export const AlertRuleSchema = z.object({
  id: z.string(),
  member: z.string(),
  metric: z.enum(ALERT_METRICS),
  above: z.number().describe("Fire when the metric is strictly above this value")
});
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const PollenReadingsSchema = z.object({
  alder: z.number().nullable(),
  birch: z.number().nullable(),
  grass: z.number().nullable(),
  mugwort: z.number().nullable(),
  olive: z.number().nullable(),
  ragweed: z.number().nullable()
});
export type PollenReadings = z.infer<typeof PollenReadingsSchema>;

export const ReadingsSchema = z.object({
  time: z.string().describe("Local time at the home, ISO 8601 without offset"),
  european_aqi: z.number().nullable(),
  pm2_5: z.number().nullable(),
  pm10: z.number().nullable(),
  ozone: z.number().nullable(),
  nitrogen_dioxide: z.number().nullable(),
  pollen: PollenReadingsSchema
});
export type Readings = z.infer<typeof ReadingsSchema>;

export const SymptomEntrySchema = z.object({
  id: z.string(),
  member: z.string(),
  symptom: z.enum(SYMPTOMS),
  severity: z.number().int().min(1).max(5),
  note: z.string().max(200).optional(),
  loggedAt: z.string().describe("UTC timestamp"),
  readings: ReadingsSchema.nullable()
});
export type SymptomEntry = z.infer<typeof SymptomEntrySchema>;

export const HouseholdSchema = z.object({
  version: z.literal(1),
  home: HomeSchema.nullable(),
  members: z.array(MemberSchema),
  alertRules: z.array(AlertRuleSchema),
  lastFired: z.record(z.string(), z.string()),
  symptoms: z.array(SymptomEntrySchema)
});
export type Household = z.infer<typeof HouseholdSchema>;

export function emptyHousehold(): Household {
  return { version: 1, home: null, members: [], alertRules: [], lastFired: {}, symptoms: [] };
}
