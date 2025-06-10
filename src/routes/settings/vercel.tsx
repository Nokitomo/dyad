import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "@/routes/root";
import { VercelSettingsPage } from "@/pages/settings/VercelSettingsPage";

export const vercelSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/vercel",
  component: VercelSettingsPage,
});
