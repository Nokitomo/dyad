import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { VercelProject, VercelDeployParams } from "../ipc_types";
import { readSettings } from "@/main/settings";
import fetch from "node-fetch"; // Import node-fetch
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const logger = log.scope("vercel_handlers");
const handle = createLoggedHandler(logger);

const VERCEL_API_BASE_URL = "https://api.vercel.com";

async function getVercelAccessToken(): Promise<string | undefined> {
  const settings = readSettings();
  return settings.vercel?.accessToken?.value || process.env.VERCEL_ACCESS_TOKEN;
}

export async function getVercelProjectName(
  projectId: string,
): Promise<string | null> {
  const accessToken = await getVercelAccessToken();
  if (!accessToken) {
    logger.warn(
      "Vercel Access Token not configured, cannot fetch project name.",
    );
    return null;
  }
  try {
    const response = await fetch(
      `${VERCEL_API_BASE_URL}/v9/projects/${projectId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    if (!response.ok) {
      logger.error(
        `Failed to fetch Vercel project ${projectId}: ${response.statusText}`,
      );
      return null;
    }
    const projectData: any = await response.json();
    return projectData.name || null;
  } catch (error) {
    logger.error(`Error fetching Vercel project name for ${projectId}:`, error);
    return null;
  }
}

interface VercelDeploymentResponse {
  id: string;
  projectId: string;
  url: string; // Unique deployment URL
  inspectorUrl: string;
  alias?: string[]; // Production aliases
  readyState:
    | "BUILDING"
    | "ERROR"
    | "INITIALIZING"
    | "QUEUED"
    | "READY"
    | "CANCELED";
  // ... other fields
}

export function registerVercelHandlers() {
  handle("vercel:list-projects", async (): Promise<VercelProject[]> => {
    logger.info("IPC: vercel:list-projects called");
    const accessToken = await getVercelAccessToken();

    if (!accessToken) {
      throw new Error("Vercel Access Token not configured.");
    }

    try {
      const response = await fetch(`${VERCEL_API_BASE_URL}/v9/projects`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(`Vercel API error (${response.status}): ${errorBody}`);
        throw new Error(
          `Failed to fetch Vercel projects: ${response.statusText} - ${errorBody}`,
        );
      }

      const data: any = await response.json();
      const projects: VercelProject[] = data.projects.map((project: any) => ({
        id: project.id,
        name: project.name,
        url: `https://${project.targets?.production?.alias?.[0] || project.alias?.[0] || `${project.name}.vercel.app`}`,
      }));
      logger.info(`Successfully fetched ${projects.length} Vercel projects.`);
      return projects;
    } catch (error) {
      logger.error("Error fetching Vercel projects:", error);
      throw error;
    }
  });

  handle(
    "vercel:create-project",
    async (
      _,
      { projectName }: { projectName: string },
    ): Promise<VercelProject> => {
      logger.info(
        `IPC: vercel:create-project called for project name: ${projectName}`,
      );
      const accessToken = await getVercelAccessToken();

      if (!accessToken) {
        throw new Error("Vercel Access Token not configured.");
      }
      if (!projectName || projectName.trim() === "") {
        throw new Error("Project name cannot be empty.");
      }

      try {
        const response = await fetch(`${VERCEL_API_BASE_URL}/v9/projects`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: projectName,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.json();
          logger.error(
            `Vercel API error during project creation (${response.status}):`,
            errorBody,
          );
          throw new Error(
            errorBody.error?.message ||
              `Failed to create Vercel project: ${response.statusText}`,
          );
        }

        const projectData: any = await response.json();
        const newProject: VercelProject = {
          id: projectData.id,
          name: projectData.name,
          url: `https://${projectData.targets?.production?.alias?.[0] || projectData.alias?.[0] || `${projectData.name}.vercel.app`}`,
        };
        logger.info(
          `Successfully created Vercel project: ${newProject.name} (ID: ${newProject.id})`,
        );
        return newProject;
      } catch (error) {
        logger.error("Error creating Vercel project:", error);
        throw error;
      }
    },
  );

  handle(
    "vercel:deploy-project",
    async (
      _,
      params: VercelDeployParams,
    ): Promise<{ deploymentUrl: string; inspectorUrl: string }> => {
      logger.info("IPC: vercel:deploy-project called", params);
      const { appId, projectId: vercelProjectIdToDeploy } = params;

      const accessToken = await getVercelAccessToken();
      if (!accessToken) {
        throw new Error("Vercel Access Token not configured.");
      }

      const dyadApp = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });
      if (!dyadApp) {
        throw new Error(`Dyad app with ID ${appId} not found.`);
      }
      if (
        !dyadApp.vercelProjectId ||
        dyadApp.vercelProjectId !== vercelProjectIdToDeploy
      ) {
        throw new Error(
          `Dyad app ${appId} is not linked to Vercel project ${vercelProjectIdToDeploy}.`,
        );
      }
      if (!dyadApp.githubOrg || !dyadApp.githubRepo) {
        throw new Error(
          `Dyad app ${appId} must be connected to a GitHub repository before deploying to Vercel.`,
        );
      }

      const vercelProjectName = await getVercelProjectName(
        dyadApp.vercelProjectId,
      );
      if (!vercelProjectName) {
        throw new Error(
          `Could not fetch Vercel project name for ID ${dyadApp.vercelProjectId}.`,
        );
      }

      logger.info(
        `Attempting to deploy Dyad app "${dyadApp.name}" (GitHub: ${dyadApp.githubOrg}/${dyadApp.githubRepo}) to Vercel project "${vercelProjectName}" (ID: ${dyadApp.vercelProjectId})`,
      );

      try {
        const deployPayload = {
          name: vercelProjectName,
          target: "production",
          gitSource: {
            type: "github",
            org: dyadApp.githubOrg,
            repo: dyadApp.githubRepo,
            ref: "main",
          },
        };

        const response = await fetch(`${VERCEL_API_BASE_URL}/v13/deployments`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(deployPayload),
        });

        if (!response.ok) {
          const errorBody = await response.json();
          logger.error(
            `Vercel API error during deployment (${response.status}):`,
            errorBody,
          );
          throw new Error(
            errorBody.error?.message ||
              `Failed to initiate Vercel deployment: ${response.statusText}`,
          );
        }

        const deploymentData =
          (await response.json()) as VercelDeploymentResponse;
        logger.info(
          `Successfully initiated Vercel deployment for project "${vercelProjectName}". Deployment ID: ${deploymentData.id}, URL: ${deploymentData.url}, Inspector URL: ${deploymentData.inspectorUrl}`,
        );

        const finalDeploymentUrl = deploymentData.alias?.[0]
          ? `https://${deploymentData.alias[0]}`
          : `https://${deploymentData.url}`;

        // Save deployment info to Dyad's database
        await db
          .update(apps)
          .set({
            vercelDeploymentId: deploymentData.id,
            vercelDeploymentUrl: finalDeploymentUrl,
            vercelInspectorUrl: deploymentData.inspectorUrl,
            vercelDeploymentTimestamp: sql`(unixepoch())`,
          })
          .where(eq(apps.id, appId));
        logger.info(
          `Saved Vercel deployment info for app ${appId} to database.`,
        );

        return {
          deploymentUrl: finalDeploymentUrl,
          inspectorUrl: deploymentData.inspectorUrl,
        };
      } catch (error) {
        logger.error(
          `Error deploying to Vercel project "${vercelProjectName}":`,
          error,
        );
        throw error;
      }
    },
  );

  logger.debug("Registered Vercel IPC handlers");
}
