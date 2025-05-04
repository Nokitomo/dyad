import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { PlusCircle, FolderOpen, Upload } from "lucide-react"; // Import new icons
import { useAtom, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { IpcClient } from "@/ipc/ipc_client"; // Import IpcClient
import { showSuccess, showError, showLoading } from "@/lib/toast"; // Import toast utilities
import { useState } from "react"; // Import useState

export function AppList({ show }: { show?: boolean }) {
  const navigate = useNavigate();
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const { apps, loading, error, refreshApps } = useLoadApps();
  const [isScanning, setIsScanning] = useState(false); // State for scanning loading
  const [isImporting, setIsImporting] = useState(false); // State for importing loading

  if (!show) {
    return null;
  }

  const handleAppClick = (id: number) => {
    setSelectedAppId(id);
    setSelectedChatId(null);
    navigate({
      to: "/",
      search: { appId: id },
    });
  };

  const handleNewApp = () => {
    navigate({ to: "/" });
    // We'll eventually need a create app workflow
  };

  const handleScanForApps = async () => {
    setIsScanning(true);
    try {
      const result = await showLoading(
        "Scanning for apps...",
        IpcClient.getInstance().scanForApps()
      );
      if (result.addedApps.length > 0) {
        showSuccess(
          `Found and added ${result.addedApps.length} app(s).`
        );
        refreshApps(); // Refresh the list after adding
      } else if (result.errors.length > 0) {
         showError(`Finished scan with errors: ${result.errors.join(', ')}`);
      }
      else {
        showSuccess("No new apps found.");
      }
    } catch (error) {
      showError(`Failed to scan for apps: ${(error as Error).message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleImportProject = async () => {
    setIsImporting(true);
    try {
      const selectedPath = await IpcClient.getInstance().openDirectoryDialog();
      if (selectedPath) {
        const result = await showLoading(
          `Importing project from ${selectedPath}...`,
          IpcClient.getInstance().importProject(selectedPath)
        );
        if (result.success) {
          showSuccess(`Successfully imported app "${result.appName}".`);
          refreshApps(); // Refresh the list after importing
          // Optionally navigate to the new app's details page or chat
          if (result.appId) {
             navigate({ to: "/", search: { appId: result.appId } });
          }
        } else {
          showError(`Failed to import project: ${result.error}`);
        }
      } else {
        // User canceled the dialog, no error needed
      }
    } catch (error) {
      showError(`Failed to import project: ${(error as Error).message}`);
    } finally {
      setIsImporting(false);
    }
  };


  return (
    <SidebarGroup className="overflow-y-auto h-[calc(100vh-112px)]">
      <SidebarGroupLabel>Your Apps</SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="flex flex-col space-y-2">
          <Button
            onClick={handleNewApp}
            variant="outline"
            className="flex items-center justify-start gap-2 mx-2 py-2"
          >
            <PlusCircle size={16} />
            <span>New App</span>
          </Button>

          {/* New Buttons for Scan and Import */}
          <Button
            onClick={handleScanForApps}
            variant="outline"
            className="flex items-center justify-start gap-2 mx-2 py-2"
            disabled={isScanning || isImporting}
          >
            <FolderOpen size={16} />
            <span>Scan for Existing</span>
          </Button>
           <Button
            onClick={handleImportProject}
            variant="outline"
            className="flex items-center justify-start gap-2 mx-2 py-2"
             disabled={isScanning || isImporting}
          >
            <Upload size={16} />
            <span>Import Project</span>
          </Button>


          {loading ? (
            <div className="py-2 px-4 text-sm text-gray-500">
              Loading apps...
            </div>
          ) : error ? (
            <div className="py-2 px-4 text-sm text-red-500">
              Error loading apps
            </div>
          ) : apps.length === 0 ? (
            <div className="py-2 px-4 text-sm text-gray-500">No apps found</div>
          ) : (
            <SidebarMenu className="space-y-1">
              {apps.map((app) => (
                <SidebarMenuItem key={app.id} className="mb-1">
                  <Button
                    variant="ghost"
                    onClick={() => handleAppClick(app.id)}
                    className={`justify-start w-full text-left py-3 hover:bg-sidebar-accent/80 ${
                      selectedAppId === app.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : ""
                    }`}
                  >
                    <div className="flex flex-col w-full">
                      <span className="truncate">{app.name}</span>
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(app.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </Button>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}