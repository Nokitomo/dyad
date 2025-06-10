import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Rocket,
  LinkIcon,
  PlusCircle,
  Unlink,
  UploadCloudIcon,
  Loader2,
  ExternalLink,
  Info,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApp } from "@/hooks/useLoadApp";
import { VercelProject } from "@/ipc/ipc_types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { showError, showSuccess } from "@/lib/toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useNavigate } from "@tanstack/react-router";
import { vercelSettingsRoute } from "@/routes/settings/vercel";
import { formatDistanceToNow } from "date-fns";

interface VercelConnectorProps {
  appId: number;
}

export function VercelConnector({ appId }: VercelConnectorProps) {
  const { settings } = useSettings();
  const { app: currentDyadApp, refreshApp: refreshDyadApp } = useLoadApp(appId);
  const navigate = useNavigate();

  const [vercelProjects, setVercelProjects] = useState<VercelProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isCreateProjectDialogOpen, setIsCreateProjectDialogOpen] =
    useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  const isVercelConfigured = !!settings?.vercel?.accessToken?.value;
  const linkedVercelProjectId = currentDyadApp?.vercelProjectId;
  const linkedVercelProjectName = currentDyadApp?.vercelProjectName;
  const lastDeploymentInspectorUrl = currentDyadApp?.vercelInspectorUrl;
  const lastDeploymentUrl = currentDyadApp?.vercelDeploymentUrl;

  const fetchVercelProjects = async () => {
    if (isVercelConfigured) {
      setIsLoadingProjects(true);
      try {
        const projects = await IpcClient.getInstance().listVercelProjects();
        setVercelProjects(projects);
      } catch (err) {
        showError("Failed to load Vercel projects: " + (err as Error).message);
        setVercelProjects([]);
      } finally {
        setIsLoadingProjects(false);
      }
    } else {
      setVercelProjects([]);
    }
  };

  useEffect(() => {
    fetchVercelProjects();
  }, [isVercelConfigured, settings?.vercel?.accessToken?.value]);

  const handleLinkProject = async (projectId: string) => {
    try {
      await IpcClient.getInstance().setVercelAppProject(appId, projectId);
      await refreshDyadApp();
      showSuccess(
        `Project "${vercelProjects.find((p) => p.id === projectId)?.name || projectId}" linked successfully.`,
      );
      setDeploymentError(null);
    } catch (err) {
      showError("Failed to link Vercel project: " + (err as Error).message);
    }
  };

  const handleUnlinkProject = async () => {
    try {
      await IpcClient.getInstance().unsetVercelAppProject(appId);
      await refreshDyadApp();
      showSuccess("Vercel project unlinked successfully.");
    } catch (err) {
      showError("Failed to unlink Vercel project: " + (err as Error).message);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) {
      showError("Project name cannot be empty.");
      return;
    }
    setIsCreatingProject(true);
    try {
      const newProject = await IpcClient.getInstance().createVercelProject(
        newProjectName.trim(),
      );
      showSuccess(`Vercel project "${newProject.name}" created successfully!`);
      setNewProjectName("");
      setIsCreateProjectDialogOpen(false);
      await fetchVercelProjects();
      await handleLinkProject(newProject.id);
    } catch (err) {
      showError("Failed to create Vercel project: " + (err as Error).message);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleDeploy = async () => {
    if (!linkedVercelProjectId) {
      showError("Please link a Vercel project first.");
      return;
    }
    if (!currentDyadApp?.githubOrg || !currentDyadApp?.githubRepo) {
      showError(
        "Please connect this app to a GitHub repository first before deploying to Vercel.",
      );
      return;
    }

    setIsDeploying(true);
    setDeploymentError(null);
    try {
      showSuccess("Pushing latest changes to GitHub...");
      const syncResult = await IpcClient.getInstance().syncGithubRepo(appId);
      if (!syncResult.success) {
        throw new Error(syncResult.error || "Failed to sync with GitHub.");
      }
      showSuccess(
        "Successfully pushed to GitHub. Initiating Vercel deployment...",
      );

      await IpcClient.getInstance().deployVercelProject({
        appId,
        projectId: linkedVercelProjectId,
      });
      await refreshDyadApp();
      showSuccess("Deployment to Vercel initiated successfully!");
    } catch (err) {
      const errorMessage = (err as Error).message;
      showError("Deployment failed: " + errorMessage);
      setDeploymentError(errorMessage);
    } finally {
      setIsDeploying(false);
    }
  };

  if (!isVercelConfigured) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Rocket className="mr-2 h-5 w-5" /> Vercel Deployment
          </CardTitle>
          <CardDescription>
            Connect your Vercel account to deploy this app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate({ to: vercelSettingsRoute.id })}>
            Configure Vercel
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (linkedVercelProjectId && linkedVercelProjectName) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center">
              <Rocket className="mr-2 h-5 w-5" /> Vercel Project
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const projectUrl =
                  vercelProjects.find((p) => p.id === linkedVercelProjectId)
                    ?.url ||
                  (currentDyadApp?.vercelDeploymentUrl
                    ? new URL(currentDyadApp.vercelDeploymentUrl).origin
                    : null) ||
                  (settings?.githubUser?.email
                    ? `https://vercel.com/${settings.githubUser.email}/${linkedVercelProjectName}`
                    : "https://vercel.com");
                if (projectUrl) {
                  IpcClient.getInstance().openExternalUrl(
                    projectUrl.startsWith("http")
                      ? projectUrl
                      : `https://${projectUrl}`,
                  );
                }
              }}
              className="ml-2 px-2 py-1 h-auto"
            >
              View on Vercel <ExternalLink className="ml-1 h-3 w-3" />
            </Button>
          </CardTitle>
          <CardDescription>
            This app is linked to:{" "}
            <span className="font-medium">{linkedVercelProjectName}</span>
            {currentDyadApp?.vercelDeploymentTimestamp && (
              <span className="block text-xs text-muted-foreground mt-1">
                Last deployed:{" "}
                {formatDistanceToNow(
                  new Date(currentDyadApp.vercelDeploymentTimestamp),
                  { addSuffix: true },
                )}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={handleDeploy}
            disabled={isDeploying}
            className="w-full"
          >
            {isDeploying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UploadCloudIcon className="mr-2 h-4 w-4" />
            )}
            {isDeploying
              ? "Deploying..."
              : lastDeploymentUrl
                ? "Redeploy to Vercel"
                : "Deploy to Vercel"}
          </Button>
          {lastDeploymentUrl && lastDeploymentInspectorUrl && (
            <Alert
              variant="default"
              className="border-green-500/30 text-green-700 dark:text-green-300"
            >
              <CheckCircle className="h-4 w-4 !text-green-600 dark:!text-green-400" />
              <AlertTitle>Deployment Active/Initiated</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>
                  {currentDyadApp?.vercelDeploymentTimestamp
                    ? "Latest deployment is live."
                    : "Your app is being deployed."}
                  You can monitor the progress or view the live site.
                </p>
                <div className="flex space-x-2 mt-1">
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 h-auto text-green-700 dark:text-green-300"
                    onClick={() =>
                      IpcClient.getInstance().openExternalUrl(
                        lastDeploymentInspectorUrl,
                      )
                    }
                  >
                    View Build Logs <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 h-auto text-green-700 dark:text-green-300"
                    onClick={() =>
                      IpcClient.getInstance().openExternalUrl(lastDeploymentUrl)
                    }
                  >
                    View Deployment <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          {deploymentError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Deployment Error</AlertTitle>
              <AlertDescription>{deploymentError}</AlertDescription>
            </Alert>
          )}
          <Button
            variant="outline"
            onClick={handleUnlinkProject}
            className="w-full"
          >
            <Unlink className="mr-2 h-4 w-4" /> Unlink Project
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-1">
      <CardHeader>
        <CardTitle className="flex items-center">
          <Rocket className="mr-2 h-5 w-5" /> Link to Vercel Project
        </CardTitle>
        <CardDescription>
          Select an existing Vercel project or create a new one to link to this
          app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingProjects ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : vercelProjects.length > 0 ? (
          <div className="space-y-2 mb-4 max-h-48 overflow-y-auto border rounded-md p-2">
            {vercelProjects.map((project) => (
              <Button
                key={project.id}
                variant={"outline"}
                onClick={() => handleLinkProject(project.id)}
                className="w-full justify-start"
              >
                <LinkIcon className="mr-2 h-4 w-4" />
                {project.name}
              </Button>
            ))}
          </div>
        ) : (
          <Alert className="mb-4">
            <Info className="h-4 w-4" />
            <AlertTitle>No Vercel Projects Found</AlertTitle>
            <AlertDescription>
              Ensure your Access Token is correct and has permission to list
              projects, or create a new one below.
            </AlertDescription>
          </Alert>
        )}
        <Dialog
          open={isCreateProjectDialogOpen}
          onOpenChange={setIsCreateProjectDialogOpen}
        >
          <DialogTrigger asChild>
            <Button variant="default" className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" />
              Create New Vercel Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Vercel Project</DialogTitle>
              <DialogDescription>
                Enter a name for your new Vercel project. This will also be used
                for the URL.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="my-awesome-dyad-app"
                disabled={isCreatingProject}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateProjectDialogOpen(false)}
                  disabled={isCreatingProject}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isCreatingProject || !newProjectName.trim()}
                >
                  {isCreatingProject && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {isCreatingProject ? "Creating..." : "Create & Link Project"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
