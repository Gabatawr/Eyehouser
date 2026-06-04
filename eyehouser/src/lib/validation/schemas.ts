import { z } from 'zod';

export const TimingSchema = z.object({
  startTime: z.number(),
  duration: z.number().optional(),
});

export const CapturedDataSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['fetch', 'xhr', 'blob', 'data-url']),
  url: z.string(),
  method: z.string().max(10).optional(),
  status: z.number().int().min(0).max(999).optional(),
  requestBody: z.string().optional(),
  requestBodySize: z.number().int().min(0).optional(),
  requestHeaders: z.record(z.string()).optional(),
  responseHeaders: z.record(z.string()).optional(),
  responseBody: z.string().optional(),
  responseBodySize: z.number().int().min(0).optional(),
  responseChunks: z.array(z.string()).optional(),
  contentType: z.string().optional(),
  timing: TimingSchema.optional(),
  tabId: z.number().int().optional(),
  blobType: z.string().optional(),
  blobSize: z.number().int().min(0).optional(),
  blobContent: z.string().optional(),
  blobRevoked: z.boolean().optional(),
});

export const MainMessageSchema = z.object({
  source: z.literal('eyehouser'),
  type: z.literal('capture'),
  data: CapturedDataSchema,
});

export const BatchMessageSchema = z.object({
  type: z.literal('batch'),
  batch: z.array(z.object({
    source: z.literal('eyehouser'),
    type: z.literal('capture'),
    data: CapturedDataSchema,
  })),
});

export const ConditionSchema = z.object({
  type: z.enum(['url', 'method', 'status', 'domain', 'resource-type', 'content-type']),
  operator: z.string(),
  value: z.string(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const CaptureRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  enabled: z.boolean(),
  conditions: z.array(ConditionSchema),
  logic: z.enum(['and', 'or']),
  tags: z.array(z.string()).optional(),
  capture: z.object({
    requestBody: z.boolean(),
    responseBody: z.boolean(),
    headers: z.boolean(),
    maxBodySize: z.number().int().min(0),
  }),
  created: z.number().optional(),
  updated: z.number().optional(),
});

export const ConfigSchema = z.object({
  captureAll: z.boolean().optional(),
  captureFetch: z.boolean().optional(),
  captureXhr: z.boolean().optional(),
  captureBlob: z.boolean().optional(),
  captureDataUrls: z.boolean().optional(),
  useWebRequestBackup: z.boolean().optional(),
  maxBodySize: z.number().int().min(0).optional(),
  maxEntries: z.number().int().min(0).optional(),
  autoSaveToStorage: z.boolean().optional(),
  streamEndpoint: z.string().optional(),
  theme: z.enum(['dark', 'light']).optional(),
  overlayWidth: z.number().min(20).max(80).optional(),
});

export function validateWith<T>(schema: z.ZodSchema<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn('[eyehouser] validation failed:', result.error.issues);
    return null;
  }
  return result.data;
}
