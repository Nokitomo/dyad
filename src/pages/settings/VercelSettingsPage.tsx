import { useState, useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  KeyRound,
  ExternalLink,
  Rocket,
  Info,
  Trash2,
} from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showError, showSuccess } from "@/lib/toast";
import { INTEGRATION_PROVIDERS } from "@/shared/integrations";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { IpcClient } from "@/ipc/ipc_client";

export function VercelSettingsPage() {
  const router = useRouter();
  const {
    settings,
    envVars,
    loading: settingsLoading,
    error: settingsError,
    updateSettings,
  } = useSettings();

  const vercelDetails = INTEGRATION_PROVIDERS.find((p) => p.id === "vercel");

  const [accessTokenInput, setAccessTokenInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const userAccessToken = settings?.vercel?.accessToken?.value;
  const envAccessToken = vercelDetails?.envVarName
    ? envVars[vercelDetails.envVarName]
    : undefined;
  const activeAccessToken = userAccessToken || envAccessToken;
  const isConfigured = !!activeAccessToken;

  const handleSaveKey = async () => {
    if (!accessTokenInput) {
      setSaveError("Access Token cannot be empty.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        vercel: {
          accessToken: {
            value: accessTokenInput,
          },
        },
      });
      setAccessTokenInput(""); // Clear input on success
      showSuccess("Vercel Access Token saved successfully!");
    } catch (error: any) {
      console.error("Error saving Vercel access token:", error);
      setSaveError(error.message || "Failed to save Vercel access token.");
      showError(error.message || "Failed to save Vercel access token.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteKey = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        vercel: {
          accessToken: undefined,
        },
      });
      showSuccess("Vercel Access Token deleted successfully!");
    } catch (error: any) {
      console.error("Error deleting Vercel access token:", error);
      setSaveError(error.message || "Failed to delete Vercel access token.");
      showError(error.message || "Failed to delete Vercel access token.");
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (saveError) {
      setSaveError(null);
    }
  }, [accessTokenInput]);

  if (!vercelDetails) {
    return (
      <div className="min-h-screen px-8 py-4">
        <div className="max-w-4xl mx-auto">
          <Button
            onClick={() => router.history.back()}
            variant="outline"
            size="sm"
            className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mr-3 mb-6">
            Vercel Integration
          </h1>
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              Vercel integration details not found.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-8 py-4">
      <div className="max-w-4xl mx-auto">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>

        <div className="mb-6">
          <div className="flex items-center mb-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mr-3">
              Configure {vercelDetails.name}
            </h1>
            <Rocket
              className={`h-5 w-5 ${isConfigured ? "text-green-500" : "text-yellow-500"}`}
            />
            <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
              {settingsLoading
                ? "Loading..."
                : isConfigured
                  ? "Setup Complete"
                  : "Not Setup"}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {vercelDetails.description} Manage your Vercel Access Token here.
            Project linking and deployment are handled in the App Details page.
          </p>
        </div>

        {vercelDetails.websiteUrl && (
          <Button
            onClick={() =>
              IpcClient.getInstance().openExternalUrl(vercelDetails.websiteUrl!)
            }
            className="mb-4 bg-(--background-lightest) cursor-pointer py-5"
            variant="outline"
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Get Vercel Access Token
            <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        )}

        {settingsLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : settingsError ? (
          <Alert variant="destructive">
            <AlertTitle>Error Loading Settings</AlertTitle>
            <AlertDescription>
              Could not load configuration data: {settingsError.message}
            </AlertDescription>
          </Alert>
        ) : (
          <Accordion
            type="multiple"
            className="w-full space-y-4"
            defaultValue={["settings-key"]}
          >
            <AccordionItem
              value="settings-key"
              className="border rounded-lg px-4 bg-(--background-lightest)"
            >
              <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
                Access Token from Settings
              </AccordionTrigger>
              <AccordionContent className="pt-4">
                {userAccessToken ? (
                  <Alert variant="default" className="mb-4">
                    <KeyRound className="h-4 w-4" />
                    <AlertTitle className="flex justify-between items-center">
                      <span>Current Token (Settings)</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteKey}
                        disabled={isSaving}
                        className="flex items-center gap-1 h-7 px-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        {isSaving ? "Deleting..." : "Delete"}
                      </Button>
                    </AlertTitle>
                    <AlertDescription>
                      <p className="font-mono text-sm">{userAccessToken}</p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        This token is currently active.
                      </p>
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-2">
                  <label
                    htmlFor="accessTokenInput"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {userAccessToken ? "Update" : "Set"} Vercel Access Token
                  </label>
                  <div className="flex items-start space-x-2">
                    <Input
                      id="accessTokenInput"
                      value={accessTokenInput}
                      onChange={(e) => setAccessTokenInput(e.target.value)}
                      placeholder="Enter Vercel Access Token here"
                      className={`flex-grow ${saveError ? "border-red-500" : ""}`}
                    />
                    <Button
                      onClick={handleSaveKey}
                      disabled={isSaving || !accessTokenInput}
                    >
                      {isSaving ? "Saving..." : "Save Token"}
                    </Button>
                  </div>
                  {saveError && (
                    <p className="text-xs text-red-600">{saveError}</p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Setting a token here will override the environment variable
                    (if set).
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            {vercelDetails.envVarName && (
              <AccordionItem
                value="env-key"
                className="border rounded-lg px-4 bg-(--background-lightest)"
              >
                <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
                  Access Token from Environment Variable
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  {envAccessToken ? (
                    <Alert variant="default">
                      <KeyRound className="h-4 w-4" />
                      <AlertTitle>
                        Environment Variable Token ({vercelDetails.envVarName})
                      </AlertTitle>
                      <AlertDescription>
                        <p className="font-mono text-sm">{envAccessToken}</p>
                        {!userAccessToken && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                            This token is currently active (no settings token
                            set).
                          </p>
                        )}
                        {userAccessToken && (
                          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                            This token is currently being overridden by the
                            token set in Settings.
                          </p>
                        )}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="default">
                      <Info className="h-4 w-4" />
                      <AlertTitle>Environment Variable Not Set</AlertTitle>
                      <AlertDescription>
                        The{" "}
                        <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">
                          {vercelDetails.envVarName}
                        </code>{" "}
                        environment variable is not set.
                      </AlertDescription>
                    </Alert>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                    This token is set outside the application. If present, it
                    will be used only if no token is configured in the Settings
                    section above. Requires app restart to detect changes.
                  </p>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        )}
        <div className="h-24"></div>
      </div>
    </div>
  );
}
