import { ipcMain } from "electron";
import log from "electron-log";
import { withLock } from "../utils/lock_utils";
import { runningApps } from "../utils/process_manager"; // Import runningApps map
import {
  createAppService,
  getAppService,
  listAppsService,
  deleteAppService,
  renameAppService,
  resetAllService,
  getAppVersionService,
} from "../services/app_service";
import { readAppFileService, editAppFileService } from "../services/file_service";
import { runAppService, stopAppService, restartAppService } from "../services/app_execution_service";
import { listVersionsService, revertVersionService, checkoutVersionService } from "../services/version_service";
import { scanForAppsService, importProjectService } from "../services/app_management_service";
import { ALLOWED_ENV_VARS } from "../../constants/models";
import { getEnvVar } from "../utils/read_env";

const logger = log.scope("app_handlers");

export function registerAppHandlers() {
  // App CRUD Handlers
  ipcMain.handle("create-app", async (_, params) => {
    return createAppService(params);
  });

  ipcMain.handle("get-app", async (_, appId: number) => {
    return getAppService(appId);
  });

  ipcMain.handle("list-apps", async () => {
    return listAppsService();
  });

  ipcMain.handle("delete-app", async (_, { appId }: { appId: number }) => {
    // Stop the app if it's running before deleting
    if (runningApps.has(appId)) {
      try {
        await stopAppService(appId);
      } catch (error) {
        logger.warn(`Failed to stop app ${appId} before deletion, proceeding anyway:`, error);
      }
    }
    return deleteAppService(appId);
  });

  ipcMain.handle(
    "rename-app",
    async (_, { appId, appName, appPath }: { appId: number; appName: string; appPath: string }) => {
       // Stop the app if it's running before renaming
       if (runningApps.has(appId)) {
        try {
          await stopAppService(appId);
        } catch (error) {
          logger.warn(`Failed to stop app ${appId} before renaming, proceeding anyway:`, error);
        }
      }
      return renameAppService({ appId, appName, appPath });
    }
  );

  ipcMain.handle("reset-all", async () => {
    // Stop all running apps before resetting
    const runningAppIds = Array.from(runningApps.keys());
    for (const appId of runningAppIds) {
      try {
        await stopAppService(appId);
      } catch (error) {
        logger.warn(`Failed to stop app ${appId} during reset, proceeding anyway:`, error);
      }
    }
    return resetAllService();
  });

  ipcMain.handle("get-app-version", async () => {
    const version = await getAppVersionService();
    return { version }; // Return as object for consistency with other handlers
  });


  // File Operation Handlers
  ipcMain.handle(
    "read-app-file",
    async (_, { appId, filePath }: { appId: number; filePath: string }) => {
      return readAppFileService({ appId, filePath });
    }
  );

  ipcMain.handle(
    "edit-app-file",
    async (_, { appId, filePath, content }: { appId: number; filePath: string; content: string }) => {
      return editAppFileService({ appId, filePath, content });
    }
  );

  // App Execution Handlers
  ipcMain.handle(
    "run-app",
    async (event: Electron.IpcMainInvokeEvent, { appId }: { appId: number }) => {
      // Pass the event and a callback to the service
      return runAppService(appId, event, (output) => {
         event.sender.send("app:output", output);
      });
    }
  );

  ipcMain.handle("stop-app", async (_, { appId }: { appId: number }) => {
    return stopAppService(appId);
  });

  ipcMain.handle(
    "restart-app",
    async (event: Electron.IpcMainInvokeEvent, { appId, removeNodeModules }: { appId: number; removeNodeModules?: boolean }) => {
       // Pass the event and a callback to the service
       return restartAppService(appId, event, (output) => {
          event.sender.send("app:output", output);
       }, removeNodeModules);
    }
  );

  // Version Control Handlers
  ipcMain.handle("list-versions", async (_, { appId }: { appId: number }) => {
    return listVersionsService({ appId });
  });

  ipcMain.handle(
    "revert-version",
    async (_, { appId, previousVersionId }: { appId: number; previousVersionId: string }) => {
      return revertVersionService({ appId, previousVersionId });
    }
  );

  ipcMain.handle(
    "checkout-version",
    async (_, { appId, versionId }: { appId: number; versionId: string }) => {
      return checkoutVersionService({ appId, versionId });
    }
  );

  // App Management Handlers (Scan/Import)
  ipcMain.handle("app:scan-for-apps", async () => {
    return scanForAppsService();
  });

  ipcMain.handle(
    "app:import-project",
    async (_, { sourcePath }: { sourcePath: string }) => {
      return importProjectService(sourcePath);
    }
  );

  // Environment Variable Handler (kept here as it's simple and related to app context)
  ipcMain.handle("get-env-vars", async () => {
    const envVars: Record<string, string | undefined> = {};
    for (const key of ALLOWED_ENV_VARS) {
      envVars[key] = getEnvVar(key);
    }
    return envVars;
  });
}