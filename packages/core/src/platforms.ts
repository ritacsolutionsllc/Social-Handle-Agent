import { z } from 'zod';

/**
 * Platform metadata is data, not code. Business logic iterates over whatever
 * platforms are enabled in the database; adapters are looked up by `adapterKey`.
 * The catalog below is the seed source for the `platforms` table.
 */

export const SeparatorSchema = z.enum(['_', '.', '-']);
export type Separator = z.infer<typeof SeparatorSchema>;

export const UsernameRulesSchema = z.object({
  /** Characters allowed besides separators, as a regex character-class body. */
  baseCharClass: z.string().default('a-z0-9'),
  separators: z.array(SeparatorSchema),
  minLength: z.number().int().min(1),
  maxLength: z.number().int().min(1),
  caseSensitive: z.boolean().default(false),
  mustStartWithLetter: z.boolean().default(false),
  noLeadingSeparator: z.boolean().default(true),
  noTrailingSeparator: z.boolean().default(true),
  noConsecutiveSeparators: z.boolean().default(true),
});
export type UsernameRules = z.infer<typeof UsernameRulesSchema>;

/**
 * What a handle actually identifies on the platform. These are NOT interchangeable:
 * a free YouTube channel handle says nothing about a free Google account name, and a
 * free Facebook Page username says nothing about personal profiles.
 */
export const EntityTypeSchema = z.enum([
  'user_account', // a personal/brand login account whose username is the handle
  'business_page', // a Page/company page owned by personal accounts (vanity URL)
  'channel_handle', // a channel-level handle under a parent account
  'linked_profile', // a profile whose handle is inherited from another platform's account
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const AvailabilityStrategySchema = z.enum([
  'official_api', // documented API with an answer we can trust
  'http_profile_probe', // public profile page probe, robots.txt-gated, low/medium confidence
  'derived', // inferred from another platform's result
  'manual_only', // no permissible automated check exists
]);
export type AvailabilityStrategy = z.infer<typeof AvailabilityStrategySchema>;

export const CreationStrategySchema = z.enum([
  'guided_manual', // we prepare the plan, the human registers on the platform
  'unsupported',
]);
export type CreationStrategy = z.infer<typeof CreationStrategySchema>;

export const RateLimitPolicySchema = z.object({
  maxConcurrent: z.number().int().min(1),
  maxRetries: z.number().int().min(0),
  baseDelayMs: z.number().int().min(0),
  maxDelayMs: z.number().int().min(0),
  timeoutMs: z.number().int().min(100),
});
export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>;

export const PlatformConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  adapterKey: z.string(),
  entityType: EntityTypeSchema,
  entityDescription: z.string(),
  usernameRules: UsernameRulesSchema,
  profileUrlTemplate: z.string().includes('{handle}'),
  registrationUrl: z.url(),
  availabilityStrategy: AvailabilityStrategySchema,
  availabilityNotes: z.string(),
  derivedFrom: z.string().optional(),
  creationStrategy: CreationStrategySchema,
  manualSteps: z.array(z.string()),
  rateLimitPolicy: RateLimitPolicySchema,
  /** Server-side env var names the live adapter can use. Never sent to the client. */
  requiredCredentials: z.array(z.string()),
});
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

const defaultPolicy: RateLimitPolicy = {
  maxConcurrent: 2,
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  timeoutMs: 6_000,
};

const rules = (r: Partial<UsernameRules> & Pick<UsernameRules, 'separators' | 'minLength' | 'maxLength'>): UsernameRules =>
  UsernameRulesSchema.parse(r);

/**
 * Seed catalog. Username rules are best-effort summaries of each platform's
 * public help pages and must be re-verified periodically; they live in the DB so
 * they can be corrected without a deploy.
 */
