export interface IntegrationDetails {
  id: string;
  name: string;
  description: string;
  icon: string; // Path to icon or icon component name
  websiteUrl?: string;
  envVarName?: string;
}

export const GITHUB_INTEGRATION_DETAILS: IntegrationDetails = {
  id: "github",
  name: "GitHub",
  description: "Connect to GitHub to manage your repositories.",
  icon: "Github", // Assuming you'll use lucide-react icon name
  websiteUrl: "https://github.com/settings/tokens",
  // GitHub typically uses OAuth or PATs, not a single env var for general access
};

export const SUPABASE_INTEGRATION_DETAILS: IntegrationDetails = {
  id: "supabase",
  name: "Supabase",
  description: "Connect to your Supabase projects.",
  icon: "DatabaseZap", // Assuming you'll use lucide-react icon name
  websiteUrl: "https://supabase.com/dashboard",
  // Supabase uses OAuth flow managed by Dyad
};

export const VERCEL_INTEGRATION_DETAILS: IntegrationDetails = {
  id: "vercel",
  name: "Vercel",
  description: "Deploy your apps directly to Vercel.",
  icon: "Rocket", // Assuming you'll use lucide-react icon name
  websiteUrl: "https://vercel.com/account/tokens",
  envVarName: "VERCEL_ACCESS_TOKEN",
};

// Add other integrations here as needed
export const INTEGRATION_PROVIDERS: IntegrationDetails[] = [
  GITHUB_INTEGRATION_DETAILS,
  SUPABASE_INTEGRATION_DETAILS,
  VERCEL_INTEGRATION_DETAILS,
];
