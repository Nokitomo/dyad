import { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { ProviderSettingsGrid } from "@/components/ProviderSettings";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import {
  IpcClient,
  GitHubDeviceFlowUpdateData,
  GitHubDeviceFlowErrorData,
  GitHubDeviceFlowSuccessData,
} from "@/ipc/ipc_client";
import { showSuccess, showError, showInfo } from "@/lib/toast";
import { AutoApproveSwitch } from "@/components/AutoApproveSwitch";
import { TelemetrySwitch } from "@/components/TelemetrySwitch";
import { MaxChatTurnsSelector } from "@/components/MaxChatTurnsSelector";
import { useSettings } from "@/hooks/useSettings";
import { useAppVersion } from "@/hooks/useAppVersion";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Github,
  DatabaseZap,
  Rocket,
  ExternalLink,
  Clipboard,
  Check,
  Loader2,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { INTEGRATION_PROVIDERS } from "@/shared/integrations";

import { vercelSettingsRoute } from "@/routes/settings/vercel";
import { GitHubIntegration } from "@/components/GitHubIntegration";
import { SupabaseIntegration } from "@/components/SupabaseIntegration";
import { Label } from "@/components/ui/label";
import { VercelIntegration } from "@/components/VercelIntegration";
import { useDeepLink } from "@/contexts/DeepLinkContext"; // Import useDeepLink

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const appVersion = useAppVersion();
  const { settings, updateSettings, refreshSettings } = useSettings();
  const router = useRouter();
  const { lastDeepLink } = useDeepLink(); // Use the deep link context

  // State per il GitHub Device Flow
  const [githubUserCode, setGithubUserCode] = useState<string | null>(null);
  const [githubVerificationUri, setGithubVerificationUri] = useState<
    string | null
  >(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [isConnectingToGithub, setIsConnectingToGithub] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | null>(
    null,
  );
  const [codeCopied, setCodeCopied] = useState(false);
  const [showGithubAuthModal, setShowGithubAuthModal] = useState(false);

  // Effect to refresh settings when a relevant deep link is processed
  useEffect(() => {
    const handleDeepLinkEffect = async () => {
      if (
        lastDeepLink?.type === "supabase-oauth-return" ||
        lastDeepLink?.type === "dyad-pro-return" // Also useful for other settings changes
      ) {
        console.log(
          `SettingsPage: Deep link ${lastDeepLink.type} detected. Refreshing settings.`,
        );
        await refreshSettings();
      }
    };
    if (lastDeepLink) {
      handleDeepLinkEffect();
    }
  }, [lastDeepLink, refreshSettings]);

  useEffect(() => {
    const cleanupFunctions: (() => void)[] = [];

    if (isConnectingToGithub) {
      const removeUpdateListener =
        IpcClient.getInstance().onGithubDeviceFlowUpdate(
          (data: GitHubDeviceFlowUpdateData) => {
            if (data.userCode) setGithubUserCode(data.userCode);
            if (data.verificationUri)
              setGithubVerificationUri(data.verificationUri);
            if (data.message) setGithubStatusMessage(data.message);
            setGithubError(null);
          },
        );
      cleanupFunctions.push(removeUpdateListener);

      const removeSuccessListener =
        IpcClient.getInstance().onGithubDeviceFlowSuccess(
          (data: GitHubDeviceFlowSuccessData) => {
            setGithubStatusMessage(
              data.message || "Successfully connected to GitHub!",
            );
            setGithubUserCode(null);
            setGithubVerificationUri(null);
            setGithubError(null);
            setIsConnectingToGithub(false);
            setShowGithubAuthModal(false);
            refreshSettings();
          },
        );
      cleanupFunctions.push(removeSuccessListener);

      const removeErrorListener =
        IpcClient.getInstance().onGithubDeviceFlowError(
          (data: GitHubDeviceFlowErrorData) => {
            setGithubError(data.error || "An unknown error occurred.");
            setGithubStatusMessage(null);
            setGithubUserCode(null);
            setGithubVerificationUri(null);
            setIsConnectingToGithub(false);
          },
        );
      cleanupFunctions.push(removeErrorListener);
    }
    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [isConnectingToGithub, refreshSettings]);

  const handleResetEverything = async () => {
    setIsResetting(true);
    try {
      const ipcClient = IpcClient.getInstance();
      await ipcClient.resetAll();
      showSuccess("Successfully reset everything. Restart the application.");
    } catch (error) {
      console.error("Error resetting:", error);
      showError(
        error instanceof Error ? error.message : "An unknown error occurred",
      );
    } finally {
      setIsResetting(false);
      setIsResetDialogOpen(false);
    }
  };

  const getIntegrationStatus = (integrationId: string) => {
    switch (integrationId) {
      case "github":
        return settings?.githubAccessToken ? "Connected" : "Not Connected";
      case "supabase":
        return settings?.supabase?.accessToken ? "Connected" : "Not Connected";
      case "vercel":
        return settings?.vercel?.accessToken ? "Connected" : "Not Connected";
      default:
        return "Not Connected";
    }
  };

  const getIntegrationIcon = (integrationId: string) => {
    switch (integrationId) {
      case "github":
        return <Github className="mb-2 h-10 w-10 text-muted-foreground" />;
      case "supabase":
        return <DatabaseZap className="mb-2 h-10 w-10 text-muted-foreground" />;
      case "vercel":
        return <Rocket className="mb-2 h-10 w-10 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const handleIntegrationClick = (integrationId: string) => {
    if (integrationId === "vercel") {
      router.navigate({ to: vercelSettingsRoute.id });
    } else if (integrationId === "github") {
      if (!settings?.githubAccessToken) {
        setIsConnectingToGithub(true);
        setGithubError(null);
        setGithubUserCode(null);
        setGithubVerificationUri(null);
        setGithubStatusMessage("Requesting device code from GitHub...");
        setShowGithubAuthModal(true);
        IpcClient.getInstance().startGithubDeviceFlow(null);
      } else {
        showInfo(
          "Already connected to GitHub. You can manage the connection below.",
        );
      }
    } else if (integrationId === "supabase") {
      if (!settings?.supabase?.accessToken) {
        IpcClient.getInstance().openExternalUrl(
          "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
        );
      } else {
        showInfo(
          "Already connected to Supabase. You can manage the connection below.",
        );
      }
    }
  };

  return (
    <div className="min-h-screen px-8 py-4">
      <div className="mx-auto max-w-5xl">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="mb-4 flex items-center gap-2 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        <div className="mb-4 flex justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Settings
          </h1>
          <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
            <span className="mr-2 font-medium">App Version:</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">
              {appVersion ? appVersion : "-"}
            </span>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
              General Settings
            </h2>
            <div className="mb-4 space-y-4">
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Theme
                </label>
                <div className="relative flex rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
                  {(["system", "light", "dark"] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() => setTheme(option)}
                      className={`
                        rounded-md px-4 py-1.5 text-sm font-medium
                        transition-all duration-200
                        ${
                          theme === option
                            ? "bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-white"
                            : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                        }
                      `}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <AutoApproveSwitch showToast={false} />
              <div className="text-sm text-gray-500 dark:text-gray-400">
                This will automatically approve code changes and run them.
              </div>
            </div>

            <div className="space-y-1 mt-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="enable-native-git"
                  checked={!!settings?.enableNativeGit}
                  onCheckedChange={(checked) => {
                    updateSettings({
                      enableNativeGit: checked,
                    });
                  }}
                />
                <Label htmlFor="enable-native-git">Enable Native Git</Label>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                (Experimental) Native Git offers faster performance but requires{" "}
                <a
                  onClick={() => {
                    IpcClient.getInstance().openExternalUrl(
                      "https://git-scm.com/downloads",
                    );
                  }}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  installing Git
                </a>
                .
              </div>
            </div>

            <div className="mt-4">
              <MaxChatTurnsSelector />
            </div>
          </div>

          <div className="rounded-xl bg-white shadow-sm dark:bg-gray-800">
            <ProviderSettingsGrid />
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
              Integrations
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {INTEGRATION_PROVIDERS.map((integration) => (
                <Card
                  key={integration.id}
                  className="group relative cursor-pointer overflow-hidden rounded-xl border-border shadow-sm transition-all duration-300 ease-in-out hover:-translate-y-1 hover:shadow-lg"
                  onClick={() => handleIntegrationClick(integration.id)}
                >
                  <CardHeader className="flex h-full flex-col items-center justify-center p-4">
                    {getIntegrationIcon(integration.id)}
                    <CardTitle className="text-center text-xl">
                      {integration.name}
                    </CardTitle>
                    <CardDescription className="text-center">
                      {integration.description}
                    </CardDescription>
                    <span className="mt-2 rounded-full bg-gray-50 px-2 py-1 text-sm font-medium text-gray-500 dark:bg-gray-900 dark:text-gray-300">
                      {getIntegrationStatus(integration.id)}
                    </span>
                  </CardHeader>
                </Card>
              ))}
            </div>
            <div className="mt-6 space-y-4">
              <GitHubIntegration />
              <SupabaseIntegration />
              <VercelIntegration />
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
              <h2 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
                Telemetry
              </h2>
              <div className="space-y-2">
                <TelemetrySwitch />
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  This records anonymous usage data to improve the product.
                </div>
              </div>
              <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                <span className="mr-2 font-medium">Telemetry ID:</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                  {settings ? settings.telemetryUserId : "n/a"}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
              Experiments
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="enable-file-editing"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Enable File Editing
                </label>
                <Switch
                  id="enable-file-editing"
                  checked={!!settings?.experiments?.enableFileEditing}
                  onCheckedChange={(checked) => {
                    updateSettings({
                      experiments: {
                        ...settings?.experiments,
                        enableFileEditing: checked,
                      },
                    });
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                File editing is not reliable and requires you to manually commit
                changes and update Supabase edge functions.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-800 dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-medium text-red-600 dark:text-red-400">
              Danger Zone
            </h2>
            <div className="space-y-4">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    Reset Everything
                  </h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    This will delete all your apps, chats, and settings. This
                    action cannot be undone.
                  </p>
                </div>
                <button
                  onClick={() => setIsResetDialogOpen(true)}
                  disabled={isResetting}
                  className="rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isResetting ? "Resetting..." : "Reset Everything"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={isResetDialogOpen}
        title="Reset Everything"
        message="Are you sure you want to reset everything? This will delete all your apps, chats, and settings. This action cannot be undone."
        confirmText="Reset Everything"
        cancelText="Cancel"
        onConfirm={handleResetEverything}
        onCancel={() => setIsResetDialogOpen(false)}
      />

      <Dialog
        open={showGithubAuthModal}
        onOpenChange={(open) => {
          if (!open) {
            setIsConnectingToGithub(false);
            setGithubUserCode(null);
            setGithubVerificationUri(null);
            setGithubError(null);
            setGithubStatusMessage(null);
          }
          setShowGithubAuthModal(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Github className="mr-2 h-5 w-5" /> Connect to GitHub
            </DialogTitle>
            <DialogDescription>
              Follow these steps to authorize Dyad with your GitHub account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {githubError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Error: {githubError}
              </p>
            )}
            {isConnectingToGithub && !githubUserCode && !githubError && (
              <div className="flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {githubStatusMessage || "Requesting authorization code..."}
              </div>
            )}
            {githubUserCode && githubVerificationUri && (
              <div className="space-y-2 text-sm">
                <p>
                  1. Open this URL in your browser:
                  <Button
                    variant="link"
                    className="ml-1 h-auto p-0 text-blue-600 dark:text-blue-400"
                    onClick={() =>
                      IpcClient.getInstance().openExternalUrl(
                        githubVerificationUri,
                      )
                    }
                  >
                    {githubVerificationUri}{" "}
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                </p>
                <div>
                  2. Enter this code:
                  <div className="mt-1 flex items-center gap-2">
                    <strong className="rounded-md bg-gray-100 px-3 py-1 font-mono text-lg tracking-wider dark:bg-gray-700">
                      {githubUserCode}
                    </strong>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(githubUserCode)
                          .then(() => {
                            setCodeCopied(true);
                            setTimeout(() => setCodeCopied(false), 2000);
                          });
                      }}
                      title="Copy code"
                    >
                      {codeCopied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Clipboard className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {githubStatusMessage && !githubUserCode && (
              <p className="text-sm text-muted-foreground">
                {githubStatusMessage}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsConnectingToGithub(false);
                setShowGithubAuthModal(false);
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