export const PLATFORM_CATALOG: readonly PlatformConfig[] = [
  {
    slug: 'x',
    name: 'X / Twitter',
    enabled: true,
    sortOrder: 1,
    adapterKey: 'x',
    entityType: 'user_account',
    entityDescription: 'X account username (@handle). Brand and personal accounts share one namespace.',
    usernameRules: rules({ separators: ['_'], minLength: 5, maxLength: 15 }),
    profileUrlTemplate: 'https://x.com/{handle}',
    registrationUrl: 'https://x.com/i/flow/signup',
    availabilityStrategy: 'official_api',
    availabilityNotes:
      'API v2 GET /2/users/by/username/:username (paid API tier). Not-found is medium confidence: suspended, deactivated and reserved names are also not found.',
    creationStrategy: 'guided_manual',
    manualSteps: ['Sign up with the workspace email', 'Verify email and/or phone as prompted', 'Set the username in Settings → Your account'],
    rateLimitPolicy: { ...defaultPolicy, maxConcurrent: 1 },
    requiredCredentials: ['X_BEARER_TOKEN'],
  },
  {
    slug: 'instagram',
    name: 'Instagram',
    enabled: true,
    sortOrder: 2,
    adapterKey: 'instagram',
    entityType: 'user_account',
    entityDescription: 'Instagram account username. Also determines the Threads handle.',
    usernameRules: rules({ separators: ['_', '.'], minLength: 1, maxLength: 30 }),
    profileUrlTemplate: 'https://www.instagram.com/{handle}/',
    registrationUrl: 'https://www.instagram.com/accounts/emailsignup/',
    availabilityStrategy: 'official_api',
    availabilityNotes:
      'Graph API Business Discovery can only find Business/Creator accounts, so it can confirm "taken" but can never confirm "available". Personal accounts are invisible to it.',
    creationStrategy: 'guided_manual',
    manualSteps: ['Sign up with the workspace email', 'Complete email/phone verification', 'Switch to a Professional account if needed'],
    rateLimitPolicy: { ...defaultPolicy, maxConcurrent: 1 },
    requiredCredentials: ['META_GRAPH_ACCESS_TOKEN', 'META_IG_BUSINESS_ACCOUNT_ID'],
  },
  {
    slug: 'facebook',
    name: 'Facebook',
    enabled: true,
    sortOrder: 3,
    adapterKey: 'facebook',
    entityType: 'business_page',
    entityDescription: 'Facebook Page username (facebook.com/<username>). Pages are created from a personal profile.',
    usernameRules: rules({ separators: ['.'], minLength: 5, maxLength: 50 }),
    profileUrlTemplate: 'https://www.facebook.com/{handle}',
    registrationUrl: 'https://www.facebook.com/pages/create',
    availabilityStrategy: 'manual_only',
    availabilityNotes: 'No public API exposes username availability and Meta terms prohibit automated collection. Check manually while creating the Page.',
    creationStrategy: 'guided_manual',
    manualSteps: ['Log in with an admin personal profile', 'Create the Page', 'Set the Page username in Page settings'],
    rateLimitPolicy: defaultPolicy,
    requiredCredentials: [],
  },
  {
    slug: 'tiktok',
    name: 'TikTok',
    enabled: true,
    sortOrder: 4,
    adapterKey: 'tiktok',
    entityType: 'user_account',
    entityDescription: 'TikTok account username (@handle).',
    usernameRules: rules({ separators: ['_', '.'], minLength: 2, maxLength: 24 }),
    profileUrlTemplate: 'https://www.tiktok.com/@{handle}',
    registrationUrl: 'https://www.tiktok.com/signup',
    availabilityStrategy: 'http_profile_probe',
    availabilityNotes:
      'No public lookup API for arbitrary users. Profile-page probe (robots.txt permitting) parses embedded user data; bot protection frequently makes the result unknown.',
    creationStrategy: 'guided_manual',
    manualSteps: ['Sign up with the workspace email', 'Complete verification', 'Change the username in Edit profile'],
    rateLimitPolicy: { ...defaultPolicy, maxConcurrent: 1 },
    requiredCredentials: [],
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    enabled: true,
    sortOrder: 5,
    adapterKey: 'youtube',
    entityType: 'channel_handle',
    entityDescription: 'YouTube channel @handle. A channel lives under a Google account; the handle is not the Google account name.',
    usernameRules: rules({ separators: ['_', '.', '-'], minLength: 3, maxLength: 30 }),
    profileUrlTemplate: 'https://www.youtube.com/@{handle}',
    registrationUrl: 'https://www.youtube.com/create_channel',
    availabilityStrategy: 'official_api',
    availabilityNotes:
      'Data API v3 channels?forHandle= (API key). Without a key, falls back to a robots-permitted /@handle probe at lower confidence. Terminated or reserved handles can still be unclaimable.',
    creationStrategy: 'guided_manual',
    manualSteps: ['Sign in to the Google account that will own the channel', 'Create the channel', 'Choose the handle at youtube.com/handle'],
    rateLimitPolicy: defaultPolicy,
    requiredCredentials: ['YOUTUBE_API_KEY'],
  },
  {
    slug: 'linkedin',
    name: 'LinkedIn',
    enabled: true,
    sortOrder: 6,
    adapterKey: 'linkedin',
    entityType: 'business_page',
    entityDescription: 'LinkedIn Company Page public URL (linkedin.com/company/<slug>). Created from a personal member profile.',
    usernameRules: rules({ separators: ['-'], minLength: 3, maxLength: 100 }),
    profileUrlTemplate: 'https://www.linkedin.com/company/{handle}',
    registrationUrl: 'https://www.linkedin.com/company/setup/new/',
    availabilityStrategy: 'manual_only',
    availabilityNotes: 'No API exposes company URL availability and LinkedIn terms prohibit scraping. The setup form validates the URL interactively.',
    creationStrategy: 'guided_manual',
    manualSteps: ['Log in with a verified member profile', 'Create the Company Page', 'Enter the public URL slug in the setup form'],
    rateLimitPolicy: defaultPolicy,
    requiredCredentials: [],
  },
  {
    slug: 'pinterest',
    name: 'Pinterest',
    enabled: true,
    sortOrder: 7,
    adapterKey: 'pinterest',
    entityType: 'user_account',
    entityDescription: 'Pinterest account username (business or personal).',
    usernameRules: rules({ separators: ['_'], minLength: 3, maxLength: 30 }),
    profileUrlTemplate: 'https://www.pinterest.com/{handle}/',
    registrationUrl: 'https://www.pinterest.com/business/create/',
    availabilityStrategy: 'http_profile_probe',
    availabilityNotes: 'No public lookup API for arbitrary users. Profile probe (robots.txt permitting) is low confidence.',
    creationStrategy: 'guided_manual',
    manualSteps: ['Create a business account with the workspace email', 'Verify email', 'Set the username in Settings → Profile'],
    rateLimitPolicy: { ...defaultPolicy, maxConcurrent: 1 },
    requiredCredentials: [],
  },
  {
    slug: 'reddit',
    name: 'Reddit',
    enabled: true,
    sortOrder: 8,
    adapterKey: 'reddit',
    entityType: 'user_account',
    entityDescription: 'Reddit username (u/<name>). Usernames cannot be changed after signup.',
    usernameRules: rules({ separators: ['_', '-'], minLength: 3, maxLength: 20, noLeadingSeparator: false, noTrailingSeparator: false }),
    profileUrlTemplate: 'https://www.reddit.com/user/{handle}',
    registrationUrl: 'https://www.reddit.com/register/',
    availabilityStrategy: 'official_api',
    availabilityNotes: 'Official GET /api/username_available via OAuth app-only token. Unauthenticated access is blocked (HTTP 403).',
    creationStrategy: 'guided_manual',
    manualSteps: ['Register with the workspace email', 'Pick the username (permanent)', 'Verify email'],
    rateLimitPolicy: defaultPolicy,
    requiredCredentials: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT'],
  },
  {
    slug: 'snapchat',
    name: 'Snapchat',
    enabled: true,
    sortOrder: 9,
    adapterKey: 'snapchat',
    entityType: 'user_account',
    entityDescription: 'Snapchat username. Public Profiles for businesses are attached to an account.',
    usernameRules: rules({ separators: ['_', '.', '-'], minLength: 3, maxLength: 15, mustStartWithLetter: true }),
    profileUrlTemplate: 'https://www.snapchat.com/add/{handle}',
    registrationUrl: 'https://accounts.snapchat.com/accounts/signup',
    availabilityStrategy: 'http_profile_probe',
    availabilityNotes: 'No public lookup API. /add/<name> probe (robots.txt permitting) cannot see private accounts, so "not found" is never treated as available.',
    creationStrategy: 'guided_manual',
    manualSteps: ['Sign up in the Snapchat app or web', 'Verify phone/email', 'Create a Public Profile for the business'],
    rateLimitPolicy: { ...defaultPolicy, maxConcurrent: 1 },
    requiredCredentials: [],
  },
  {
    slug: 'threads',
    name: 'Threads',
    enabled: true,
    sortOrder: 10,
    adapterKey: 'threads',
    entityType: 'linked_profile',
    entityDescription: 'Threads profile. The handle is inherited from the linked Instagram account and cannot be chosen independently.',
    usernameRules: rules({ separators: ['_', '.'], minLength: 1, maxLength: 30 }),
    profileUrlTemplate: 'https://www.threads.com/@{handle}',
    registrationUrl: 'https://www.threads.com/login',
    availabilityStrategy: 'derived',
    availabilityNotes: 'Derived from the Instagram result: claim the Instagram username first, then log in to Threads with that account.',
    derivedFrom: 'instagram',
    creationStrategy: 'guided_manual',
    manualSteps: ['Claim the Instagram username first', 'Log in to Threads with that Instagram account'],
    rateLimitPolicy: defaultPolicy,
    requiredCredentials: [],
  },
];

export function profileUrlFor(platform: Pick<PlatformConfig, 'profileUrlTemplate'>, handle: string): string {
  return platform.profileUrlTemplate.replace('{handle}', encodeURIComponent(handle));
}
