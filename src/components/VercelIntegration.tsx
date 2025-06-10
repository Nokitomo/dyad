"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Rocket } from "lucide-react"; // Using Rocket as an icon for Vercel
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";

export function VercelIntegration() {
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnectFromVercel = async () => {
    setIsDisconnecting(true);
    try {
      // Preserve other Vercel settings if they exist, only remove the accessToken
      const currentVercelSettings = settings?.vercel || {};
      const result = await updateSettings({
        vercel: { ...currentVercelSettings, accessToken: undefined },
      });
      if (result) {
        showSuccess("Successfully disconnected from Vercel");
      } else {
        showError("Failed to disconnect from Vercel");
      }
    } catch (err: any) {
      showError(
        err.message || "An error occurred while disconnecting from Vercel",
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Check if the accessToken value exists within the vercel settings
  const isConnected = !!settings?.vercel?.accessToken?.value;

  if (!isConnected) {
    return null; // Don't show anything if not connected
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Vercel Integration
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Your account is connected to Vercel.
        </p>
      </div>

      <Button
        onClick={handleDisconnectFromVercel}
        variant="destructive"
        size="sm"
        disabled={isDisconnecting}
        className="flex items-center gap-2"
      >
        {isDisconnecting ? "Disconnecting..." : "Disconnect from Vercel"}
        <Rocket className="h-4 w-4" />
      </Button>
    </div>
  );
}
